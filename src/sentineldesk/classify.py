"""Track A owns this file.

LogisticRegression heads (type, queue, priority, language) over
[word TF-IDF (1-2 grams) || e5 query embedding]. class_weight="balanced" keeps the
21x-imbalanced queue head honest; a P(high) threshold tuned on a KB validation slice
buys high-priority recall.

Frozen setting (chosen on validation, see docs/p1_workdone.md): C=32, embedding weight 1.0,
P(high) threshold 0.25.

Embedding convention: the classifier is trained on KB vectors encoded with is_query=True,
because at inference it sees the incoming ticket's query vector. (The retrieval index uses
is_query=False "passage:" vectors; those are a different distribution and must not be used here.)
"""
from __future__ import annotations

from functools import lru_cache

import joblib
import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from . import config
from .schema import Prediction

HEADS = ["type", "queue", "priority", "language"]
HIGH = "high"


def _features(tfidf, texts, X: np.ndarray, emb_weight: float):
    T = tfidf.transform(texts)
    return sparse.hstack([T, sparse.csr_matrix(np.asarray(X, np.float32) * emb_weight)]).tocsr()


def fit(X: np.ndarray, y: dict[str, np.ndarray], texts: list[str], C: float = config.CLASSIFIER_C,
        emb_weight: float = config.CLASSIFIER_EMB_WEIGHT) -> dict:
    """Fit TF-IDF + one head per target. Returns the bundle (does not save it)."""
    tfidf = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=150_000, sublinear_tf=True)
    tfidf.fit(texts)
    F = _features(tfidf, texts, X, emb_weight)
    heads = {h: LogisticRegression(C=C, class_weight="balanced", max_iter=3000).fit(F, y[h])
             for h in HEADS if h in y}
    return {"tfidf": tfidf, "heads": heads, "emb_weight": emb_weight, "C": C,
            "high_threshold": 0.5, "embed_model": config.EMBED_MODEL}


def predict_proba(bundle: dict, X: np.ndarray, texts: list[str]) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Batch probabilities: {head: (classes, P[n, k])}. No threshold applied."""
    F = _features(bundle["tfidf"], texts, X, bundle["emb_weight"])
    return {h: (clf.classes_, clf.predict_proba(F)) for h, clf in bundle["heads"].items()}


def decide(classes: np.ndarray, P: np.ndarray, head: str, high_threshold: float) -> np.ndarray:
    """Row-wise label index; priority is labelled high whenever P(high) >= high_threshold."""
    idx = P.argmax(1)
    if head == "priority" and HIGH in classes:
        hi = list(classes).index(HIGH)
        idx = np.where(P[:, hi] >= high_threshold, hi, idx)
    return idx


def train(X: np.ndarray, y: dict[str, np.ndarray], texts: list[str] | None = None) -> None:
    """Fit one head per target and persist to artifacts/heads.joblib.

    Prefer scripts/train_classifier.py, which also holds out the validation slice and tunes
    the P(high) threshold. This entry point fits on everything with the frozen threshold.
    """
    if texts is None:
        raise ValueError("classify.train needs texts= (TF-IDF features); see scripts/train_classifier.py")
    bundle = fit(X, y, texts)
    bundle["high_threshold"] = config.HIGH_PRIORITY_THRESHOLD
    save(bundle)


def save(bundle: dict) -> None:
    config.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, config.HEADS_PATH)
    load.cache_clear()


@lru_cache(maxsize=1)
def load() -> dict:
    return joblib.load(config.HEADS_PATH)


def predict(x: np.ndarray, text: str | None = None) -> dict[str, Prediction]:
    """Return {"type": Prediction, "queue": ..., "priority": ..., "language": ...}.

    x: the ticket's query embedding, shape (384,) or (1, 384) from embed.encode([text], is_query=True).
    text: the ticket text from build_text(). Needed for the TF-IDF half of the features; if it is
    omitted the TF-IDF block is empty and predictions rely on the embedding alone (degraded).
    """
    bundle = load()
    x = np.atleast_2d(np.asarray(x, np.float32))
    out = {}
    for h, (classes, P) in predict_proba(bundle, x, [text or ""]).items():
        i = int(decide(classes, P, h, bundle["high_threshold"])[0])
        out[h] = Prediction(label=str(classes[i]), confidence=float(P[0, i]),
                            all_probs={str(c): float(p) for c, p in zip(classes, P[0])})
    return out
