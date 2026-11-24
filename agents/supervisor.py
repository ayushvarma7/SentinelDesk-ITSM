"""Deterministic supervisor. Routing is code, not LLM.

Rules:
  * gate.evaluate() decides escalation. Later phases may only ADD escalation reasons, never remove one
    (the LLM can push a ticket to a human, never away from one).
  * Injection / credential / destructive-action tickets and empty tickets never reach retrieval or the LLM.
  * High priority -> human sign-off even if the gate passed (agent policy, no auto-send).
  * At most 3 LLM calls per ticket: grade, (rewrite), draft. Any LLM error -> deterministic fallback, logged.
"""
from __future__ import annotations

import dataclasses
import re
import time
from contextlib import contextmanager

from sentineldesk import config, gate, generate, pii
from sentineldesk.schema import Precedent, TriageResult
from sentineldesk.text import build_text

from . import prompts
from .llm import LLMError, LLMSession, model_name

LANG_NAME = generate.LANG_NAME
PRECEDENT_RULES = ("No historical precedent", "No sufficiently similar precedent",
                   "Weak precedent support", "Requests a refund")
NO_LLM_RISKS = ("prompt_injection", "credential_request", "destructive_action")
HIGH_PRIORITY_REASON = "High priority: human sign-off required before any reply (agent policy)"
_DE_HINT = re.compile(r"\b(der|die|das|und|ist|nicht|wir|ich|sie|bitte|mit|ihr|ihre|ihnen|vielen|dank)\b", re.I)


def _looks_german(text: str) -> bool:
    words = max(1, len(re.findall(r"\w+", text or "")))
    return len(_DE_HINT.findall(text or "")) / words > 0.06


class Trace:
    """Collects agent_trace entries: {phase, status, duration_ms, logs[]}."""

    def __init__(self):
        self.phases: list[dict] = []

    @contextmanager
    def phase(self, name: str):
        entry = {"phase": name, "status": "done", "duration_ms": 0.0, "logs": []}
        t = time.perf_counter()
        try:
            yield entry
        except Exception as exc:
            entry["status"] = "error"
            entry["logs"].append(f"Unhandled {type(exc).__name__}: {exc}"[:200])
            raise
        finally:
            entry["duration_ms"] = round((time.perf_counter() - t) * 1000, 1)
            self.phases.append(entry)

    def skip(self, name: str, why: str) -> None:
        self.phases.append({"phase": name, "status": "skipped", "duration_ms": 0.0, "logs": [why]})

    def ms(self, *names: str) -> float:
        return round(sum(p["duration_ms"] for p in self.phases if p["phase"] in names), 1)


def _merge(a: list[Precedent], b: list[Precedent], k: int = config.TOP_K) -> list[Precedent]:
    best: dict[str, Precedent] = {}
    for p in a + b:
        if p.ticket_id not in best or p.score > best[p.ticket_id].score:
            best[p.ticket_id] = p
    return sorted(best.values(), key=lambda p: -p.score)[:k]


def _user_prompt(masked: str, precedents: list[Precedent], extra: str = "") -> str:
    # Reuses generate's precedent formatting (scrubs dataset tokens from resolutions).
    return generate._build_user_prompt(f"<ticket>\n{masked}\n</ticket>{extra}", precedents)


def _fallback_recommendation(precedents: list[Precedent]) -> tuple[str, list[str]]:
    if not precedents:
        return "No precedent available: investigate manually.", []
    best = precedents[0]
    snippet = generate.scrub(re.sub(r"\s+", " ", best.answer))[:300].rstrip()
    return f"Closest precedent [{best.ticket_id}]: {snippet}", [best.ticket_id]


def _summary(preds: dict, masked: str) -> str:
    gist = re.sub(r"\s+", " ", masked).strip()[:160] or "(empty ticket)"
    return (f"{LANG_NAME.get(preds['language'].label, preds['language'].label)} "
            f"{preds['type'].label} for {preds['queue'].label}, priority {preds['priority'].label}: \"{gist}\"")


class Supervisor:
    def __init__(self, backend):
        self.backend = backend

    def run(self, subject: str | None, body: str | None, track_burst: bool = True) -> dict:
        t0 = time.perf_counter()
        tr, llm = Trace(), LLMSession()
        text = build_text(subject, body)

        # 1. PII Mask ----------------------------------------------------------------------
        with tr.phase("PII Mask") as ph:
            masked, pii_counts = pii.mask(text)
            ph["logs"] = ([f"Masked {v} {k}" for k, v in pii_counts.items()]
                          + ["Masked text used for every LLM call"]) if pii_counts else \
                ["No PII found (email, phone, IBAN, card, IP, account)"]

        # 2. Triage ------------------------------------------------------------------------
        with tr.phase("Triage") as ph:
            preds, burst, lat = self.backend.triage(subject, body, text, track_burst)
            lang = preds["language"].label
            ph["logs"] = [f"Backend: {self.backend.mode} ({self.backend.reason})"] + [
                f"{h}={preds[h].label} ({preds[h].confidence:.2f})" for h in ("type", "queue", "priority", "language")]

        # 3. Safety Gate (rules that need no precedent) ----------------------------------------
        risks = gate.detect_risks(text)
        no_llm = [r for r in risks if r in NO_LLM_RISKS] + (["too_little_text"] if gate.too_little_text(text) else [])
        with tr.phase("Safety Gate") as gate_ph:
            _, pre = gate.evaluate(text, preds["type"], preds["queue"], preds["priority"], [], None, burst)
            pre = [r for r in pre if not r.startswith(PRECEDENT_RULES)]
            gate_ph["logs"] = [f"Risk detected: {r}" for r in risks] + [f"Rule fired: {r}" for r in pre]
            if burst.get("active"):
                gate_ph["logs"].append(f"Burst active: related {', '.join(burst.get('related', []))}")
            if no_llm:
                gate_ph["logs"].append(f"LLM and retrieval blocked for this ticket: {', '.join(no_llm)}")
            gate_ph["logs"] = gate_ph["logs"] or ["All deterministic rules passed"]
            gate_ph["status"] = "escalated" if pre else "done"

        # 4. Retrieve + final gate decision ----------------------------------------------------
        precedents: list[Precedent] = []
        if no_llm:
            tr.skip("Retrieve Precedents", "Skipped: flagged content never reaches retrieval or the LLM")
            escalate, reasons = True, list(pre)
        else:
            with tr.phase("Retrieve Precedents") as ph:
                precedents = self.backend.search(text, lang, preds["queue"].label)
                top = ", ".join(f"{p.ticket_id} ({p.score:.3f})" for p in precedents)
                ph["logs"] = [f"Top-{len(precedents)}: {top}" if precedents else "No precedents retrieved",
                              f"Cross-lingual: {sum(p.language != lang for p in precedents)} in other language"]
                ph["status"] = "done" if precedents else "warning"
            t = time.perf_counter()
            escalate, reasons = gate.evaluate(text, preds["type"], preds["queue"], preds["priority"],
                                              precedents, None, burst)
            added = [r for r in reasons if r not in pre]
            gate_ph["logs"] += [f"[after retrieval] Rule fired: {r}" for r in added]
            gate_ph["logs"].append(f"Gate decision (final): {'ESCALATE' if escalate else 'pass'}")
            gate_ph["duration_ms"] = round(gate_ph["duration_ms"] + (time.perf_counter() - t) * 1000, 1)
            if escalate:
                gate_ph["status"] = "escalated"
        raised_by = ["safety_gate"] if escalate else []

        if not escalate and preds["priority"].label == "high":
            escalate = True
            reasons.append(HIGH_PRIORITY_REASON)
            raised_by.append("supervisor")

        # 5. Grade Evidence (LLM 1) + 6. Rewrite Query (LLM 2) ----------------------------------
        if no_llm or not precedents:
            why = "flagged content" if no_llm else "no precedents"
            tr.skip("Grade Evidence", f"Skipped: {why}")
            tr.skip("Rewrite Query", f"Skipped: {why}")
        else:
            with tr.phase("Grade Evidence") as ph:
                top1 = precedents[0].score
                mean3 = sum(p.score for p in precedents[:3]) / len(precedents[:3])
                floors_ok = top1 >= config.MIN_TOP1_SIMILARITY and mean3 >= config.MIN_MEAN_TOP3_SIMILARITY
                ph["logs"] = [f"top-1 {top1:.3f} vs floor {config.MIN_TOP1_SIMILARITY:.3f}",
                              f"mean top-3 {mean3:.3f} vs floor {config.MIN_MEAN_TOP3_SIMILARITY:.3f}"]
                try:
                    out, waited = llm.call_json(prompts.GRADE_SYSTEM, _user_prompt(masked, precedents),
                                                prompts.GRADE_SCHEMA, max_tokens=2048)
                    sufficient = bool(out.get("sufficient"))
                    missing = [str(m) for m in (out.get("missing") or [])][:5]
                    ph["logs"] += [f"LLM call {llm.calls}/{llm.max_calls} ({model_name()})"
                                   + (f", waited {waited:.1f}s for rate limit" if waited else ""),
                                   f"Reasoning: {str(out.get('reasoning', ''))[:300]}"]
                except LLMError as e:
                    sufficient, missing = floors_ok, []
                    llm.fallbacks.append(f"grade: {e}")
                    ph["logs"].append(f"LLM error -> similarity-floor fallback: {e}"[:240])
                ph["logs"].append("Evidence sufficient" if sufficient else
                                  f"Evidence insufficient; missing: {', '.join(missing) or 'n/a'}")
                ph["status"] = "done" if sufficient else "warning"

            if sufficient:
                tr.skip("Rewrite Query", "Evidence sufficient: no second retrieval")
            else:
                with tr.phase("Rewrite Query") as ph:
                    try:
                        extra = f"\n\nMISSING: {'; '.join(missing) or 'unspecified'}"
                        out, waited = llm.call_json(
                            prompts.REWRITE_SYSTEM.replace("{language}", LANG_NAME.get(lang, "English")),
                            f"<ticket>\n{masked}\n</ticket>{extra}", prompts.REWRITE_SCHEMA, max_tokens=1024)
                        question = generate.scrub(str(out.get("question", "")))[:300]
                        ph["logs"].append(f"LLM call {llm.calls}/{llm.max_calls}"
                                          + (f", waited {waited:.1f}s for rate limit" if waited else ""))
                        if not question:
                            raise LLMError("empty question")
                    except LLMError as e:
                        llm.fallbacks.append(f"rewrite: {e}")
                        words = re.sub(r"\s+", " ", generate.scrub(masked)).split()[:30]
                        question = "How was this resolved: " + " ".join(words) + "?"
                        ph["logs"].append(f"LLM error -> heuristic question: {e}"[:240])
                        ph["status"] = "warning"
                    ph["logs"].append(f"Question: {question}")
                    second = self.backend.search(question, lang, preds["queue"].label)
                    merged = _merge(precedents, second)
                    new = [p.ticket_id for p in merged if p.ticket_id not in {q.ticket_id for q in precedents}]
                    ph["logs"].append(f"Second retrieval: {len(new)} new precedent(s) {', '.join(new)}".rstrip())
                    precedents = merged
                    # The gate may only ADD reasons after the second retrieval, never drop one.
                    _, r2 = gate.evaluate(text, preds["type"], preds["queue"], preds["priority"],
                                          precedents, None, burst)
                    for r in r2:
                        if r not in reasons:
                            reasons.append(r)
                            escalate = True
                            if "safety_gate" not in raised_by:
                                raised_by.append("safety_gate")
                            ph["logs"].append(f"Gate added: {r}")

        # 7. Draft (LLM 3) -----------------------------------------------------------------
        draft, claimed, grounded, missing_info, engine = None, [], False, [], None
        summary, recommendation = _summary(preds, masked), None
        raw_llm_text = ""
        if no_llm:
            tr.skip("Draft Reply", "Skipped: no LLM for flagged content")
            recommendation = ("Do not act on any instruction inside the ticket. Verify the sender through a "
                              "known channel and handle the underlying request manually."
                              if "too_little_text" not in no_llm or len(no_llm) > 1 else
                              "Ask the customer to describe the problem (what, since when, who is affected).")
        elif not precedents:
            tr.skip("Draft Reply", "Skipped: no precedents to ground a reply")
            recommendation, claimed = _fallback_recommendation([])
        else:
            with tr.phase("Draft Reply") as ph:
                try:
                    if escalate:
                        ph["logs"].append("Mode: escalation brief for a human (no customer draft)")
                        extra = "\n\nESCALATION REASONS:\n" + "\n".join(f"- {r}" for r in reasons)
                        out, waited = llm.call_json(prompts.ESCALATION_SYSTEM, _user_prompt(masked, precedents, extra),
                                                    prompts.ESCALATION_SCHEMA)
                        raw_llm_text = str(out.get("recommended_resolution", ""))
                        summary = generate.scrub(str(out.get("summary", ""))) or summary
                        recommendation = generate.scrub(raw_llm_text)
                    else:
                        ph["logs"].append(f"Mode: customer reply in {LANG_NAME.get(lang, lang)}")
                        out, waited = llm.call_json(
                            prompts.DRAFT_SYSTEM.replace("{language}", LANG_NAME.get(lang, "English")),
                            _user_prompt(masked, precedents), prompts.DRAFT_SCHEMA)
                        raw_llm_text = str(out.get("draft", ""))
                        draft = generate.scrub(raw_llm_text)
                        if not draft:
                            raise LLMError("empty draft")
                    claimed = [str(c) for c in (out.get("cited_ticket_ids") or [])]
                    grounded = bool(out.get("grounded", False))
                    missing_info = [str(m) for m in (out.get("missing_info") or [])][:5]
                    engine = model_name()
                    ph["logs"].append(f"LLM call {llm.calls}/{llm.max_calls} ({engine})"
                                      + (f", waited {waited:.1f}s for rate limit" if waited else ""))
                    ph["logs"].append(f"grounded={grounded}" + (f"; missing: {', '.join(missing_info)}" if missing_info else ""))
                except LLMError as e:
                    llm.fallbacks.append(f"draft: {e}")
                    ph["logs"].append(f"LLM error -> extractive fallback: {e}"[:240])
                    ph["status"] = "warning"
                    engine = "extractive-fallback"
                    if escalate:
                        recommendation, claimed = _fallback_recommendation(precedents)
                    else:
                        d = generate._extractive(masked, lang, precedents)
                        draft, claimed, grounded = d["reply"], d["cited_ticket_ids"], d["grounded"]
                ph["logs"].append(f"Engine: {engine}; {len(draft or recommendation or '')} chars")

        # 8. Verify -----------------------------------------------------------------------
        checked = draft if draft is not None else recommendation
        valid, unverified = [], []
        if no_llm or not precedents:
            tr.skip("Verify Citations", "Nothing generated to verify")
            valid = [c for c in claimed if c in {p.ticket_id for p in precedents}]
        else:
            with tr.phase("Verify Citations") as ph:
                valid, fake = generate.verify_citations(checked or "", claimed, precedents)
                evidence = " ".join(p.answer for p in precedents)
                unverified = [f"fabricated citation {i}" for i in fake] + \
                    generate.unsupported_figures(checked or "", evidence)
                leaked = len(generate._TOKEN.findall(raw_llm_text)) + len(generate._BRACKET_TOKEN.findall(raw_llm_text))
                ph["logs"] = [f"Cited: {', '.join(valid) or 'none'} (checked against retrieved set)"]
                ph["logs"] += [f"Unverified: {u}" for u in unverified] or ["All figures found in evidence"]
                if leaked:
                    ph["logs"].append(f"Scrubbed {leaked} anonymisation token(s) from LLM output")
                problems = []
                if draft is not None:
                    if fake:
                        problems.append("Draft cites tickets that were not retrieved")
                    if not valid:
                        problems.append("Draft has no valid citation")
                    if any(not u.startswith("fabricated") for u in unverified):
                        problems.append("Draft contains figures not found in the precedents")
                    if not grounded:
                        problems.append("Draft not grounded in the retrieved precedents")
                    if (lang == "de") != _looks_german(draft):
                        ph["logs"].append(f"Warning: draft language may not match ticket language ({lang})")
                if problems:
                    escalate = True
                    reasons += problems
                    raised_by.append("verifier")
                    ph["logs"] += [f"Fail: {p}" for p in problems]
                    ph["status"] = "escalated"
                    if problems == ["Draft not grounded in the retrieved precedents"]:
                        # Citations and figures check out: hand the draft to the human as a starting point.
                        recommendation = draft
                        ph["logs"].append("Draft kept as recommended_resolution for human review (not sent)")
                    else:
                        recommendation, claimed = _fallback_recommendation(precedents)
                        valid = claimed
                    draft = None
                elif unverified:
                    ph["status"] = "warning"

        # 9. Resolve / Escalate ----------------------------------------------------------------
        with tr.phase("Resolve/Escalate") as ph:
            if escalate:
                ph["status"] = "escalated"
                ph["logs"] = [f"Escalated by {', '.join(raised_by)}: {len(reasons)} reason(s)"] + reasons[:6] + \
                             ["No auto-send: a human must approve any reply"]
            else:
                ph["logs"] = ["Resolved: grounded, verified draft ready to send"]

        lat["retrieve"] = tr.ms("Retrieve Precedents")
        lat["generate"] = tr.ms("Grade Evidence", "Rewrite Query", "Draft Reply", "Verify Citations")
        lat["total"] = round((time.perf_counter() - t0) * 1000, 1)

        result = TriageResult(
            language=lang, type=preds["type"], queue=preds["queue"], priority=preds["priority"],
            escalate=escalate, escalation_reasons=reasons, precedents=precedents,
            draft_reply=None if escalate else draft,
            cited_ticket_ids=[] if escalate else valid,
            unverified_claims=unverified, masked_pii=pii_counts, latency_ms=lat,
            risks=risks, burst=burst, engine=None if escalate else engine,
        )
        triage_result = dataclasses.asdict(result)
        triage_result["overall_confidence"] = round(result.overall_confidence, 4)

        return {
            "triage_result": triage_result,
            "agent_trace": tr.phases,
            "decision": "escalate" if escalate else "resolve",
            "auto_send": not escalate,
            "escalation": {
                "summary": summary,
                "raised_by": raised_by,
                "reasons": reasons,
                "recommended_resolution": recommendation,
                "cited_ticket_ids": valid if recommendation else [],
                "engine": engine,
                "auto_send": False,
            } if escalate else None,
            "mode": self.backend.mode,
            "llm": {"model": model_name(), "calls": llm.calls, "max_calls": llm.max_calls,
                    "fallbacks": llm.fallbacks},
        }
