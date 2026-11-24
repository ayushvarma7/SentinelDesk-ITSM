"""SentinelDesk API: FastAPI wrapper around sentineldesk.pipeline.triage.

Run from the repo root:
    SD_MOCK=1 .venv/bin/uvicorn api.main:app --reload --port 8000

Mode:
  real  - sentineldesk.pipeline imports AND artifacts/heads.joblib + kb_embeddings.npy exist AND SD_MOCK != 1
  mock  - otherwise. Same TriageResult shape; uses the real gate/PII/figure-check code (api/mock_engine.py).
"""
from __future__ import annotations

import dataclasses
import json
import os
import re
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import mock_engine  # noqa: E402
from seed_data import AGENTS, SEEDS  # noqa: E402
import assignment_rules  # noqa: E402
from sentineldesk import config  # noqa: E402

MAX_CHARS = 20_000  # hard cap per field; the pipeline is length-safe but the browser is not

# ---------------------------------------------------------------- mode selection
MODE = "mock"
MODE_REASON = ""
_pipeline = None
if os.environ.get("SD_MOCK", "0") == "1":
    MODE_REASON = "SD_MOCK=1"
else:
    try:
        from sentineldesk import pipeline as _pipeline  # noqa: E402
        missing = [p.name for p in (config.HEADS_PATH, config.KB_EMB_PATH) if not p.exists()]
        if missing:
            MODE_REASON = f"artifacts missing: {', '.join(missing)}"
            _pipeline = None
        else:
            MODE, MODE_REASON = "real", "pipeline + artifacts found"
    except Exception as exc:  # torch/numpy/sklearn not installed, etc.
        MODE_REASON = f"pipeline import failed: {type(exc).__name__}: {exc}"[:200]
        _pipeline = None


def run_triage(subject: str, body: str, now: float | None = None, track_burst: bool = True,
               record: bool | None = None):
    """Returns (TriageResult, engine_mode). Falls back to mock if the real pipeline throws.

    record=False triages live (burst detector, root cause) without writing the problem database
    (used for demo seed tickets, so restarting the API does not inflate problem counts)."""
    if MODE == "real" and _pipeline is not None:
        try:
            return _pipeline.triage(subject, body, track_burst=track_burst, received_at=now,
                                    record=record), "real"
        except Exception as exc:
            print(f"[api] real triage failed, using mock: {exc!r}", file=sys.stderr)
    return mock_engine.mock_triage(subject, body, now=now, track_burst=track_burst), "mock"


def result_to_dict(res) -> dict:
    d = dataclasses.asdict(res)
    d["overall_confidence"] = round(res.overall_confidence, 4)
    return d


# ---------------------------------------------------------------- agent trace
def _ms(x: float) -> float:
    return round(float(x), 1)


def build_trace(r: dict, text_len: int) -> list[dict]:
    lat = r.get("latency_ms", {})
    esc = r["escalate"]
    pii = r.get("masked_pii", {}) or {}
    precs = r.get("precedents", []) or []
    reasons = r.get("escalation_reasons", []) or []
    unverified = r.get("unverified_claims", []) or []
    cited = r.get("cited_ticket_ids", []) or []
    phases = []

    def add(name, status, dur, logs):
        phases.append({"phase": name, "status": status, "duration_ms": _ms(dur), "logs": logs})

    if pii:
        pii_logs = [f"Masked {v} {k}" for k, v in pii.items()]
        pii_logs.append("Masked text used for every external call")
    else:
        pii_logs = ["No PII found (email, phone, IBAN, card, IP, account)"]
    add("PII Mask", "done", 0.2 + text_len / 8000, pii_logs)

    add("Triage", "done", lat.get("embed", 0) + lat.get("classify", 0), [
        f"Embedded query (e5-small) in {lat.get('embed', 0):.1f} ms",
        f"type={r['type']['label']} ({r['type']['confidence']:.2f})",
        f"queue={r['queue']['label']} ({r['queue']['confidence']:.2f})",
        f"priority={r['priority']['label']} ({r['priority']['confidence']:.2f})",
        f"language={r['language']}",
    ])

    risks = r.get("risks", []) or []
    gate_logs = [f"Risk detected: {x}" for x in risks]
    gate_logs += [f"Rule fired: {x}" for x in reasons if "precedent" not in x.lower()]
    if r.get("burst", {}).get("active"):
        gate_logs.append(f"Burst active: related {', '.join(r['burst'].get('related', []))}")

    pre_reasons = [x for x in reasons if "precedent" not in x.lower() and "grounded" not in x.lower()]
    add("Safety Gate", "escalated" if pre_reasons else "done", 0.4,
        gate_logs or ["All deterministic rules passed"])

    top = ", ".join(f"{p['ticket_id']} ({p['score']:.3f})" for p in precs[:5])
    add("Retrieve Precedents", "done" if precs else "warning", lat.get("retrieve", 0),
        [f"Top-{len(precs)}: {top}" if precs else "No precedents retrieved",
         f"Cross-lingual: {sum(1 for p in precs if p['language'] != r['language'])} in other language"])

    if precs:
        top1 = precs[0]["score"]
        mean3 = sum(p["score"] for p in precs[:3]) / len(precs[:3])
        ok = top1 >= config.MIN_TOP1_SIMILARITY and mean3 >= config.MIN_MEAN_TOP3_SIMILARITY
        add("Grade Evidence", "done" if ok else "warning", 0.2, [
            f"top-1 {top1:.3f} vs floor {config.MIN_TOP1_SIMILARITY:.3f}",
            f"mean top-3 {mean3:.3f} vs floor {config.MIN_MEAN_TOP3_SIMILARITY:.3f}",
            "Evidence sufficient" if ok else "Evidence too weak to ground a reply"])
    else:
        add("Grade Evidence", "warning", 0.1, ["No evidence to grade"])

    if esc:
        add("Draft Reply", "skipped", 0, ["Escalated tickets get no customer draft (by design)"])
        add("Verify Citations", "skipped", 0, ["Nothing to verify"])
        add("Resolve/Escalate", "escalated", 0.1,
            [f"Escalated: {len(reasons)} reason(s)"] + reasons[:4])
    else:
        add("Draft Reply", "done", lat.get("generate", 0),
            [f"Engine: {r.get('engine') or 'n/a'}", f"Draft {len(r.get('draft_reply') or '')} chars"])
        add("Verify Citations", "warning" if unverified else "done", 1.1,
            [f"Cited: {', '.join(cited) or 'none'} (all in retrieved set)"]
            + ([f"Unverified: {u}" for u in unverified] or ["All figures found in evidence"]))
        add("Resolve/Escalate", "done", 0.1, ["Auto-resolved: draft ready to send"])
    return phases


# ---------------------------------------------------------------- store
LOCK = threading.Lock()
TICKETS: dict[str, dict] = {}
_SEQ = [10000]
PREFIX = {"Incident": "INC", "Request": "REQ", "Problem": "PRB", "Change": "CHG"}
SLA_HOURS = {"high": 4, "medium": 24, "low": 72}


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _summary(subject: str, body: str) -> str:
    # Length cut at a word boundary, not a sentence split ("St. Mary's" broke that).
    s = re.sub(r"\s+", " ", (body or subject or "(no text)")).strip()
    if len(s) <= 200:
        return s
    return s[:200].rsplit(" ", 1)[0] + "…"


def _tags(r: dict) -> list[str]:
    tags = [r["queue"]["label"].split()[0].lower(), r["language"]]
    tags += [x.replace("_", "-") for x in r.get("risks", [])]
    if r.get("masked_pii"):
        tags.append("pii-masked")
    if r.get("burst", {}).get("active"):
        tags.append("major-incident")
    if r.get("unverified_claims"):
        tags.append("unverified")
    return list(dict.fromkeys(tags))


def _copilot(subject: str, body: str, r: dict) -> dict:
    """Recommended resolution for the human (escalated tickets have no customer draft)."""
    if r.get("draft_reply"):
        return {"text": r["draft_reply"], "cited_ids": r["cited_ticket_ids"],
                "unverified": r["unverified_claims"], "source": "draft"}
    text = f"{subject}\n{body}"
    none = {"text": None, "cited_ids": [], "unverified": [], "source": "none"}
    if any("Too little text" in x for x in r.get("escalation_reasons", [])):
        return none  # nothing to resolve; the human has to read it
    if set(r.get("risks", [])) & {"prompt_injection", "credential_request", "destructive_action", "legal"}:
        return none  # never hand the operator a ready-to-send reply to an attack or legal threat
    lang = r["language"]
    sug = mock_engine.suggestion(text, lang) if MODE == "mock" else None   # real mode: real precedents only
    precs = r.get("precedents", [])
    if not sug and precs:
        # Quote the closest same-language precedent, like generate.py's extractive fallback.
        p = next((x for x in precs if x["language"] == lang), precs[0])
        sug = f"{p['answer']} [{p['ticket_id']}]"
    if not sug:
        return none
    from sentineldesk.generate import unsupported_figures
    ids = list(dict.fromkeys(re.findall(r"(?:TKT|LIVE)-\d{5}", sug)))
    unverified = unsupported_figures(sug, " ".join(p["answer"] for p in precs))
    return {"text": sug, "cited_ids": ids, "unverified": unverified, "source": "suggestion"}


def make_ticket(subject: str, body: str, name: str, email: str, created: float,
                status_hint: str | None = None, channel: str = "portal",
                track_burst: bool = True, record: bool | None = None,
                fields: dict | None = None) -> dict:
    subject = (subject or "")[:MAX_CHARS]
    body = (body or "")[:MAX_CHARS]
    res, engine_mode = run_triage(subject, body, now=created, track_burst=track_burst, record=record)
    r = result_to_dict(res)
    prio, typ, esc = r["priority"]["label"], r["type"]["label"], r["escalate"]
    # three-tier gate outcome (gate.decide): AUTO_DRAFT_READY | HUMAN_REVIEW | ESCALATE_ONCALL
    gate_status = r.get("status") or ("ESCALATE_ONCALL" if esc else "AUTO_DRAFT_READY")

    with LOCK:
        _SEQ[0] += 1
        tid = f"{PREFIX.get(typ, 'TKT')}-{_SEQ[0]}"
    h = int(mock_engine._h(subject + body, "agent") * 1000)
    if status_hint:
        status = status_hint
        if esc and status == "Auto-Resolved":
            status = "In Progress"
    elif gate_status == "ESCALATE_ONCALL" or (esc and not r.get("status") and prio == "high"):
        status = "Escalated"                                  # on-call now, no draft
    elif esc:
        status = "New" if h % 2 else "In Progress"            # HUMAN_REVIEW: an agent decides
    else:
        status = "Auto-Resolved"                              # AUTO_DRAFT_READY
    if status == "Auto-Resolved":
        assigned = "SentinelDesk Agent"
    elif status == "New":
        assigned = "Unassigned"
    elif status == "Escalated":
        assigned = f"On-call: {AGENTS[h % len(AGENTS)]}"
    else:
        assigned = AGENTS[h % len(AGENTS)]

    # The organisation's routing policy (admin console > Rules), first match wins. Routing only: the
    # gate's outcome above is final, a rule can raise the priority but never lower it.
    predicted_queue = r["queue"]["label"]
    rule = assignment_rules.first_match(assignment_rules.load()["rules"], subject, body,
                                        {"queue": predicted_queue, "type": typ, "priority": prio,
                                         "language": r["language"]})
    group, prio, assigned = assignment_rules.apply(rule, predicted_queue, prio, assigned, status)
    history = [{"at": _iso(created), "actor": "SentinelDesk",
                "action": {"ESCALATE_ONCALL": "Escalated to on-call engineer",
                           "HUMAN_REVIEW": "Sent for human review"}.get(gate_status,
                                                                        "Auto-resolved with grounded draft")}]
    if rule:
        history.append({"at": _iso(created), "actor": "Assignment rules",
                        "action": f"Rule \u201c{rule['name']}\u201d: routed to {group}"})

    ticket = {
        "id": tid,
        "subject": subject or "(no subject)",
        "body": mock_engine.masked(body),
        "summary": _summary(subject, mock_engine.masked(body)),
        "requester": {"name": name or "Customer", "email": email or ""},
        "channel": channel,
        # What the customer picked in the portal form (service, impact, urgency, category). Shown to
        # agents only; triage reads the subject and body alone.
        "portal_fields": {str(k)[:40]: str(v)[:120] for k, v in (fields or {}).items()},
        "created_at": _iso(created),
        "sla_due": _iso(created + SLA_HOURS.get(prio, 24) * 3600),
        "status": status,
        "assigned_to": assigned,
        "tags": _tags(r),
        "priority": prio,
        "type": typ,
        "queue": group,                                  # assignment group after the rules
        "routing": {"predicted_queue": predicted_queue, "rule_id": rule["id"] if rule else None,
                    "rule_name": rule["name"] if rule else None},
        "language": r["language"],
        "confidence": r["overall_confidence"],
        "escalated": esc,
        "gate_status": gate_status,
        "problem": r.get("problem"),                     # problem database entry (store.py), or None
        "engine_mode": engine_mode,
        "triage": r,
        "agent_trace": build_trace(r, len(subject) + len(body)),
        "copilot": _copilot(subject, body, r),
        "final_reply": r["draft_reply"] if status in ("Auto-Resolved", "Closed") and not esc else None,
        "history": history,
    }
    with LOCK:
        TICKETS[tid] = ticket
    return ticket


def seed() -> None:
    """Fill the queue with example tickets, and the problem database with the problems they form.

    Tickets live in memory, so the problem database is rebuilt from the same tickets on every start:
    the two always agree, and restarting does not inflate occurrence counts. Set SD_KEEP_PROBLEMS=1 to
    keep the database file as it is instead (the seed tickets are then not recorded again)."""
    keep = os.getenv("SD_KEEP_PROBLEMS") == "1"
    recording = MODE == "real" and config.DB_ENABLED and not keep
    if recording:
        try:
            from sentineldesk import store
            store.reset()
        except Exception as exc:  # noqa: BLE001
            recording = False
            print(f"[api] problem database not reset, seed tickets will not be recorded: {exc!r}", file=sys.stderr)
    now = time.time()
    rows = sorted(SEEDS, key=lambda s: -s[4])  # oldest first so ids increase with time
    for subj, body, name, email, age_min, hint, burst_seed in rows:
        make_ticket(subj, body, name, email, now - age_min * 60, hint,
                    channel="email" if age_min % 2 else "portal",
                    track_burst=burst_seed or MODE == "mock", record=recording)


seed()

# ---------------------------------------------------------------- app
app = FastAPI(title="SentinelDesk API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",   # admin console
                   "http://localhost:5174", "http://127.0.0.1:5174"],  # customer site
    allow_methods=["*"], allow_headers=["*"],
)


class TriageIn(BaseModel):
    subject: Optional[str] = ""
    body: Optional[str] = ""


class TicketIn(TriageIn):
    name: Optional[str] = "Customer"
    email: Optional[str] = ""
    kind: Optional[str] = "incident"   # incident | request (portal card that was used)
    fields: Optional[dict] = None      # portal form choices: service, impact, urgency, category


class ActionIn(BaseModel):
    agent: Optional[str] = "You"
    reply: Optional[str] = None
    reason: Optional[str] = None


def _get(tid: str) -> dict:
    t = TICKETS.get(tid)
    if not t:
        raise HTTPException(404, f"ticket {tid} not found")
    return t


@app.get("/health")
def health() -> dict:
    return {"ok": True, "mode": MODE, "reason": MODE_REASON, "tickets": len(TICKETS)}


@app.post("/triage")
def triage(inp: TriageIn) -> dict:
    res, engine_mode = run_triage((inp.subject or "")[:MAX_CHARS], (inp.body or "")[:MAX_CHARS],
                                  track_burst=False)
    d = result_to_dict(res)
    d["mode"] = engine_mode
    return d


@app.get("/tickets")
def list_tickets(email: Optional[str] = None, requester: Optional[str] = None) -> list[dict]:
    """All tickets, newest first. ?email= (customer portal) filters by requester email, case-insensitive.
    ?requester= is the older alias. An empty value means no filter."""
    items = list(TICKETS.values())
    who = (email if email is not None else requester or "").strip().lower()
    if who:
        items = [t for t in items if t["requester"]["email"].lower() == who]
    return sorted(items, key=lambda t: t["created_at"], reverse=True)


@app.get("/tickets/{tid}")
def get_ticket(tid: str) -> dict:
    return _get(tid)


@app.post("/tickets")
def create_ticket(inp: TicketIn) -> dict:
    return make_ticket(inp.subject or "", inp.body or "", inp.name or "Customer", inp.email or "",
                       time.time(), channel="portal", fields={"kind": inp.kind, **(inp.fields or {})})


def _log(t: dict, actor: str, action: str) -> None:
    t["history"].append({"at": _iso(time.time()), "actor": actor, "action": action})


@app.post("/tickets/{tid}/approve")
def approve(tid: str, inp: ActionIn | None = None) -> dict:
    inp = inp or ActionIn()
    t = _get(tid)
    reply = inp.reply or t["copilot"].get("text") or t["triage"].get("draft_reply")
    if not reply:
        raise HTTPException(400, "no draft to send; pass 'reply'")
    t["final_reply"] = reply[:MAX_CHARS]
    t["status"] = "Closed"
    t["assigned_to"] = inp.agent or "You"
    agent = inp.agent or "You"
    _log(t, agent, "Approved & sent reply" + (" (edited)" if inp.reply else ""))
    _close_loop(t, reply, agent, human_written=bool(inp.reply) and inp.reply.strip() != (
        (t["copilot"].get("text") or t["triage"].get("draft_reply") or "").strip()))
    return t


def _close_loop(t: dict, reply: str, agent: str, human_written: bool) -> None:
    """After a human resolves a ticket (real mode only):
    * human-written or edited reply -> learning loop: becomes a LIVE precedent (pipeline.resolve_ticket)
    * any approved reply            -> its problem is marked resolved in the problem database
    An unedited AI draft never becomes a precedent (the system must not learn from its own output)."""
    if MODE != "real" or _pipeline is None:
        return
    live_id = None
    if human_written:
        try:
            out = _pipeline.resolve_ticket(t["subject"] if t["subject"] != "(no subject)" else None, t["body"],
                                           reply, resolved_by=agent, queue=t["queue"], type_=t["type"],
                                           language=t["language"])
            live_id = out["ticket_id"]
            _log(t, "SentinelDesk", f"Resolution added to the knowledge base as {live_id}")
        except Exception as exc:  # noqa: BLE001
            _log(t, "SentinelDesk", f"Could not add the resolution to the knowledge base: {exc}")
    pid = (t.get("problem") or {}).get("problem_id")
    if pid is not None:
        try:
            from sentineldesk import store
            store.resolve_problem(pid, reply, agent, precedent_id=live_id)
            if t.get("problem"):
                t["problem"]["status"] = "resolved"
            _log(t, "SentinelDesk", f"Problem #{pid} marked resolved in the problem database")
        except Exception as exc:  # noqa: BLE001
            _log(t, "SentinelDesk", f"Could not update the problem database: {exc}")


@app.post("/tickets/{tid}/reject")
def reject(tid: str, inp: ActionIn | None = None) -> dict:
    inp = inp or ActionIn()
    t = _get(tid)
    t["status"] = "In Progress"
    t["final_reply"] = None
    t["assigned_to"] = inp.agent or "You"
    _log(t, inp.agent or "You", f"Rejected AI draft{': ' + inp.reason if inp.reason else ''}")
    return t


@app.post("/tickets/{tid}/assign")
def assign(tid: str, inp: ActionIn | None = None) -> dict:
    inp = inp or ActionIn()
    t = _get(tid)
    t["assigned_to"] = inp.agent or "You"
    if t["status"] == "New":
        t["status"] = "In Progress"
    _log(t, inp.agent or "You", "Assigned to self")
    return t


_OVERVIEW: dict = {}


@app.get("/overview")
def overview() -> dict:
    """Knowledge-base facts for the customer site's homepage (read once from the retrieval index)."""
    if not _OVERVIEW:
        try:
            import pandas as pd
            kb = pd.read_parquet(ROOT / "artifacts" / "kb_meta.parquet",
                                 columns=["queue", "language", "type", "priority"])
            _OVERVIEW.update({
                "kb_tickets": int(len(kb)),
                "queues": int(kb["queue"].nunique()),
                "languages": int(kb["language"].nunique()),
                "high_incident_pct": round(float(((kb["priority"] == "high") & (kb["type"] == "Incident")).mean()) * 100),
            })
        except Exception:  # artifacts not built yet: the homepage hides the numbers
            return {"kb_tickets": None, "queues": None, "languages": None, "high_incident_pct": None}
    return _OVERVIEW


# ---------------------------------------------------------------- assignment rules (admin console)
class RulesIn(BaseModel):
    rules: list[dict]


def _rules_payload(state: dict) -> dict:
    """Rules plus how many tickets in the queue each enabled rule would match right now."""
    rules = state["rules"]
    hits = {r["id"]: 0 for r in rules}
    with LOCK:
        items = list(TICKETS.values())
    for t in items:
        pred = {"queue": t.get("routing", {}).get("predicted_queue") or t["triage"]["queue"]["label"],
                "type": t["triage"]["type"]["label"], "priority": t["triage"]["priority"]["label"],
                "language": t["language"]}
        m = assignment_rules.first_match(rules, t["subject"], t["body"], pred)
        if m:
            hits[m["id"]] += 1
    groups = sorted({t["triage"]["queue"]["label"] for t in items} | set(QUEUES) |
                    {r["action"]["group"] for r in rules if r["action"]["group"]})
    return {**state, "hits": hits, "tickets": len(items), "groups": groups, "assignees": AGENTS}


QUEUES = ["Billing and Payments", "Customer Service", "General Inquiry", "Human Resources", "IT Support",
          "Product Support", "Returns and Exchanges", "Sales and Pre-Sales", "Service Outages and Maintenance",
          "Technical Support"]


@app.get("/rules")
def get_rules() -> dict:
    return _rules_payload(assignment_rules.load())


@app.put("/rules")
def put_rules(inp: RulesIn) -> dict:
    """Replace the rule list. Applies to tickets created from now on."""
    try:
        return _rules_payload(assignment_rules.save(inp.rules))
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/rules/reset")
def reset_rules() -> dict:
    return _rules_payload(assignment_rules.reset())


class RuleTestIn(TriageIn):
    rules: Optional[list[dict]] = None     # unsaved edits from the editor; None = the saved rules


@app.post("/rules/test")
def test_rules(inp: RuleTestIn) -> dict:
    """Dry run: triage the text (nothing stored, outage detector not fed) and show where it would go."""
    subject, body = (inp.subject or "")[:MAX_CHARS], (inp.body or "")[:MAX_CHARS]
    if not body.strip():
        raise HTTPException(422, "add a ticket body")
    try:
        rules = assignment_rules._clean(inp.rules) if inp.rules is not None else assignment_rules.load()["rules"]
    except ValueError as e:
        raise HTTPException(422, str(e))
    res, _ = run_triage(subject, body, track_burst=False, record=False)
    r = result_to_dict(res)
    pred = {"queue": r["queue"]["label"], "type": r["type"]["label"], "priority": r["priority"]["label"],
            "language": r["language"]}
    rule = assignment_rules.first_match(rules, subject, body, pred)
    group, prio, _ = assignment_rules.apply(rule, pred["queue"], pred["priority"], "", "New")
    return {"predicted": pred, "gate_status": r.get("status"), "rule": rule, "group": group, "priority": prio}


# ---------------------------------------------------------------- escalation gate policy (read-only)
@app.get("/gate/policy")
def gate_policy() -> dict:
    """The live gate thresholds, and the validation sweep that chose them (reports/escalation_sweep.*)."""
    sweep = _read_json("escalation_sweep.json")
    points = []
    try:
        import pandas as pd
        df = pd.read_csv(ROOT / "reports" / "escalation_sweep.csv")
        df = df.drop_duplicates(["auto_share", "high_incident_escalated", "auto_queue_accuracy"])
        df["meets_rule"] = (df.high_incident_escalated >= 0.95) & (df.auto_queue_accuracy >= 0.75)
        points = json.loads(df.to_json(orient="records"))
    except Exception:
        pass
    return {
        "live": {
            "critical_score_min": config.CRITICAL_SCORE_MIN,
            "min_confidence": config.MIN_CONFIDENCE,
            "min_top1_similarity": config.MIN_TOP1_SIMILARITY,
            "min_mean_top3_similarity": config.MIN_MEAN_TOP3_SIMILARITY,
            "high_priority_threshold": config.HIGH_PRIORITY_THRESHOLD,
            "burst": {"similarity": config.BURST_SIM, "min_count": config.BURST_MIN_COUNT,
                      "window_min": config.BURST_WINDOW_S // 60},
        },
        "sweep": {k: sweep.get(k) for k in ("n_val", "true_high_incidents", "rule", "n_combinations",
                                            "n_meeting_rule", "chosen", "previous_setting")} | {"previous": sweep.get("previous_setting")},
        "points": points,
    }


def _read_json(name: str) -> dict:
    try:
        return json.loads((ROOT / "reports" / name).read_text())
    except Exception:
        return {}


@app.get("/metrics")
def metrics() -> dict:
    items = list(TICKETS.values())
    by_priority: dict[str, int] = {"high": 0, "medium": 0, "low": 0}
    by_queue: dict[str, int] = {}
    by_status: dict[str, int] = {}
    lat = []
    for t in items:
        by_priority[t["priority"]] = by_priority.get(t["priority"], 0) + 1
        by_queue[t["queue"]] = by_queue.get(t["queue"], 0) + 1
        by_status[t["status"]] = by_status.get(t["status"], 0) + 1
        lat.append(t["triage"]["latency_ms"].get("total", 0))
    total = len(items)
    escalated = sum(1 for t in items if t["escalated"])
    auto = total - escalated
    tm = _read_json("triage_metrics.json")
    burst_ids = [t["id"] for t in items if t["triage"].get("burst", {}).get("active")]
    return {
        "mode": MODE,
        "total": total,
        "auto_resolved": auto,
        "escalated": escalated,
        "escalation_rate": round(escalated / total, 4) if total else 0,
        "avg_latency_ms": round(sum(lat) / len(lat), 1) if lat else 0,
        "by_priority": by_priority,
        "by_queue": dict(sorted(by_queue.items(), key=lambda kv: -kv[1])),
        "by_status": by_status,
        "kpi": {
            "high_priority_incident_recall":
                tm.get("high_priority_incident", {}).get("recall_predicted_high_and_incident"),
        },
        "major_incident": {"active": bool(burst_ids), "ticket_ids": burst_ids},
        # holdout model numbers (scripts/evaluate.py) and the problem database
        "model": {
            "n_holdout": tm.get("n_holdout"),
            "macro_f1": {h: (tm.get(h) or {}).get("macro_f1") for h in ("type", "queue", "priority", "language")},
            "ece": {h: (tm.get(h) or {}).get("ece") for h in ("type", "queue", "priority", "language")},
            "per_language": tm.get("per_language") or {},
            "high_incident_recall_classifier": tm.get("high_priority_incident", {}).get("recall_predicted_high"),
            "gate": {k: (tm.get("pipeline") or {}).get(k) for k in (
                "status_share", "draft_share", "high_incident_escalated_by_gate", "top1_same_queue",
                "median_top1_similarity", "cross_lingual_share_unaided", "latency_ms_p50_drafted")},
        },
        "problem_db": _db_stats(),
    }


def _db_stats() -> dict | None:
    try:
        from sentineldesk import store
        return store.stats()
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------- problem database (store.py)
class ResolveIn(BaseModel):
    resolution: str
    agent: Optional[str] = "You"


def _store():
    from sentineldesk import store
    return store


def _tickets_of_problem() -> dict[int, list[dict]]:
    """problem_id -> the queue tickets filed under it (newest first), from the in-memory ticket store."""
    with LOCK:
        items = list(TICKETS.values())
    out: dict[int, list[dict]] = {}
    for t in sorted(items, key=lambda x: x["created_at"], reverse=True):
        pid = (t.get("problem") or {}).get("problem_id")
        if pid is None:
            continue
        out.setdefault(int(pid), []).append({
            "id": t["id"], "subject": t["subject"], "status": t["status"], "priority": t["priority"],
            "created_at": t["created_at"], "requester": t["requester"]["name"],
            "email": t["requester"]["email"], "assigned_to": t["assigned_to"], "queue": t["queue"]})
    return out


@app.get("/problems")
def problems(status: Optional[str] = None) -> dict:
    """Every distinct problem (newest activity first) plus database counts."""
    rows = _store().problems(limit=500)
    if status in ("open", "resolved"):
        rows = [r for r in rows if r["status"] == status]
    by_problem = _tickets_of_problem()
    for r in rows:   # who is affected, from the tickets currently in the queue
        ts = by_problem.get(int(r["problem_id"]), [])
        r["queue_tickets"] = ts[:8]
        r["queue_ticket_count"] = len(ts)
        r["people"] = len({x["email"] or x["requester"] for x in ts})
    return {"stats": _store().stats(), "problems": rows}


@app.get("/problems/search")
def problems_search(q: str) -> dict:
    """Read-only: most related stored problems and KB precedents for a description. Records nothing."""
    q = (q or "").strip()[:MAX_CHARS]
    if not q:
        raise HTTPException(400, "empty query")
    if MODE != "real":
        raise HTTPException(503, "search needs the real pipeline (artifacts missing or SD_MOCK=1)")
    from sentineldesk import retrieve
    from sentineldesk.embed import encode
    vec = encode([q], is_query=True)[0]
    prec = retrieve.search(vec, 5, include_live=True, query_text=q) if retrieve.is_ready() else []
    return {"problems": _store().search(vec, k=5),
            "precedents": [{"ticket_id": p.ticket_id, "score": round(float(p.score), 4), "language": p.language,
                            "subject": p.subject, "answer": p.answer[:400]} for p in prec]}


@app.get("/problems/{pid}")
def problem_detail(pid: int) -> dict:
    p = _store().get_problem(pid)
    if not p:
        raise HTTPException(404, f"problem {pid} not found")
    return {**p, "tickets": _store().problem_tickets(pid), "queue_tickets": _tickets_of_problem().get(pid, [])}


@app.post("/problems/{pid}/resolve")
def problem_resolve(pid: int, inp: ResolveIn) -> dict:
    if not _store().get_problem(pid):
        raise HTTPException(404, f"problem {pid} not found")
    try:
        _store().resolve_problem(pid, inp.resolution, inp.agent or "You")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return problem_detail(pid)


@app.post("/problems/{pid}/reopen")
def problem_reopen(pid: int) -> dict:
    if not _store().get_problem(pid):
        raise HTTPException(404, f"problem {pid} not found")
    _store().reopen_problem(pid)
    return problem_detail(pid)


@app.get("/logs")
def logs(limit: int = 200) -> list[dict]:
    """The triage log: every live ticket the pipeline handled (PII-masked)."""
    return _store().recent_logs(limit=min(max(limit, 1), 1000))
