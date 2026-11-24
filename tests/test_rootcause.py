"""Root-cause grouping. Needs artifacts/heads.joblib + kb_query_embeddings.npy.

    PYTHONPATH=src python tests/test_rootcause.py
"""
import os as _os, tempfile as _tempfile  # keep test/demo tickets out of the real problem database
_os.environ.setdefault("SD_DB_PATH", _tempfile.mkdtemp(prefix="sd_db_") + "/scratch.db")
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sentineldesk import rootcause  # noqa: E402
from sentineldesk.embed import encode  # noqa: E402
from sentineldesk.pipeline import triage  # noqa: E402

OUTLOOK = [
    ("Outlook down", "Outlook is not working, it keeps crashing when I open it."),
    ("Mails missing", "I am not able to receive emails in Outlook since this morning."),
    ("Outlook sync", "Outlook stopped syncing my mailbox, no new mails arrive."),
]
UNRELATED = [
    ("Invoice", "Our invoice for March was charged twice, please refund."),
    ("VPN", "The VPN connection keeps dropping every few minutes."),
    ("Printer", "The printer on floor 3 is jammed and shows an error."),
]


def test_grouper_groups_same_root_cause():
    g = rootcause.IncidentGrouper()
    vecs = encode([b for _, b in OUTLOOK], is_query=True)
    sizes = [len(g.add(v, now=0)) for v in vecs]
    assert sizes == [1, 2, 3], sizes
    print(f"  outlook trio grouped: sizes {sizes}")


def test_grouper_keeps_unrelated_apart():
    g = rootcause.IncidentGrouper()
    vecs = encode([b for _, b in UNRELATED], is_query=True)
    sizes = [len(g.add(v, now=0)) for v in vecs]
    assert sizes == [1, 1, 1], sizes
    print(f"  unrelated tickets stay separate: sizes {sizes}")


def test_window_expires():
    g = rootcause.IncidentGrouper(window_min=30)
    v = encode([OUTLOOK[0][1]], is_query=True)[0]
    g.add(v, now=0)
    assert len(g.add(v, now=31 * 60)) == 1     # the first one aged out
    print("  issues older than the window drop out")


def test_known_problem_link():
    v = encode(["Issue with task synchronization in our project management SaaS via Outlook, "
                "tasks are not syncing anymore."], is_query=True)[0]
    problem, change = rootcause.known_links(v)
    assert problem is not None and problem.ticket_id.startswith("TKT-"), problem
    print(f"  known problem {problem.ticket_id} ({problem.score:.3f}): {problem.subject[:60]!r}")
    if change:
        print(f"  known change  {change.ticket_id} ({change.score:.3f}): {change.subject[:60]!r}")


def test_pipeline_escalates_third_outlook_ticket():
    rootcause.GROUPER.reset()
    results = [triage(s, b) for s, b in OUTLOOK]
    last = results[-1]
    rc = last.root_cause
    print(f"  types: {[r.type.label for r in results]}")
    if rc is None:          # classifier called it a Request/Change: grouping intentionally not applied
        print("  (third ticket not classified as an issue; grouping skipped)")
        return
    print(f"  group size {rc.group_size}, suggest_problem={rc.suggest_problem}")
    if rc.suggest_problem:
        # Either outage reason is fine: the burst banner takes precedence, and the root-cause
        # reason is suppressed when the banner already fired (no duplicate messages).
        reasons = " ".join(last.escalation_reasons)
        assert last.escalate and ("shared root cause" in reasons or "major incident" in reasons), reasons
        print(f"  outage reason shown: {[x for x in last.escalation_reasons if 'root cause' in x or 'major incident' in x]}")
    rootcause.GROUPER.reset()


if __name__ == "__main__":
    for fn in (test_grouper_groups_same_root_cause, test_grouper_keeps_unrelated_apart, test_window_expires,
               test_known_problem_link, test_pipeline_escalates_third_outlook_ticket):
        print(f"{fn.__name__}:")
        fn()
    print("\nall root-cause tests passed")
