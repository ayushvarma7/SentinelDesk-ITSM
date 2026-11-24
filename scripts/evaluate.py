"""Holdout evaluation. The ONLY legitimate caller of data.load_test_labels().

    PYTHONPATH=src python scripts/evaluate.py

Run once per frozen model, never to pick settings (settings are chosen on the KB validation slice
by scripts/train_classifier.py).

Current sections:
  * triage heads: macro-F1, accuracy, ECE per head; high-priority Incident recall
  * gate + retrieval + latency (added by P2 once retrieve/generate landed): escalation recall on
    high-priority Incidents, auto-draft share, retrieval agreement, p50/p95 end-to-end latency.
    That section samples SD_EVAL_PIPELINE_N tickets (default 200) because it runs the full pipeline.

Writes reports/triage_metrics.json.
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score

from sentineldesk import classify, config, embed  # noqa: F401  (embed used in pipeline_section)
from sentineldesk.data import build_text, load_test_inputs, load_test_labels
from sentineldesk.embed import encode

REPORTS = config.ROOT / "reports"


def ece(conf: np.ndarray, correct: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(correct[m].mean() - conf[m].mean())
    return float(total)


def pipeline_section(inputs, labels) -> dict:
    """OWNER: P2. End-to-end gate, retrieval and latency numbers for the README.

    Runs the real pipeline, so it is sampled rather than full-holdout. Two
    settings matter for honesty:
      track_burst=False  — a sequential eval loop would otherwise trip the burst
                           detector and inflate the escalation rate;
      include_live       — retrieval uses the frozen KB only, via config, so the
                           number cannot move because someone used the console.
    """
    import os
    import time

    from sentineldesk import retrieve
    from sentineldesk.pipeline import triage

    n = int(os.getenv("SD_EVAL_PIPELINE_N", "200"))
    if retrieve.live_count():
        raise SystemExit("live store is not empty — retrieve.clear_live() before evaluating")

    sample = inputs.sample(n=min(n, len(inputs)), random_state=11)
    truth = labels.loc[sample["ticket_id"]]

    triage(sample.iloc[0]["subject"], sample.iloc[0]["body"], track_burst=False)   # warm up

    rows = []
    for (_, t), (_, g) in zip(sample.iterrows(), truth.iterrows()):
        t0 = time.perf_counter()
        r = triage(t["subject"], t["body"], track_burst=False)
        rows.append({
            "escalated": r.escalate,
            "status": r.status,
            "drafted": bool(r.draft_reply),
            "true_high_incident": g["priority"] == "high" and g["type"] == "Incident",
            "top1_sim": r.precedents[0].score if r.precedents else 0.0,
            "top1_same_queue": bool(r.precedents) and r.precedents[0].queue == g["queue"],
            # The reserved slot guarantees a cross-lingual hit, so that share is
            # 1.0 by construction and says nothing. Measure the UNAIDED rate too.
            "cross_lingual_forced": any(p.language != r.language for p in r.precedents),
            "cross_lingual_unaided": any(
                h.language != r.language
                for h in retrieve.search(embed.encode([build_text(t["subject"], t["body"])],
                                                      is_query=True)[0],
                                         config.TOP_K, include_live=False,
                                         cross_lingual_slots=0)),
            "latency_ms": (time.perf_counter() - t0) * 1000,
        })

    df = pd.DataFrame(rows)
    hi = df[df["true_high_incident"]]
    auto = df[~df["escalated"]]
    return {
        "n_sampled": len(df),
        "auto_draft_share": round(float((~df["escalated"]).mean()), 4),
        "high_incident_support": int(len(hi)),
        "high_incident_escalated_by_gate": round(float(hi["escalated"].mean()), 4) if len(hi) else None,
        "top1_same_queue": round(float(df["top1_same_queue"].mean()), 4),
        "top1_same_queue_auto_drafted": round(float(auto["top1_same_queue"].mean()), 4) if len(auto) else None,
        "median_top1_similarity": round(float(df["top1_sim"].median()), 4),
        "cross_lingual_share_forced": round(float(df["cross_lingual_forced"].mean()), 4),
        "cross_lingual_share_unaided": round(float(df["cross_lingual_unaided"].mean()), 4),
        # Escalated tickets skip the LLM entirely, so an overall p50 flatters the
        # system. The number that matters for the demo is the drafted one.
        # three-tier outcome (gate.decide) and how often an operator gets a draft to work with
        "status_share": {s: round(float((df["status"] == s).mean()), 4)
                         for s in ("AUTO_DRAFT_READY", "HUMAN_REVIEW", "ESCALATE_ONCALL")},
        "draft_share": round(float(df["drafted"].mean()), 4),
        "high_incident_sent_oncall": round(float((hi["status"] == "ESCALATE_ONCALL").mean()), 4) if len(hi) else None,
        "latency_ms_p50_all": round(float(df["latency_ms"].quantile(0.50)), 1),
        "latency_ms_p95_all": round(float(df["latency_ms"].quantile(0.95)), 1),
        "latency_ms_p50_drafted": round(float(auto["latency_ms"].quantile(0.50)), 1) if len(auto) else None,
        "latency_ms_p95_drafted": round(float(auto["latency_ms"].quantile(0.95)), 1) if len(auto) else None,
    }


def main() -> None:
    inputs = load_test_inputs()                       # ticket_id, subject, body only
    texts = [build_text(s, b) for s, b in zip(inputs["subject"], inputs["body"])]
    X = encode(texts, is_query=True, show_progress=True)

    bundle = classify.load()
    proba = classify.predict_proba(bundle, X, texts)
    pred = {}
    for h, (classes, P) in proba.items():
        idx = classify.decide(classes, P, h, bundle["high_threshold"])
        pred[h] = (classes[idx], P[np.arange(len(idx)), idx])

    labels = load_test_labels().set_index("ticket_id").loc[inputs["ticket_id"]]   # align by id
    res = {"n_holdout": len(inputs), "high_threshold": bundle["high_threshold"], "C": bundle["C"]}
    for h, (lab, conf) in pred.items():
        y = labels[h].to_numpy()
        res[h] = {"macro_f1": round(f1_score(y, lab, average="macro"), 4),
                  "accuracy": round(accuracy_score(y, lab), 4),
                  "ece": round(ece(conf, (y == lab).astype(float)), 4)}
        print(f"\n=== {h} ===\n" + classification_report(y, lab, digits=3, zero_division=0))

    # Confusion matrices (rows = true, columns = predicted) and per-language macro-F1, for the dashboard.
    order = {"priority": ["high", "medium", "low"], "type": ["Incident", "Problem", "Request", "Change"],
             "language": ["en", "de"]}
    res["confusion"] = {}
    for h in ("type", "priority", "queue"):
        labs = order.get(h) or sorted(set(labels[h]) | set(pred[h][0]))
        res["confusion"][h] = {"labels": labs,
                               "matrix": confusion_matrix(labels[h].to_numpy(), pred[h][0], labels=labs).tolist()}
    lang = labels["language"].to_numpy()
    res["per_language"] = {lg: {"n": int((lang == lg).sum()),
                                **{h: round(f1_score(labels[h].to_numpy()[lang == lg], pred[h][0][lang == lg],
                                                     average="macro"), 4) for h in ("type", "queue", "priority")}}
                           for lg in ("en", "de")}

    true_hi = (labels["priority"].to_numpy() == "high") & (labels["type"].to_numpy() == "Incident")
    pred_hi = pred["priority"][0] == "high"
    pred_inc = pred["type"][0] == "Incident"
    pred_crit = np.isin(pred["type"][0], config.CRITICAL_TYPES)        # the gate's hard rule
    res["high_priority_incident"] = {
        "support": int(true_hi.sum()),
        "recall_predicted_high": round(float(pred_hi[true_hi].mean()), 4),
        "recall_predicted_high_and_incident": round(float((pred_hi & pred_inc)[true_hi].mean()), 4),
        "recall_gate_hard_rule": round(float((pred_hi & pred_crit)[true_hi].mean()), 4),
        "gate_hard_rule_types": list(config.CRITICAL_TYPES),
        "share_of_tickets_hard_escalated": round(float((pred_hi & pred_crit).mean()), 4)}

    res["pipeline"] = pipeline_section(inputs, labels)

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "triage_metrics.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
