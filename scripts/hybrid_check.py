"""Does keyword + vector (hybrid) retrieval beat vector-only? KB validation slice only.

    PYTHONPATH=src python scripts/hybrid_check.py

Queries: the 2,286 held-out KB validation tickets, routed exactly like the pipeline (predicted queue
filter, predicted language, cross-lingual slot), each ticket's own KB row removed from its results.
Weights: HYBRID_LEXICAL_WEIGHT in {0 (dense only), 0.5, 1, 2}.

Selection rule, fixed BEFORE running: adopt hybrid only if (top-1 same queue + top-1 same type)
improves by >= 0.01 over dense-only; then the best such weight (ties: smaller weight).
Also prints three hand-typed probes, including the "VPN ... hospital staff" miss.
Writes reports/hybrid_check.json.
"""
import json

import numpy as np

from sentineldesk import classify, config, retrieve
from sentineldesk.data import build_text, load_kb
from sentineldesk.embed import encode

WEIGHTS = (0.0, 0.5, 1.0, 2.0)
PROBES = [
    ("en", "The VPN connection keeps dropping every few minutes for our hospital staff."),
    ("en", "Outlook stopped syncing my mailbox, no new mails arrive."),
    ("de", "Unsere Rechnung für März wurde doppelt abgebucht, bitte prüfen Sie das."),
]


def main() -> None:
    kb = load_kb()
    texts = np.array([build_text(s, b) for s, b in zip(kb["subject"], kb["body"])], dtype=object)
    Eq = np.load(config.KB_QUERY_EMB_PATH)
    val = np.random.RandomState(config.RANDOM_SEED).permutation(len(kb))[: int(config.VAL_FRACTION * len(kb))]
    bundle = classify.load()
    pr = classify.predict_proba(bundle, Eq[val], list(texts[val]))
    pq = pr["queue"][0][pr["queue"][1].argmax(1)]
    pl = pr["language"][0][pr["language"][1].argmax(1)]
    retrieve.load_lexical()

    res = {}
    for w in WEIGHTS:
        config.HYBRID_LEXICAL_WEIGHT = w
        q1 = t1 = q5 = 0.0
        for n, j in enumerate(val):
            hits = retrieve.search(Eq[j], config.TOP_K + 1, str(pq[n]), include_live=False,
                                   language=str(pl[n]), query_text=str(texts[j]))
            hits = [h for h in hits if h.ticket_id != kb.at[j, "ticket_id"]][: config.TOP_K]
            meta_rows = kb.set_index("ticket_id").loc[[h.ticket_id for h in hits]] if hits else None
            if hits:
                q1 += meta_rows["queue"].iloc[0] == kb.at[j, "queue"]
                t1 += meta_rows["type"].iloc[0] == kb.at[j, "type"]
                q5 += float((meta_rows["queue"] == kb.at[j, "queue"]).mean())
        m = len(val)
        res[w] = {"top1_same_queue": round(q1 / m, 4), "top1_same_type": round(t1 / m, 4),
                  "top5_same_queue_share": round(q5 / m, 4)}
        print(f"[hybrid] weight {w:3.1f}: {res[w]}")

    base = res[0.0]["top1_same_queue"] + res[0.0]["top1_same_type"]
    gains = {w: res[w]["top1_same_queue"] + res[w]["top1_same_type"] - base for w in WEIGHTS}
    ok = [w for w in WEIGHTS if w > 0 and gains[w] >= 0.01]
    chosen = max(ok, key=lambda w: (round(gains[w], 4), -w)) if ok else 0.0
    print(f"[hybrid] gain over dense-only: { {w: round(g, 4) for w, g in gains.items()} }  ->  CHOSEN weight {chosen}")

    print("\n[hybrid] hand-typed probes, top-3 (subject or body start):")
    for lang, t in PROBES:
        q = encode([t], is_query=True)[0]
        for w in (0.0, chosen):
            config.HYBRID_LEXICAL_WEIGHT = w
            hits = retrieve.search(q, 3, include_live=False, language=lang, query_text=t)
            show = [(h.ticket_id, round(h.score, 3), (h.subject or h.body_snippet)[:38]) for h in hits]
            print(f"  w={w:3.1f} {t[:40]!r}: {show}")
    (config.ROOT / "reports" / "hybrid_check.json").write_text(
        json.dumps({"rule": "adopt if top1 queue+type gain >= 0.01; best weight, ties smaller",
                    "results": {str(w): r for w, r in res.items()}, "chosen_weight": chosen}, indent=2))


if __name__ == "__main__":
    main()
