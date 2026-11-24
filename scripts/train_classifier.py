"""Train the triage heads (type, queue, priority, language) on the KB split.

    PYTHONPATH=src python scripts/train_classifier.py

Validation = first 10% of RandomState(RANDOM_SEED).permutation(len(kb)). The saved model is trained on
the other 90% only, so gate thresholds can be tuned honestly on the same slice. The holdout is never read.

Env switches for experiments (defaults = the frozen setting):
  SD_C=32            LogisticRegression C
  SD_EMB_WEIGHT=1.0  scale of the embedding block next to TF-IDF
  SD_TARGET_RECALL=0.80  validation high-priority recall the P(high) threshold must reach

Writes artifacts/heads.joblib, artifacts/triage_meta.json; appends to reports/experiments.csv.
Caches KB query embeddings in artifacts/kb_query_embeddings.npy (+ kb_query_ids.npy).
"""
import json
import os
import time

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score

from sentineldesk import classify, config
from sentineldesk.data import build_text, load_kb

REPORTS = config.ROOT / "reports"


def kb_query_embeddings(kb: pd.DataFrame, texts: list[str]) -> np.ndarray:
    ids = kb["ticket_id"].to_numpy(dtype=str)
    ids_path = config.KB_QUERY_EMB_PATH.with_name("kb_query_ids.npy")
    if config.KB_QUERY_EMB_PATH.exists() and ids_path.exists():
        if np.array_equal(np.load(ids_path), ids):
            print(f"[clf] reusing {config.KB_QUERY_EMB_PATH.name}")
            return np.load(config.KB_QUERY_EMB_PATH)
        print("[clf] cached embeddings are for a different KB order; re-encoding")
    from sentineldesk.embed import encode
    print(f"[clf] encoding {len(texts):,} KB tickets (is_query=True), a few minutes on CPU")
    E = encode(texts, is_query=True, show_progress=True)
    config.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    np.save(config.KB_QUERY_EMB_PATH, E)
    np.save(ids_path, ids)
    return E


def tune_threshold(p_high: np.ndarray, y_high: np.ndarray, target: float) -> float:
    """Highest threshold (0.05 grid) whose validation high recall still meets the target."""
    best = 0.05
    for t in np.round(np.arange(0.05, 0.951, 0.05), 2):
        if (p_high[y_high] >= t).mean() >= target:
            best = float(t)
    return best


def main() -> None:
    C = float(os.getenv("SD_C", config.CLASSIFIER_C))
    w = float(os.getenv("SD_EMB_WEIGHT", config.CLASSIFIER_EMB_WEIGHT))
    target = float(os.getenv("SD_TARGET_RECALL", config.HIGH_PRIORITY_TARGET_RECALL))

    kb = load_kb()
    texts = np.array([build_text(s, b) for s, b in zip(kb["subject"], kb["body"])], dtype=object)
    E = kb_query_embeddings(kb, list(texts))

    perm = np.random.RandomState(config.RANDOM_SEED).permutation(len(kb))
    n_val = max(1, int(config.VAL_FRACTION * len(kb)))
    va, tr = perm[:n_val], perm[n_val:]
    print(f"[clf] kb={len(kb):,} train={len(tr):,} val={len(va):,} C={C} emb_weight={w}")

    t0 = time.time()
    y_tr = {h: kb[h].to_numpy()[tr] for h in classify.HEADS}
    bundle = classify.fit(E[tr], y_tr, list(texts[tr]), C=C, emb_weight=w)

    proba = classify.predict_proba(bundle, E[va], list(texts[va]))
    val = {}
    for h, (classes, P) in proba.items():
        pred = classes[P.argmax(1)]
        val[h] = round(f1_score(kb[h].to_numpy()[va], pred, average="macro"), 4)
        print(f"[clf] {h:8s} val macro-F1={val[h]:.4f}")

    classes, P = proba["priority"]
    y_pri = kb["priority"].to_numpy()[va]
    y_high = y_pri == classify.HIGH
    thr = tune_threshold(P[:, list(classes).index(classify.HIGH)], y_high, target)
    tuned = classes[classify.decide(classes, P, "priority", thr)]
    tuned_stats = {"val_priority_macro_f1": round(f1_score(y_pri, tuned, average="macro"), 4),
                   "val_high_recall": round(float((tuned[y_high] == classify.HIGH).mean()), 4)}
    print(f"[clf] P(high) threshold={thr:.2f} {tuned_stats}  (trained in {time.time() - t0:.0f}s)")
    if abs(thr - config.HIGH_PRIORITY_THRESHOLD) > 1e-9:
        print(f"[clf] NOTE: tuned threshold {thr} differs from config.HIGH_PRIORITY_THRESHOLD; "
              "heads.joblib uses the tuned value; update config and tell the team")

    bundle["high_threshold"] = thr
    classify.save(bundle)
    meta = {"C": C, "emb_weight": w, "high_threshold": thr, "target_recall": target,
            "embed_model": config.EMBED_MODEL, "n_train": int(len(tr)), "n_val": int(len(va)),
            "val_macro_f1": val, **tuned_stats}
    (config.ARTIFACTS / "triage_meta.json").write_text(json.dumps(meta, indent=2))

    REPORTS.mkdir(exist_ok=True)
    log = REPORTS / "experiments.csv"
    row = {"time": time.strftime("%H:%M"), "C": C, "emb_weight": w,
           **{f"val_{h}": v for h, v in val.items()}, "threshold": thr, **tuned_stats}
    pd.DataFrame([row]).to_csv(log, mode="a", header=not log.exists(), index=False)
    print(f"[clf] wrote {config.HEADS_PATH.relative_to(config.ROOT)}, artifacts/triage_meta.json")


if __name__ == "__main__":
    main()
