"""OWNER: P2. Retrieval sanity on holdout tickets, passage-side index.

Prints top-1 similarity percentiles (P3 needs these for min_sim), label
agreement and the cross-lingual share.

This is an EVALUATION script, so it is allowed to read holdout labels — same
status as scripts/evaluate.py. No label ever reaches the retrieval path: only
subject + body are encoded.

Run:  PYTHONPATH=src python scripts/retrieval_check.py
"""
import json

import numpy as np

from sentineldesk import config, data, embed, retrieve
from sentineldesk.text import build_text

N = 500


def main() -> None:
    import pandas as pd
    inputs = data.load_test_inputs().sample(n=N, random_state=0).reset_index(drop=True)
    labels = data.load_test_labels().set_index("ticket_id")
    # Precedent carries no `type`, so look it up from the index metadata.
    kb_type = pd.read_parquet(config.KB_META_PATH).set_index("ticket_id")["type"]

    texts = [build_text(s, b) for s, b in zip(inputs["subject"], inputs["body"])]
    Q = embed.encode(texts, is_query=True, show_progress=True)

    top1_sims, same_queue, same_type, other_lang = [], [], [], []
    for i, qv in enumerate(Q):
        hits = retrieve.search(qv, k=5, include_live=False, cross_lingual_slots=0)  # unaided retrieval
        truth = labels.loc[inputs["ticket_id"][i]]
        top1_sims.append(hits[0].score)
        same_queue.append(hits[0].queue == truth["queue"])
        same_type.append(kb_type.get(hits[0].ticket_id) == truth["type"])
        other_lang.append(np.mean([h.language != truth["language"] for h in hits]))

    sims = np.array(top1_sims)
    res = {
        "n": len(sims),
        "top1_sim_percentiles": {f"p{q}": round(float(np.percentile(sims, q)), 4)
                                 for q in (1, 5, 10, 25, 50, 75, 95)},
        "top1_same_queue": round(float(np.mean(same_queue)), 4),
        "top1_same_type": round(float(np.mean(same_type)), 4),
        "top5_other_language_share": round(float(np.mean(other_lang)), 4),
    }
    out = config.ROOT / "reports"
    out.mkdir(parents=True, exist_ok=True)
    json.dump(res, open(out / "retrieval_check.json", "w"), indent=2)
    print(json.dumps(res, indent=2))
    print("\nSuggested min_sim for P3 (p10):", res["top1_sim_percentiles"]["p10"])


if __name__ == "__main__":
    main()
