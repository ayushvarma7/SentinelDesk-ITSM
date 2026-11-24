"""OWNER: P3. Picks the gate's confidence thresholds on the 10% KB validation slice P1 held out
(never the holdout).

    PYTHONPATH=src python scripts/gate_sweep.py

* Validation slice = first 10% of RandomState(RANDOM_SEED).permutation(len(kb)), the exact rows
  scripts/train_classifier.py kept out of heads.joblib, so classifier confidences are honest.
* Retrieval is the REAL retrieve.search() (P2's index, queue filter, cross-lingual slot, dedup),
  with include_live=False and each ticket's own KB row removed from its results.
* Every combination goes through the real gate.evaluate() with the retrieved precedents.

Similarity floors are NOT swept here. KB tickets sit unusually close to each other (the dataset is
synthetic): validation top-1 p25 is 0.931, but hand-typed in-domain tickets score 0.845-0.90.
Floors picked from KB percentiles escalate 100% of what a person types. So MIN_TOP1_SIMILARITY /
MIN_MEAN_TOP3_SIMILARITY stay at the hand-typed calibration in config.py (P2, docs/p3_workdone.md),
and the sweep picks the confidence floors under those fixed similarity floors.

Selection rule, fixed BEFORE the sweep ran:
  1. at least 95% of true high-priority Incidents escalated,
  2. at least 25% of tickets auto-drafted,
  3. then the highest queue accuracy among auto-drafted tickets (ties: larger auto share).

Writes reports/gate_sweep.csv and reports/gate_sweep.json (the CHOSEN values go into config.py).
"""
import itertools
import json
import time

import numpy as np
import pandas as pd

from sentineldesk import classify, config, gate, retrieve
from sentineldesk.data import build_text, load_kb
from sentineldesk.schema import Prediction

REPORTS = config.ROOT / "reports"

# The plan's grid (type .35-.55, queue .20-.40, priority .30-.50) cannot reach 95% high-Incident
# escalation with this classifier (its confidences are higher than the TF-IDF baseline's), so the
# grid extends upward. The rule did not change.
CONF_GRID = {"type": (0.35, 0.45, 0.55, 0.65, 0.75), "queue": (0.20, 0.30, 0.40, 0.50),
             "priority": (0.30, 0.40, 0.50, 0.60, 0.70)}


def kb_query_embeddings(kb, texts):
    ids_path = config.KB_QUERY_EMB_PATH.with_name("kb_query_ids.npy")
    if not (config.KB_QUERY_EMB_PATH.exists() and ids_path.exists()
            and np.array_equal(np.load(ids_path), kb["ticket_id"].to_numpy(dtype=str))):
        raise SystemExit("artifacts/kb_query_embeddings.npy missing or stale: "
                         "run PYTHONPATH=src python scripts/train_classifier.py first")
    return np.load(config.KB_QUERY_EMB_PATH)


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    if not retrieve.is_ready():
        retrieve.build_index()
    kb = load_kb()
    texts = np.array([build_text(s, b) for s, b in zip(kb["subject"], kb["body"])], dtype=object)
    Eq = kb_query_embeddings(kb, texts)

    perm = np.random.RandomState(config.RANDOM_SEED).permutation(len(kb))
    val = perm[: max(1, int(config.VAL_FRACTION * len(kb)))]        # same slice as train_classifier.py
    v = kb.iloc[val].reset_index(drop=True)
    vt = list(texts[val])
    print(f"[sweep] validation slice: {len(val):,} KB tickets (held out of heads.joblib)")

    bundle = classify.load()
    preds = {}
    for h, (classes, P) in classify.predict_proba(bundle, Eq[val], vt).items():
        idx = classify.decide(classes, P, h, bundle["high_threshold"])
        preds[h] = (classes[idx], P[np.arange(len(idx)), idx])

    t0 = time.time()
    precs = []
    for i, j in enumerate(val):
        hits = retrieve.search(Eq[j], config.TOP_K + 1, str(preds["queue"][0][i]), include_live=False,
                               language=str(preds["language"][0][i]))
        precs.append([p for p in hits if p.ticket_id != kb.at[j, "ticket_id"]][: config.TOP_K])
    print(f"[sweep] retrieval for {len(val):,} tickets in {time.time() - t0:.0f}s")
    top1 = np.array([p[0].score for p in precs])
    mean3 = np.array([np.mean([x.score for x in p[:3]]) for p in precs])
    heads = [{h: Prediction(str(preds[h][0][i]), float(preds[h][1][i])) for h in ("type", "queue", "priority")}
             for i in range(len(val))]

    pcts = (5, 10, 25)
    print("[sweep] validation top-1 similarity:", {f"p{q}": round(float(np.percentile(top1, q)), 4) for q in pcts})
    print(f"[sweep] fixed floors: top-1 {config.MIN_TOP1_SIMILARITY}, mean top-3 {config.MIN_MEAN_TOP3_SIMILARITY} "
          f"(fire on {np.mean(top1 < config.MIN_TOP1_SIMILARITY):.1%} / "
          f"{np.mean(mean3 < config.MIN_MEAN_TOP3_SIMILARITY):.1%} of validation tickets)")

    true_hi = ((v["priority"] == "high") & (v["type"] == "Incident")).to_numpy()
    queue_ok = preds["queue"][0] == v["queue"].to_numpy(dtype=object)

    rows = []
    t0 = time.time()
    for ct, cq, cp in itertools.product(*CONF_GRID.values()):
        th = {"min_confidence": {"type": ct, "queue": cq, "priority": cp}}
        esc = np.array([gate.evaluate(vt[i], heads[i]["type"], heads[i]["queue"], heads[i]["priority"],
                                      precs[i], th)[0] for i in range(len(val))])
        auto = ~esc
        rows.append({"type": ct, "queue": cq, "priority": cp,
                     "auto_share": round(float(auto.mean()), 3),
                     "high_incident_escalated": round(float(esc[true_hi].mean()), 3),
                     "auto_queue_accuracy": round(float(queue_ok[auto].mean()), 3) if auto.any() else 0.0})
    print(f"[sweep] {len(rows)} combinations in {time.time() - t0:.0f}s")

    df = pd.DataFrame(rows)
    ok = df[(df.high_incident_escalated >= 0.95) & (df.auto_share >= 0.25)]
    if len(ok):
        best = ok.sort_values(["auto_queue_accuracy", "auto_share"], ascending=False).iloc[0]
    else:   # nothing meets the rule: safety first, take the most high-Incident escalation
        print("[sweep] WARNING: no combination meets the rule; picking max high_incident_escalated")
        best = df.sort_values(["high_incident_escalated", "auto_share"], ascending=False).iloc[0]
    df.sort_values("auto_queue_accuracy", ascending=False).to_csv(REPORTS / "gate_sweep.csv", index=False)

    summary = {
        "n_val": int(len(val)),
        "rule": "high_incident_escalated >= 0.95 and auto_share >= 0.25, then max auto_queue_accuracy",
        "n_meeting_rule": int(len(ok)),
        "retrieval": "retrieve.search(include_live=False), own row removed",
        "top1_sim_percentiles": {f"p{q}": round(float(np.percentile(top1, q)), 4) for q in pcts},
        "fixed_similarity_floors": {"min_top1_similarity": config.MIN_TOP1_SIMILARITY,
                                    "min_mean_top3_similarity": config.MIN_MEAN_TOP3_SIMILARITY},
        "overall_queue_accuracy": round(float(queue_ok.mean()), 3),
        "true_high_incidents": int(true_hi.sum()),
        "chosen": {k: (x.item() if hasattr(x, "item") else x) for k, x in best.to_dict().items()},
    }
    (REPORTS / "gate_sweep.json").write_text(json.dumps(summary, indent=2))
    print(df.sort_values("auto_queue_accuracy", ascending=False).head(10).to_string(index=False))
    print("\nCHOSEN:", json.dumps(summary["chosen"], indent=2))
    print(f"overall queue accuracy {summary['overall_queue_accuracy']} vs auto-drafted "
          f"{summary['chosen']['auto_queue_accuracy']}")


if __name__ == "__main__":
    main()
