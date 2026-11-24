"""Auto-assignment rules: the organisation's routing policy, editable from the admin console.

Ordered, first match wins (like assignment mappings in an ITSM tool). A rule matches on keywords in the
ticket text and on the model's predictions (queue, type, priority, language); empty fields match anything.
Its action sets the assignment group, can RAISE the priority (never lower it) and can name an assignee.

Rules change routing only. They never change the safety gate's decision: an escalated ticket stays
escalated and keeps its on-call assignee, whatever the rules say.

Defaults live in DEFAULT_RULES below; edits are saved to artifacts/assignment_rules.json (gitignored),
and "reset" goes back to the defaults.
"""
from __future__ import annotations

import json
import re
import threading
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "artifacts" / "assignment_rules.json"
PRIORITY_RANK = {"low": 0, "medium": 1, "high": 2}
MAX_RULES = 50
_LOCK = threading.Lock()


def _rule(id_, name, *, keywords=(), queue=(), type_=(), priority=(), language=(), group="",
          raise_priority="", assignee="", enabled=True, note=""):
    return {"id": id_, "name": name, "enabled": enabled, "note": note,
            "match": {"keywords": list(keywords), "queue": list(queue), "type": list(type_),
                      "priority": list(priority), "language": list(language)},
            "action": {"group": group, "raise_priority": raise_priority, "assignee": assignee}}


# A university IT desk's routing policy. Groups beyond the model's 10 queues are the point: the model
# predicts a generic queue, the organisation maps it onto its own teams.
DEFAULT_RULES = [
    _rule("security", "Security reports go to IT Security, at high priority",
          keywords=["phishing", "malware", "ransomware", "hacked", "compromised", "suspicious login",
                    "admin password", "ignore all previous instructions", "system prompt",
                    "Schadsoftware", "gehackt"],
          group="IT Security", raise_priority="high",
          note="Anything that looks like an attack is handled by the security team first."),
    _rule("network", "Wi-Fi and campus network go to Network Operations",
          keywords=["wi-fi", "wifi", "eduroam", "nuwave", "wlan", "ethernet", "campus network"],
          group="Network Operations"),
    _rule("identity", "Passwords, MFA and lockouts go to Identity and Access",
          keywords=["password", "passwort", "mfa", "two-factor", "locked out", "gesperrt", "login", "anmelden"],
          group="Identity and Access Management"),
    _rule("lms", "Canvas and course tools go to Academic Technology",
          keywords=["canvas", "blackboard", "gradebook", "assignment upload", "kurs"],
          group="Academic Technology"),
    _rule("print", "Printing goes to Campus Print Services",
          keywords=["printer", "printing", "drucker", "druckt"],
          group="Campus Print Services"),
    _rule("billing-de", "German billing tickets go to the DACH billing desk",
          queue=["Billing and Payments"], language=["de"],
          group="Billing (DACH)", note="Model routing plus language: no keywords needed."),
    _rule("hr-onboarding", "New-hire access requests go to HR Systems",
          keywords=["new employee", "new hire", "neuer mitarbeiter", "onboarding"],
          type_=["Request"], group="HR Systems", assignee="Aisha Khan"),
    _rule("vip-outage", "High-priority incidents in Technical Support page the duty manager",
          queue=["Technical Support"], type_=["Incident"], priority=["high"],
          assignee="Duty manager: Maria Gonzalez", enabled=False,
          note="Off by default: an example of a rule an organisation can switch on for out-of-hours cover."),
]


def _clean(rules: list[dict]) -> list[dict]:
    """Normalise and validate a rule list coming from the admin console. Raises ValueError."""
    if not isinstance(rules, list) or len(rules) > MAX_RULES:
        raise ValueError(f"rules must be a list of at most {MAX_RULES}")
    out, seen = [], set()
    for i, r in enumerate(rules):
        name = str(r.get("name", "")).strip()[:120]
        if not name:
            raise ValueError(f"rule {i + 1} needs a name")
        rid = re.sub(r"[^a-z0-9-]+", "-", str(r.get("id") or name).lower()).strip("-")[:40] or f"rule-{i + 1}"
        while rid in seen:
            rid += "-2"
        seen.add(rid)
        m, a = r.get("match") or {}, r.get("action") or {}
        lst = lambda v: [str(x).strip()[:60] for x in (v or []) if str(x).strip()][:30]  # noqa: E731
        match = {k: lst(m.get(k)) for k in ("keywords", "queue", "type", "priority", "language")}
        action = {"group": str(a.get("group") or "").strip()[:80],
                  "raise_priority": str(a.get("raise_priority") or "").strip().lower(),
                  "assignee": str(a.get("assignee") or "").strip()[:80]}
        if action["raise_priority"] and action["raise_priority"] not in PRIORITY_RANK:
            raise ValueError(f"rule '{name}': priority must be low, medium or high")
        if not (action["group"] or action["raise_priority"] or action["assignee"]):
            raise ValueError(f"rule '{name}' has no action: set a group, a priority or an assignee")
        if not any(match.values()):
            raise ValueError(f"rule '{name}' matches every ticket: add a keyword or a condition")
        out.append({"id": rid, "name": name, "enabled": bool(r.get("enabled", True)),
                    "note": str(r.get("note") or "")[:300], "match": match, "action": action})
    return out


def load() -> dict:
    with _LOCK:
        try:
            data = json.loads(STORE.read_text())
            return {"rules": _clean(data["rules"]), "updated_at": data.get("updated_at"), "customised": True}
        except Exception:  # no saved file (or a broken one): the defaults
            return {"rules": deepcopy(DEFAULT_RULES), "updated_at": None, "customised": False}


def save(rules: list[dict]) -> dict:
    clean = _clean(rules)
    with _LOCK:
        STORE.parent.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).isoformat()
        STORE.write_text(json.dumps({"rules": clean, "updated_at": stamp}, indent=2, ensure_ascii=False))
    return load()


def reset() -> dict:
    with _LOCK:
        STORE.unlink(missing_ok=True)
    return load()


def matches(rule: dict, text: str, pred: dict) -> bool:
    """pred: {"queue", "type", "priority", "language"} labels from triage."""
    m = rule["match"]
    low = text.lower()
    if m["keywords"] and not any(k.lower() in low for k in m["keywords"]):
        return False
    for field in ("queue", "type", "priority", "language"):
        if m[field] and pred.get(field) not in m[field]:
            return False
    return True


def first_match(rules: list[dict], subject: str, body: str, pred: dict) -> dict | None:
    text = f"{subject or ''}\n{body or ''}"
    return next((r for r in rules if r["enabled"] and matches(r, text, pred)), None)


def apply(rule: dict | None, queue: str, priority: str, assigned: str, status: str) -> tuple[str, str, str]:
    """Returns (assignment group, priority, assignee) after the rule. Never touches gate outcomes."""
    if not rule:
        return queue, priority, assigned
    a = rule["action"]
    group = a["group"] or queue
    up = a["raise_priority"]
    if up and PRIORITY_RANK[up] > PRIORITY_RANK.get(priority, 1):
        priority = up
    if a["assignee"] and status in ("New", "In Progress"):   # escalated stays with on-call
        assigned = a["assignee"]
    return group, priority, assigned
