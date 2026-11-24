"""Re-pick the gate's confidence floors against BOTH distributions.

    PYTHONPATH=src python scripts/gate_calibrate.py

Why this exists. scripts/gate_sweep.py sweeps on the 10% KB validation slice and chose
type 0.75 / queue 0.50 / priority 0.70. Those are correct for the data they were measured on,
but the dataset is synthetic: its tickets sit closer to the KB and draw higher classifier
confidence than anything a person types. Measured on dev: that setting auto-drafts 28% of
holdout tickets and 0 of 8 hand-typed ones. Judges type hand-typed tickets, so the gate as
tuned would show an escalation badge and never a grounded draft.

So the same precompute-then-sweep machinery runs over two sets at once:

  validation   2,286 KB rows held out of heads.joblib — real labels, so the safety metric
               (share of true high-priority Incidents escalated) is measurable here.
  hand-typed   tests/handtyped_calibration.json — written by hand, no labels, but each ticket
               is marked as one that SHOULD auto-draft or one the gate MUST stop.

Selection rule, fixed BEFORE running (extends the original sweep's by two clauses):
  1. validation: at least 95% of true high-priority Incidents escalated   [safety]
  2. validation: at least 25% of tickets auto-drafted                     [usefulness]
  3. hand-typed: every expect=escalate ticket escalated                   [NEW, safety]
  4. hand-typed: at least 60% of expect=auto tickets auto-drafted         [NEW, demo works]
  5. then the highest queue accuracy among auto-drafted validation tickets [tiebreak]

Similarity floors stay fixed, as in the first sweep — they are already hand-typed calibrated.
Writes reports/gate_calibrate.csv and reports/gate_calibrate.json.
"""
import itertools
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from sentineldesk import classify, config, gate, retrieve
from sentineldesk.data import build_text, load_kb
from sentineldesk.embed import encode
from sentineldesk.schema import Prediction

REPORTS = config.ROOT / "reports"
HANDTYPED = Path(__file__).resolve().parent.parent / "tests" / "handtyped_calibration.json"

# Retargeted after the critical-score rule and the drafting stage landed. The type and priority floors are now 0.0 in
# config — critical_score carries the safety job — so sweeping them is sweeping nothing. The
# knobs that actually move the gate today are the queue floor, the critical-score threshold,
# and the top-1 similarity floor.
GRID = {
    "queue": [0.0, 0.15, 0.25, 0.35, 0.50],
    "critical": [0.05, 0.10, 0.15, 0.20, 0.30],
    "min_top1": [0.845, 0.855, 0.865, 0.875],
}

MIN_HIGH_INCIDENT_ESCALATED = 0.95
MIN_VAL_AUTO_SHARE = 0.25
MIN_HAND_AUTO_SHARE = 0.60


def heads_and_precedents(E, texts, bundle, drop_ticket_ids=None, kb_ids=None):
    """Classifier heads + retrieved precedents for a batch, as the gate will see them."""
    preds = {}
    for h, (classes, P) in classify.predict_proba(bundle, E, texts).items():
        idx = classify.decide(classes, P, h, bundle["high_threshold"])
        preds[h] = (classes[idx], P[np.arange(len(idx)), idx])

    precs = []
    for i in range(len(texts)):
        hits = retrieve.search(E[i], config.TOP_K + 1, str(preds["queue"][0][i]),
                               include_live=False, language=str(preds["language"][0][i]))
        if drop_ticket_ids is not None:
            hits = [p for p in hits if p.ticket_id != kb_ids[drop_ticket_ids[i]]]
        precs.append(hits[: config.TOP_K])

    heads = [{h: Prediction(str(preds[h][0][i]), float(preds[h][1][i]))
              for h in ("type", "queue", "priority")} for i in range(len(texts))]
    return preds, heads, precs


def escalations(texts, heads, precs, th):
    return np.array([gate.evaluate(texts[i], heads[i]["type"], heads[i]["queue"],
                                   heads[i]["priority"], precs[i], th)[0]
                     for i in range(len(texts))])


def main() -> None:
    bundle = classify.load()
    kb = load_kb()
    kb_texts = np.array([build_text(s, b) for s, b in zip(kb["subject"], kb["body"])], dtype=object)
    Eq = np.load(config.KB_QUERY_EMB_PATH)

    perm = np.random.RandomState(config.RANDOM_SEED).permutation(len(kb))
    val = perm[: max(1, int(config.VAL_FRACTION * len(kb)))]
    v = kb.iloc[val].reset_index(drop=True)
    vt = list(kb_texts[val])
    print(f"[cal] validation slice: {len(val):,} KB tickets")

    t0 = time.time()
    _, vheads, vprecs = heads_and_precedents(Eq[val], vt, bundle,
                                             drop_ticket_ids=val, kb_ids=kb["ticket_id"].to_numpy())
    print(f"[cal] validation retrieval in {time.time() - t0:.0f}s")

    hand = json.loads(HANDTYPED.read_text())["tickets"]
    ht = [build_text(t["subject"], t["body"]) for t in hand]
    Eh = encode(ht, is_query=True)
    _, hheads, hprecs = heads_and_precedents(Eh, ht, bundle)
    want_auto = np.array([t["expect"] == "auto" for t in hand])
    print(f"[cal] hand-typed: {want_auto.sum()} expect auto-draft, {(~want_auto).sum()} must escalate")

    true_hi = ((v["priority"] == "high") & (v["type"] == "Incident")).to_numpy()
    queue_ok = np.array([h["queue"].label for h in vheads]) == v["queue"].to_numpy(dtype=object)

    rows = []
    t0 = time.time()
    for cq, crit, s1 in itertools.product(*GRID.values()):
        th = {"min_confidence": {"type": config.MIN_CONFIDENCE["type"], "queue": cq,
                                 "priority": config.MIN_CONFIDENCE["priority"]},
              "critical_score_min": crit,
              "min_top1_similarity": s1}
        vesc = escalations(vt, vheads, vprecs, th)
        hesc = escalations(ht, hheads, hprecs, th)
        vauto = ~vesc
        rows.append({
            "queue": cq, "critical": crit, "min_top1": s1,
            "val_auto_share": round(float(vauto.mean()), 3),
            "val_high_incident_escalated": round(float(vesc[true_hi].mean()), 3),
            "val_auto_queue_accuracy": round(float(queue_ok[vauto].mean()), 3) if vauto.any() else 0.0,
            "hand_auto_share": round(float((~hesc[want_auto]).mean()), 3),
            "hand_critical_escalated": round(float(hesc[~want_auto].mean()), 3),
        })
    print(f"[cal] {len(rows)} combinations in {time.time() - t0:.0f}s")

    df = pd.DataFrame(rows).sort_values("val_auto_queue_accuracy", ascending=False)
    REPORTS.mkdir(exist_ok=True)
    df.to_csv(REPORTS / "gate_calibrate.csv", index=False)

    ok = df[(df.val_high_incident_escalated >= MIN_HIGH_INCIDENT_ESCALATED)
            & (df.val_auto_share >= MIN_VAL_AUTO_SHARE)
            & (df.hand_critical_escalated >= 1.0)
            & (df.hand_auto_share >= MIN_HAND_AUTO_SHARE)]

    print(f"\n[cal] {len(ok)} of {len(df)} settings satisfy all five clauses")
    if not len(ok):
        print("[cal] NO setting satisfies the rule. Closest by hand_auto_share:")
        print(df[(df.val_high_incident_escalated >= MIN_HIGH_INCIDENT_ESCALATED)
                 & (df.hand_critical_escalated >= 1.0)]
              .sort_values("hand_auto_share", ascending=False).head(8).to_string(index=False))
        out = {"chosen": None, "reason": "no setting met all five clauses"}
    else:
        best = ok.iloc[0]
        print(ok.head(8).to_string(index=False))
        out = {"rule": [
                   f"val high-Incident escalated >= {MIN_HIGH_INCIDENT_ESCALATED}",
                   f"val auto share >= {MIN_VAL_AUTO_SHARE}",
                   "hand-typed critical escalated == 1.0",
                   f"hand-typed benign auto share >= {MIN_HAND_AUTO_SHARE}",
                   "then max val auto queue accuracy"],
               "n_meeting_rule": int(len(ok)),
               "n_validation": int(len(val)),
               "n_handtyped": len(hand),
               "chosen": {k: float(best[k]) if k in ("queue", "critical", "min_top1") else best[k]
                          for k in ("queue", "critical", "min_top1", "val_auto_share",
                                    "val_high_incident_escalated", "val_auto_queue_accuracy",
                                    "hand_auto_share", "hand_critical_escalated")}}
        print(f"\n[cal] CHOSEN  queue={best['queue']} critical_score_min={best['critical']} "
              f"min_top1={best['min_top1']}")

    (REPORTS / "gate_calibrate.json").write_text(json.dumps(out, indent=2, default=float))


if __name__ == "__main__":
    main()
