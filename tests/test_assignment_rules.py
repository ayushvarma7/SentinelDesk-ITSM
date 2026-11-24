"""Auto-assignment rules (api/assignment_rules.py): routing only, never weaker than the gate.

    PYTHONPATH=src python -m pytest -q tests/test_assignment_rules.py

The invariants that matter: first enabled match wins; a rule can raise the priority but never lower it;
an escalated ticket keeps its on-call assignee; a rule with no condition or no action is refused.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

import assignment_rules as ar  # noqa: E402

PRED = {"queue": "Technical Support", "type": "Incident", "priority": "medium", "language": "en"}


def test_defaults_are_valid():
    assert ar._clean(ar.DEFAULT_RULES)


def test_first_enabled_match_wins():
    r = ar.first_match(ar.DEFAULT_RULES, "Wi-Fi down", "Students cannot reach Canvas over the wifi.", PRED)
    assert r["id"] == "network"          # network is ordered before the Canvas rule on purpose


def test_disabled_rule_is_skipped():
    rules = ar._clean(ar.DEFAULT_RULES)
    hi = {**PRED, "priority": "high"}
    assert ar.first_match(rules, "", "Everything is broken", hi) is None   # vip-outage is off by default
    rules[-1]["enabled"] = True
    assert ar.first_match(rules, "", "Everything is broken", hi)["id"] == "vip-outage"


def test_prediction_conditions():
    r = ar.first_match(ar.DEFAULT_RULES, "Rechnung", "Doppelt abgebucht",
                       {**PRED, "queue": "Billing and Payments", "language": "de"})
    assert r["id"] == "billing-de"
    assert ar.first_match(ar.DEFAULT_RULES, "Invoice", "Charged twice",
                          {**PRED, "queue": "Billing and Payments"}) is None


def test_priority_only_goes_up():
    rule = next(r for r in ar.DEFAULT_RULES if r["id"] == "security")          # raises to high
    assert ar.apply(rule, "IT Support", "low", "Priya Shah", "New")[1] == "high"
    lower = ar._clean([{"name": "lower", "match": {"keywords": ["x"]}, "action": {"raise_priority": "low"}}])[0]
    assert ar.apply(lower, "IT Support", "high", "Priya Shah", "New")[1] == "high"


def test_escalated_ticket_keeps_on_call():
    rule = next(r for r in ar.DEFAULT_RULES if r["id"] == "hr-onboarding")     # sets an assignee
    group, _, who = ar.apply(rule, "Human Resources", "high", "On-call: Tom Fischer", "Escalated")
    assert group == "HR Systems" and who == "On-call: Tom Fischer"
    assert ar.apply(rule, "Human Resources", "medium", "Unassigned", "New")[2] == "Aisha Khan"


@pytest.mark.parametrize("bad", [
    [{"name": "", "match": {"keywords": ["a"]}, "action": {"group": "G"}}],                 # no name
    [{"name": "all", "match": {}, "action": {"group": "G"}}],                               # matches everything
    [{"name": "noop", "match": {"keywords": ["a"]}, "action": {}}],                         # no action
    [{"name": "p", "match": {"keywords": ["a"]}, "action": {"raise_priority": "urgent"}}],  # unknown priority
])
def test_invalid_rules_are_refused(bad):
    with pytest.raises(ValueError):
        ar._clean(bad)
