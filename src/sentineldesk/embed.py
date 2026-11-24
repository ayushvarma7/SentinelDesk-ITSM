"""Track B owns this file.

One encoder serves the classifier, the language head and the retrieval index.
Encode the KB once, cache to artifacts/kb_embeddings.npy, and let Track A train
on the file rather than calling the model.

NOTE (Track A / P1): encode() implemented to the contract so the classifier stage can run.
Track B keeps ownership; keep the signature and the prefix behaviour.
"""
from __future__ import annotations

import numpy as np

from . import config

_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(config.EMBED_MODEL)
    return _model


def encode(texts: list[str], is_query: bool = False, show_progress: bool = False,
           batch_size: int = 64) -> np.ndarray:
    """L2-normalized embeddings, shape (len(texts), config.EMBED_DIM).

    e5 requires the "query: " / "passage: " prefix — apply it here so no caller
    has to remember. is_query=True for an incoming ticket, False for the KB.
    """
    prefix = config.QUERY_PREFIX if is_query else config.PASSAGE_PREFIX
    vecs = _get_model().encode([prefix + t for t in texts], batch_size=batch_size,
                               show_progress_bar=show_progress, normalize_embeddings=True,
                               convert_to_numpy=True)
    return vecs.astype(np.float32)
