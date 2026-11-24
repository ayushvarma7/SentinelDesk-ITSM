"""Core-problem scenario (Track A + P3): repeated incidents -> one Problem + a major-incident promotion.

    PYTHONPATH=src python tests/test_major_incident.py

A live stream inside one 30-minute window: four core problems, each reported 3-4 times in different
words (EN + DE), interleaved with unrelated one-off tickets. Hand-written for this test, not from
the holdout. Scored on:
  * grouping (rootcause.py): pairwise precision / recall of "same core problem"
  * promotion: is each core problem raised as a major incident / shared root cause by its 3rd report?
  * false alarms: do one-off tickets ever get grouped or promoted?
  * known history: does a core problem link to a known KB Problem record?
"""
import os as _os, tempfile as _tempfile  # keep test/demo tickets out of the real problem database
_os.environ.setdefault("SD_DB_PATH", _tempfile.mkdtemp(prefix="sd_db_") + "/scratch.db")
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sentineldesk import pipeline, rootcause  # noqa: E402
from sentineldesk.pipeline import triage  # noqa: E402

# (core problem, subject, body), in arrival order
STREAM = [
    ("outlook", "Outlook mail", "Since this morning Outlook does not receive any new emails, the inbox stays empty."),
    ("vpn", "VPN", "The VPN connection drops every few minutes and we lose access to internal systems."),
    ("other", "Invoice copy", "Could you please send me a copy of my last invoice for our accounting?"),
    ("outlook", "Mails missing", "I am not getting any emails in Outlook anymore, new messages never arrive."),
    ("payment", "Payments failing", "Card payments in our online shop are failing for all customers since 10am."),
    ("vpn", "VPN instabil", "Die VPN-Verbindung bricht ständig ab, wir erreichen die internen Systeme nicht."),
    ("other", "Dark mode", "Could you add a dark mode to the dashboard? Our users would like it."),
    ("printer", "Printer", "The office printer shows a paper jam error and nothing prints."),
    ("outlook", "Keine E-Mails", "In Outlook kommen seit heute früh keine neuen E-Mails mehr an."),
    ("payment", "Checkout error", "Customers report that checkout fails with a payment error, no orders go through."),
    ("vpn", "Remote access down", "Remote staff cannot stay connected to the VPN, it keeps disconnecting."),
    ("other", "Slack question", "Does your project software integrate with Slack?"),
    ("printer", "Drucker", "Der Drucker im Büro meldet einen Papierstau und druckt nichts mehr."),
    ("payment", "Zahlungen", "Kartenzahlungen in unserem Webshop schlagen seit 10 Uhr für alle Kunden fehl."),
    ("other", "Training", "Do you offer webinars for new users of the analytics module?"),
    ("printer", "Printing broken", "Nothing prints from the office printer, it reports a jam."),
    ("outlook", "Inbox not updating", "Our Outlook inbox is not updating, incoming mail is stuck."),
    ("other", "Address change", "We moved offices, how do I update the billing address?"),
]


def run():
    pipeline.BURST.clear()
    rootcause.GROUPER.reset()
    rows = []
    for core, s, b in STREAM:
        r = triage(s, b)                      # live mode: burst + grouping both tracked
        rc, bu = r.root_cause, (r.burst or {})
        rows.append({"core": core, "subject": s, "type": r.type.label, "status": r.status,
                     "live_id": rc.group_ticket_ids[-1] if rc and rc.group_ticket_ids else None,
                     "burst_id": bu.get("live_id"), "burst_related": list(bu.get("related") or []),
                     "promoted": bool(bu.get("active")) or bool(rc and rc.suggest_problem),
                     "known_problem": rc.known_problem.ticket_id if rc and rc.known_problem else None})
    gid = {x.ticket_id: x.gid for x in rootcause.GROUPER.recent}           # final groups after merging
    for row in rows:
        row["group"] = gid.get(row["live_id"])
    pipeline.BURST.clear()
    rootcause.GROUPER.reset()
    return rows


def pairwise(rows, same):
    """Precision/recall over ticket pairs: predicted same-group vs truly same core problem."""
    tp = fp = fn = 0
    for a, b in itertools.combinations(range(len(rows)), 2):
        truth = rows[a]["core"] == rows[b]["core"] != "other"
        pred = same(rows[a], rows[b])
        tp += truth and pred
        fp += pred and not truth
        fn += truth and not pred
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    return p, r, tp, fp, fn


def test_core_problem_scenario():
    rows = run()
    print(f"  {'#':>2} {'core':8s} {'pred type':9s} {'status':16s} {'group':5s} promoted  known_problem  subject")
    for i, r in enumerate(rows, 1):
        print(f"  {i:2d} {r['core']:8s} {r['type']:9s} {r['status']:16s} {str(r['group'] or '-'):5s} "
              f"{'YES' if r['promoted'] else '-':8s}  {str(r['known_problem'] or '-'):13s}  {r['subject']}")

    # Grouping (rootcause.py): only tickets the classifier called Incident/Problem are grouped.
    g = [r for r in rows if r["group"] is not None]
    gp, gr, *_ = pairwise(g, lambda a, b: a["group"] == b["group"])
    # Burst (burst.py): an edge whenever a ticket lists an earlier one as related.
    by_id = {r["burst_id"]: i for i, r in enumerate(rows)}
    by_id.update({r["live_id"]: i for i, r in enumerate(rows) if r["live_id"]})   # banner from root-cause groups
    parent = list(range(len(rows)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for i, r in enumerate(rows):
        for rel in r["burst_related"]:
            parent[find(i)] = find(by_id[rel])
    bp, br, *_ = pairwise(rows, lambda a, b: find(rows.index(a)) == find(rows.index(b)))

    cores = sorted({r["core"] for r in rows} - {"other"})
    promoted_by_3rd = {c: any(r["promoted"] for r in [x for x in rows if x["core"] == c][:3]) for c in cores}
    promoted_any = {c: any(r["promoted"] for r in rows if r["core"] == c) for c in cores}
    false_alarms = [r["subject"] for r in rows if r["core"] == "other" and r["promoted"]]
    # promoted before the 3rd report of its own core problem = triggered by unrelated tickets
    premature = []
    for c in cores:
        for k, r in enumerate([x for x in rows if x["core"] == c]):
            if r["promoted"] and k < 2:
                premature.append(f"{r['subject']} (report {k + 1} of {c})")
    linked = {c: sorted({r["known_problem"] for r in rows if r["core"] == c and r["known_problem"]}) for c in cores}

    print(f"\n  grouping (rootcause, {len(g)}/{len(rows)} tickets typed as issues): precision {gp:.2f}  recall {gr:.2f}")
    print(f"  major-incident banner links:                         precision {bp:.2f}  recall {br:.2f}")
    print(f"  promoted to major incident / shared root cause by 3rd report: {promoted_by_3rd}")
    print(f"  promoted at any point: {promoted_any}")
    print(f"  one-off tickets promoted: {false_alarms or 'none'}")
    print(f"  promoted too early (before 3 reports of the same problem): {premature or 'none'}")
    print(f"  known KB Problem linked: {linked}")
    return {"group_precision": gp, "group_recall": gr, "burst_precision": bp, "burst_recall": br,
            "promoted_any": promoted_any, "false_alarms": false_alarms, "premature": premature}


if __name__ == "__main__":
    print("test_core_problem_scenario:")
    m = test_core_problem_scenario()
    assert not m["false_alarms"], f"one-off tickets were promoted: {m['false_alarms']}"
    print("\nscenario finished (see metrics above)")
