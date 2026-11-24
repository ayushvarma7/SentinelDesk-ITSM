"""Can the German queue/priority gap be closed? Validation slice only (holdout untouched).

    PYTHONPATH=src python scripts/german_experiments.py

Selection rule, fixed BEFORE running: maximise German (queue + priority) validation macro-F1,
subject to English (queue + priority) and type (each language) not dropping by more than 0.005
against the current model. Ties go to the simpler model.

Candidates
  G0  current: word TF-IDF || e5, one LogisticRegression per head (C=32)
  G1  + char_wb 3-5-grams (German compounds share pieces: Netzwerk|verbindung)
  G2  separate heads per language (routed by the language head's prediction, as at inference)
  G3  G1 + G2
Also a label-consistency ceiling: how often a ticket's nearest same-language KB neighbour carries
the same label. If German is lower there, part of the gap is in the labels, not the model.
"""
import json
import time

import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.pipeline import FeatureUnion

from sentineldesk import classify, config
from sentineldesk.data import build_text, load_kb

HEADS = ["type", "queue", "priority"]
C = config.CLASSIFIER_C


def tfidf(char: bool):
    word = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=150_000, sublinear_tf=True)
    if not char:
        return word
    return FeatureUnion([("word", word), ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=3,
                                                                  max_features=150_000, sublinear_tf=True))])


def feats(vec, texts, E):
    return sparse.hstack([vec.transform(texts), sparse.csr_matrix(E * config.CLASSIFIER_EMB_WEIGHT)]).tocsr()


def per_lang_f1(y, p, lang):
    return {lg: {h: round(f1_score(y[h][lang == lg], p[h][lang == lg], average="macro"), 4) for h in HEADS}
            for lg in ("en", "de")}


def main() -> None:
    kb = load_kb()
    texts = np.array([build_text(s, b) for s, b in zip(kb["subject"], kb["body"])], dtype=object)
    E = np.load(config.KB_QUERY_EMB_PATH)
    perm = np.random.RandomState(config.RANDOM_SEED).permutation(len(kb))
    n_val = int(config.VAL_FRACTION * len(kb))
    va, tr = perm[:n_val], perm[n_val:]
    y_tr = {h: kb[h].to_numpy()[tr] for h in HEADS}
    y_va = {h: kb[h].to_numpy()[va] for h in HEADS}
    lang_tr = kb["language"].to_numpy()[tr]
    # route validation tickets by the PREDICTED language, exactly as inference would
    bundle = classify.load()
    lc, lp = classify.predict_proba(bundle, E[va], list(texts[va]))["language"]
    lang_va_pred = lc[lp.argmax(1)]
    lang_va_true = kb["language"].to_numpy()[va]

    results = {}
    for name, char, split in (("G0", False, False), ("G1", True, False), ("G2", False, True), ("G3", True, True)):
        t0 = time.time()
        pred = {h: np.empty(len(va), dtype=object) for h in HEADS}
        groups = [("en", lang_tr == "en", lang_va_pred == "en"), ("de", lang_tr == "de", lang_va_pred == "de")] \
            if split else [("all", np.ones(len(tr), bool), np.ones(len(va), bool))]
        for _, mtr, mva in groups:
            vec = tfidf(char).fit(texts[tr][mtr])
            Xtr, Xva = feats(vec, texts[tr][mtr], E[tr][mtr]), feats(vec, texts[va][mva], E[va][mva])
            for h in HEADS:
                clf = LogisticRegression(C=C, class_weight="balanced", max_iter=3000).fit(Xtr, y_tr[h][mtr])
                pred[h][mva] = clf.predict(Xva)
        results[name] = per_lang_f1(y_va, pred, lang_va_true)
        r = results[name]
        print(f"[{name}] {time.time() - t0:4.0f}s  EN type {r['en']['type']:.4f} queue {r['en']['queue']:.4f} "
              f"priority {r['en']['priority']:.4f} | DE type {r['de']['type']:.4f} queue {r['de']['queue']:.4f} "
              f"priority {r['de']['priority']:.4f}")

    base = results["G0"]
    def ok(r):
        return (r["en"]["queue"] + r["en"]["priority"] >= base["en"]["queue"] + base["en"]["priority"] - 0.005
                and all(r[lg]["type"] >= base[lg]["type"] - 0.005 for lg in ("en", "de")))
    order = ["G0", "G1", "G2", "G3"]                       # simplest first, for ties
    eligible = [g for g in order if ok(results[g])]
    best = max(eligible, key=lambda g: (round(results[g]["de"]["queue"] + results[g]["de"]["priority"], 4),
                                        -order.index(g)))

    # label-consistency ceiling: nearest same-language KB neighbour (train part) agrees?
    ceiling = {}
    Etr = E[tr]
    for lg in ("en", "de"):
        q = va[lang_va_true == lg]
        cand = tr[lang_tr == lg]
        S = E[q] @ E[cand].T
        nn = cand[S.argmax(1)]
        ceiling[lg] = {h: round(float((kb[h].to_numpy()[nn] == kb[h].to_numpy()[q]).mean()), 3) for h in HEADS}
    print(f"\nnearest same-language neighbour has the same label: {ceiling}")
    print(f"selection rule -> eligible {eligible}, CHOSEN {best}")
    out = {"rule": "max DE queue+priority; EN queue+priority and type (each lang) within 0.005 of G0",
           "results": results, "eligible": eligible, "chosen": best, "neighbour_label_agreement": ceiling}
    (config.ROOT / "reports" / "german_experiments.json").write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
