"""Re-tunes the gate's confidence floors together with the critical-score rule (gate rule 1a)
on the 10% KB validation slice (never the holdout).

    PYTHONPATH=src python scripts/escalation_sweep.py

Why: with only argmax rules, the 95% high-priority-Incident target forced every confidence floor high
(type 0.75 / queue 0.50 / priority 0.70), because the floors were the only way to catch high-priority
Incidents the classifier mislabels. That escalated nearly every routine hand-typed ticket. Rule 1a
escalates on P(high) x P(Incident or Problem) directly, so the floors can go back to meaning
"the model is unsure".

Validation set-up: held-out KB slice, real retrieve.search() with the
ticket's own row removed, fixed hand-typed similarity floors.

Selection rule, fixed BEFORE the sweep ran:
  1. at least 95% of true high-priority Incidents escalated   (the safety bar, unchanged)
  2. queue accuracy on auto-drafted tickets at least 0.75     (routing quality of what we draft)
  3. then the largest auto-draft share (ties: higher auto queue accuracy)

Speed: rules that do not depend on the swept values are evaluated once per ticket through the real
gate.evaluate() (all floors 0, rule 1a off); the swept part is a vectorised OR on top. The chosen
setting is then re-checked ticket by ticket through the real gate.evaluate().

Writes reports/escalation_sweep.csv and reports/escalation_sweep.json.
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
GRID = {"critical": (None, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50),
        "type": (0.0, 0.35, 0.45, 0.55, 0.65, 0.75),
        "queue": (0.0, 0.20, 0.25, 0.30, 0.40, 0.50),
        "priority": (0.0, 0.30, 0.40, 0.50, 0.60, 0.70)}
# The gate before the critical-score rule (confidence floors only), scored again for the comparison chart.
PREVIOUS_SETTING = {"critical": None, "type": 0.75, "queue": 0.50, "priority": 0.70}
OFF = {"min_confidence": {"type": 0.0, "queue": 0.0, "priority": 0.0}, "critical_score_min": None}


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    kb = load_kb()
    texts = np.array([build_text(s, b) for s, b in zip(kb["subject"], kb["body"])], dtype=object)
    ids = np.load(config.KB_QUERY_EMB_PATH.with_name("kb_query_ids.npy"))
    assert np.array_equal(ids, kb["ticket_id"].to_numpy(dtype=str)), "run scripts/train_classifier.py"
    Eq = np.load(config.KB_QUERY_EMB_PATH)

    perm = np.random.RandomState(config.RANDOM_SEED).permutation(len(kb))
    val = perm[: max(1, int(config.VAL_FRACTION * len(kb)))]          # same slice as train_classifier.py
    v = kb.iloc[val].reset_index(drop=True)
    vt = list(texts[val])

    bundle = classify.load()
    heads, labels = [dict() for _ in val], {}
    for h, (classes, P) in classify.predict_proba(bundle, Eq[val], vt).items():
        idx = classify.decide(classes, P, h, bundle["high_threshold"])
        labels[h] = classes[idx]
        for i in range(len(val)):
            heads[i][h] = Prediction(str(classes[idx[i]]), float(P[i, idx[i]]),
                                     {str(c): float(p) for c, p in zip(classes, P[i])})

    t0 = time.time()
    precs = []
    for i, j in enumerate(val):
        hits = retrieve.search(Eq[j], config.TOP_K + 1, str(labels["queue"][i]), include_live=False,
                               language=str(labels["language"][i]))
        precs.append([p for p in hits if p.ticket_id != kb.at[j, "ticket_id"]][: config.TOP_K])
    print(f"[sweep] {len(val):,} validation tickets, retrieval in {time.time() - t0:.0f}s")

    def gate_eval(i, th):
        return gate.evaluate(vt[i], heads[i]["type"], heads[i]["queue"], heads[i]["priority"], precs[i], th)

    fixed = np.array([gate_eval(i, OFF)[0] for i in range(len(val))])
    conf = {h: np.array([heads[i][h].confidence for i in range(len(val))]) for h in ("type", "queue", "priority")}
    crit = np.array([gate.critical_score(heads[i]["type"], heads[i]["priority"]) for i in range(len(val))])
    true_hi = ((v["priority"] == "high") & (v["type"] == "Incident")).to_numpy()
    queue_ok = labels["queue"] == v["queue"].to_numpy(dtype=object)
    print(f"[sweep] rules independent of the swept values escalate {fixed.mean():.1%} "
          f"and catch {fixed[true_hi].mean():.1%} of true high-priority Incidents")

    def score(c):
        esc = fixed | (conf["type"] < c["type"]) | (conf["queue"] < c["queue"]) | (conf["priority"] < c["priority"])
        if c["critical"] is not None:
            esc = esc | (crit >= c["critical"])
        auto = ~esc
        return {**{k: c[k] for k in GRID},
                "auto_share": round(float(auto.mean()), 4),
                "high_incident_escalated": round(float(esc[true_hi].mean()), 4),
                "auto_queue_accuracy": round(float(queue_ok[auto].mean()), 4) if auto.any() else 0.0}, esc

    rows = [score(dict(zip(GRID, combo)))[0] for combo in itertools.product(*GRID.values())]
    df = pd.DataFrame(rows)
    ok = df[(df.high_incident_escalated >= 0.95) & (df.auto_queue_accuracy >= 0.75)]
    best = ok.sort_values(["auto_share", "auto_queue_accuracy"], ascending=False).iloc[0].to_dict()
    best = {k: (None if (k == "critical" and (best[k] is None or pd.isna(best[k]))) else best[k]) for k in best}
    previous = score(PREVIOUS_SETTING)[0]

    # Re-check the chosen setting through the real gate, ticket by ticket.
    chosen = {k: best[k] for k in GRID}
    _, esc_fast = score(chosen)
    th = {"min_confidence": {h: chosen[h] for h in ("type", "queue", "priority")},
          "critical_score_min": chosen["critical"]}
    esc_real = np.array([gate_eval(i, th)[0] for i in range(len(val))])
    assert (esc_fast == esc_real).all(), "vectorised sweep disagrees with gate.evaluate"

    df.sort_values(["auto_share"], ascending=False).to_csv(REPORTS / "escalation_sweep.csv", index=False)
    summary = {"n_val": int(len(val)), "true_high_incidents": int(true_hi.sum()),
               "rule": "high_incident_escalated >= 0.95 and auto_queue_accuracy >= 0.75, then max auto_share",
               "n_combinations": len(df), "n_meeting_rule": int(len(ok)),
               "previous_setting": previous, "chosen": best,
               "verified_against_gate_evaluate": True}
    (REPORTS / "escalation_sweep.json").write_text(json.dumps(summary, indent=2, default=float))
    print(f"[sweep] {len(df)} combinations, {len(ok)} meet the rule")
    print(f"[sweep] previous : {previous}")
    print(f"[sweep] CHOSEN        : {best}")
    print(ok.sort_values(["auto_share", "auto_queue_accuracy"], ascending=False).head(8).to_string(index=False))


if __name__ == "__main__":
    main()
