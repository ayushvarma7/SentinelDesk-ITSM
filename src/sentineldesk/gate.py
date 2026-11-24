"""The escalation gate: deterministic rules, no LLM in the decision path.

Every rule returns a sentence a human can read off the badge, which is the whole
point: any escalation can be explained in one line.

Layers of defence against adversarial tickets (regex is only the first):
  1. RISK_PATTERNS below: injection, credential requests, destructive actions, legal
     threats and money commitments, in English and German. Hard risks always escalate,
     so the LLM never sees an injection attempt at all.
  2. The generation prompt fences the ticket as untrusted data.
  3. Post-generation checks: citations must be in the retrieved set and figures must
     appear in a precedent (generate.verify_citations), else unverified_claims is set.
"""
from __future__ import annotations

import re

from . import config
from .generate import unsupported_figures  # noqa: F401  (defined in generate, re-exported here)
from .schema import Precedent, Prediction, RootCause

# Tuned on tests/test_adversarial.py: all 19 attacks caught, 0 false alarms on the 7 look-alikes.
RISK_PATTERNS: dict[str, str] = {
    "prompt_injection": (
        r"ignore (all |any )?(the )?(previous|prior|above|your|earlier) (instructions|rules|prompts?)"
        r"|disregard (all |any )?(your|the|previous|prior|above) (rules|instructions)"
        r"|forget (everything|all|your) (above|instructions|rules)"
        r"|new instructions\s*:|system prompt|developer mode|you are now\b"
        r"|reveal your (prompt|instructions)"
        r"|act as (an? )?(admin|developer|system)"
        r"|ignoriere (alle |deine )?(vorherigen |bisherigen )?(anweisungen|regeln)"
        r"|vergiss (alle |deine )?(anweisungen|regeln)"
        r"|neue anweisungen\s*:"
    ),
    "credential_request": (
        r"(send|give|tell|share|provide|email)( me| us)? (the |your |an? |our )?(admin |root |master )?"
        r"(password|passwords|credentials|login details|api key|root access)"
        r"|(admin|root) (password|credentials)"
        r"|(schicken|senden|geben|nennen) sie (mir|uns) (bitte )?(die |das |alle )?"
        r"(admin-|admin |root-|master-)?(zugangsdaten|anmeldedaten|passwort|passwörter|admin-passwort)"
        r"|(zugangsdaten|passwort|admin-passwort) (senden|schicken|geben)"
    ),
    "destructive_action": (
        r"delete (all|every|the entire|our entire|my whole|our whole)\b.{0,30}"
        r"(data|records|database|accounts?|files|users)"
        r"|wipe (all|the|our|my|everything)|drop (table|database)|purge (all|the|our)"
        r"|löschen sie (alle|sämtliche)"
        r"|(alle|sämtliche) (unsere[nr]? )?(daten|datensätze|kundendaten|konten)\b.{0,30}löschen"
        r"|datenbank löschen"
    ),
    "legal": (
        r"\blawsuit\b|legal action|\battorney\b|\blawyer\b|\bsue\b|\bcourt\b"
        r"|anwalt|\bklage|\bgericht(?!et)|rechtliche schritte"
    ),
    "financial_commitment": (
        r"refund|reimburs|compensat|chargeback|money back|guarantee"
        r"|rückerstattung|erstattung|entschädigung|gutschrift|garantie"
    ),
}
_RISK_RE = {k: re.compile(p, re.I) for k, p in RISK_PATTERNS.items()}

# Always escalate, regardless of precedent: these must never be auto-drafted.
HARD_RISKS = ("prompt_injection", "credential_request", "destructive_action", "legal")

RISK_REASONS = {
    "prompt_injection": "Out of scope: instruction-override attempt detected (prompt injection)",
    "credential_request": "Security: request for passwords or credentials",
    "destructive_action": "Security: request for a destructive bulk action (delete/wipe data)",
    "legal": "Legal threat or legal language: route to a human",
}

# Explicit outage + urgency language: a critical incident even when the priority head says
# "medium". Both must match. On the KB this fires on 0.55% of tickets, 83% of which are high
# priority (base rate 39%) and 78% high-priority Incidents.
_OUTAGE_RE = re.compile(
    r"\b(outage|is down|are down|went down|keeps dropping|offline|not reachable|cannot reach|can't reach"
    r"|unreachable|ausfall|ausgefallen|nicht erreichbar|funktioniert nicht mehr)\b", re.I)
_URGENCY_RE = re.compile(
    r"\b(immediately|urgent(ly)?|asap|critical|emergency|patient(s)?|production down|all users"
    r"|sofort|dringend|kritisch|notfall)\b", re.I)


def urgent_outage(text: str | None) -> bool:
    """True when the ticket reports an outage AND uses urgency language. Pure function."""
    t = text or ""
    return bool(_OUTAGE_RE.search(t) and _URGENCY_RE.search(t))


_ACTION_RE = [re.compile(p, re.I) for p in config.UNSUPPORTED_ACTION_PATTERNS]
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def detect_risks(text: str | None) -> list[str]:
    """Names of every risk pattern that matches, in RISK_PATTERNS order. Pure function."""
    t = text or ""
    return [k for k, r in _RISK_RE.items() if r.search(t)]


def critical_score(type_: Prediction, priority: Prediction) -> float:
    """P(high) x P(Incident or Problem) from the classifier's full distributions. Pure function.

    0.0 when the predictions carry no all_probs (stubs, hand-built test Predictions), so the
    rule never fires on missing data.
    """
    p_high = priority.all_probs.get("high", 0.0)
    p_issue = sum(type_.all_probs.get(t, 0.0) for t in config.CRITICAL_TYPES)
    return float(p_high * p_issue)


def too_little_text(text: str | None) -> bool:
    """True when there is nothing to triage (empty, emoji only, a lone URL or number)."""
    t = re.sub(r"https?://\S+|www\.\S+", " ", text or "")
    return len(_LETTER.findall(t)) < config.MIN_LETTERS


def evaluate_detailed(
    text: str,
    type_: Prediction,
    queue: Prediction,
    priority: Prediction,
    precedents: list[Precedent],
    thresholds: dict | None = None,
    burst: dict | None = None,
    root_cause: RootCause | None = None,
) -> list[tuple[str, str]]:
    """Every escalation reason with its severity, in badge order: [(severity, reason), ...].

    Severity (see SEVERITIES): "oncall" -> ESCALATE_ONCALL, no draft; "block" -> HUMAN_REVIEW, no draft;
    "review" -> HUMAN_REVIEW with a draft for a human to approve.

    thresholds may override min_confidence / min_top1_similarity / min_mean_top3_similarity
    (scripts/escalation_sweep.py uses this).
    burst is the burst detector's state for this ticket ({"active": bool, "related": [...]}).
    """
    t = thresholds or {}
    min_conf = {**config.MIN_CONFIDENCE, **t.get("min_confidence", {})}
    min_top1 = t.get("min_top1_similarity", config.MIN_TOP1_SIMILARITY)
    min_mean3 = t.get("min_mean_top3_similarity", config.MIN_MEAN_TOP3_SIMILARITY)

    out: list[tuple[str, str]] = []

    def add(severity: str, reason: str) -> None:
        out.append((severity, reason))
    risks = detect_risks(text)

    # 0. Adversarial or high-stakes content. Checked first so it is the top reason on the badge.
    for r in HARD_RISKS:
        if r in risks:
            add("block", RISK_REASONS[r])

    # 1. The brief's hard rule. EDA: fires on 17.2% of tickets on its own.
    #    Incident and Problem both mean "service is broken" (Problem = root cause of incidents) and the
    #    classifier confuses them, so both count (config.CRITICAL_TYPES).
    crit_min = t.get("critical_score_min", config.CRITICAL_SCORE_MIN)
    crit = critical_score(type_, priority)
    if priority.label == "high" and type_.label in config.CRITICAL_TYPES:
        add("oncall", f"Critical incident (high priority + {type_.label}): on-call required")
    elif urgent_outage(text):
        add("oncall", "Critical incident (reported outage with urgency): on-call required")
    # 1a. The probability-level version of rule 1. Catches high-priority incidents the
    #     argmax labels missed (e.g. labelled medium or Request), so the confidence floors below
    #     no longer have to be set high to act as that safety net.
    elif crit_min is not None and crit >= crit_min:
        add("oncall", f"Likely critical incident (P(high) x P(Incident/Problem) = {crit:.2f} "
                       f">= {crit_min:.2f}): on-call required")

    # 1b. Many near-identical tickets in a short window: probably a major incident.
    if burst and burst.get("active"):
        n = len(burst.get("related", [])) + 1
        add("oncall", f"Possible major incident: {n} similar tickets in the last "
                       f"{config.BURST_WINDOW_S // 60} min")

    # 1c. Nothing to work with (empty, emoji only, a bare URL).
    if too_little_text(text):
        add("block", "Too little text to triage: needs a human to read it")

    # 2. Low classifier confidence on any head.
    for name, pred in (("type", type_), ("queue", queue), ("priority", priority)):
        floor = min_conf.get(name, 0.5)
        if pred.confidence < floor:
            add("review", 
                f"Low classifier confidence ({name}: {pred.confidence:.2f} < {floor:.2f})"
            )

    # 3 & 4. No precedent to ground a reply in.
    if not precedents:
        add("block", "No historical precedent retrieved")
    else:
        top1 = precedents[0].score
        if top1 < min_top1:
            add("review", 
                f"No sufficiently similar precedent (best match {top1:.4f} < {min_top1:.4f})"
            )
        top3 = [p.score for p in precedents[:3]]
        mean3 = sum(top3) / len(top3)
        if mean3 < min_mean3:
            add("review", f"Weak precedent support (mean top-3 {mean3:.3f} < {min_mean3:.3f})")

    # 5. Commitments (refunds, SLA credits, cancellations) we cannot make unless a past
    #    resolution made them too. Not a hard block: refunds have real precedents.
    if "financial_commitment" in risks or any(r.search(text) for r in _ACTION_RE):
        evidence = " ".join(p.answer for p in precedents)
        supported = _RISK_RE["financial_commitment"].search(evidence) or any(
            r.search(evidence) for r in _ACTION_RE)
        if not supported:
            add("block", "Requests a refund/compensation or other commitment with no "
                           "supporting historical precedent")

    # 5b. Root cause: several live issues share one root cause. Skipped when the burst
    #     banner already fired, so the operator never sees two near-identical outage reasons.
    if (root_cause is not None and root_cause.suggest_problem
            and not (burst and burst.get("active"))):
        add("oncall", f"Probable shared root cause: {root_cause.group_size} similar issues in the last "
                       f"{config.ROOT_CAUSE_WINDOW_MIN} min — raise a Problem record")

    return out


# Severity -> what the operator sees. Only "review"-only tickets still get a draft.
SEVERITIES = {
    "oncall": "Critical: on-call engineer now; no draft",      # critical incident, outage burst, shared root cause
    "block": "Human review; no draft",                         # attacks, legal, unsupported commitments, nothing to work with
    "review": "Human review of an AI draft",                   # low confidence, weak precedent
}
AUTO, REVIEW, ONCALL = "AUTO_DRAFT_READY", "HUMAN_REVIEW", "ESCALATE_ONCALL"


def decide(detailed: list[tuple[str, str]]) -> tuple[str, bool]:
    """(status, draft_allowed) from evaluate_detailed() output. Pure function."""
    sev = {s for s, _ in detailed}
    if "oncall" in sev:
        return ONCALL, False
    if "block" in sev:
        return REVIEW, False
    return (REVIEW, True) if sev else (AUTO, True)


def evaluate(text, type_, queue, priority, precedents, thresholds=None, burst=None, root_cause=None):
    """Return (escalate, reasons). Reasons are empty iff escalate is False. Unchanged contract;
    use evaluate_detailed() + decide() for the three-tier status."""
    detailed = evaluate_detailed(text, type_, queue, priority, precedents, thresholds, burst, root_cause)
    return bool(detailed), [r for _, r in detailed]
