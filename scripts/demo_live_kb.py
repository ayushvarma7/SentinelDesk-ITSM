"""Walk the frozen-KB / live-store loop end to end.

    PYTHONPATH=src python scripts/demo_live_kb.py
"""
import os as _os, tempfile as _tempfile  # keep test/demo tickets out of the real problem database
_os.environ.setdefault("SD_DB_PATH", _tempfile.mkdtemp(prefix="sd_db_") + "/scratch.db")
from sentineldesk import config, embed, retrieve
from sentineldesk.pipeline import resolve_ticket, triage
from sentineldesk.text import build_text

NEW = ("Qubit calibration drift on the Q-series SDK",
       "Our qubit calibration drifts within 20 minutes of each run and gate fidelity "
       "falls below 0.9. This started after we moved to the Q-series SDK.")
RESOLUTION = ("Known issue with Q-series SDK 3.1: the calibration cache is not invalidated "
              "between runs. Set QSERIES_CACHE_TTL=0 and re-run the calibration routine. "
              "Fidelity returns to spec within one cycle.")
FOLLOW_UP = ("Question about Q-series SDK calibration drift",
             "We are evaluating the Q-series SDK and noticed the calibration drifts after "
             "about 20 minutes. Could you advise what setting controls this? No rush.")


def show(label, subject, body):
    r = triage(subject, body)
    print(f"\n  {label}")
    print(f"    triage     : {r.type.label} / {r.queue.label} / {r.priority.label}")
    print(f"    top-1 sim  : {r.precedents[0].score:.4f}  ({r.precedents[0].ticket_id})")
    print(f"    escalate   : {r.escalate}")
    for x in r.escalation_reasons:
        print(f"      - {x}")
    return r


def main():
    retrieve.clear_live()
    print("=" * 74)
    print(f"FROZEN KB: {len(retrieve.load_index()['meta']):,} resolved tickets   "
          f"LIVE STORE: {retrieve.live_count()}   min_sim={config.MIN_TOP1_SIMILARITY}")
    print("=" * 74)

    print("\n[1] A ticket arrives about something the KB has never seen.")
    show("incoming", *NEW)

    print("\n[2] A human resolves it. The resolution becomes a precedent.")
    new_id = resolve_ticket(NEW[0], NEW[1], resolution=RESOLUTION,
                            resolved_by="demo-agent")["ticket_id"]
    print(f"    added {new_id}   LIVE STORE: {retrieve.live_count()}   "
          f"(frozen KB untouched: {len(retrieve.load_index()['meta']):,})")

    print("\n[3] A different customer reports the same thing, worded differently.")
    r = show("incoming", *FOLLOW_UP)
    cited = [p.ticket_id for p in r.precedents]
    print(f"    precedents : {cited}")
    print(f"    -> {'CITES THE NEW PRECEDENT' if new_id in cited else 'did not retrieve it'}")

    print("\n[4] Evaluation is unaffected: include_live=False ignores the live store.")
    q = embed.encode([build_text(*FOLLOW_UP)], is_query=True)[0]
    froz = retrieve.search(q, k=3, include_live=False)
    live = retrieve.search(q, k=3, include_live=True)
    print(f"    with live  : {[(p.ticket_id, round(p.score, 3)) for p in live]}")
    print(f"    frozen only: {[(p.ticket_id, round(p.score, 3)) for p in froz]}")

    retrieve.clear_live()
    print("\n[5] clear_live() wipes the session. Frozen index never changed.\n")


if __name__ == "__main__":
    main()
