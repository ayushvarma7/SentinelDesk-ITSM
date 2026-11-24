"""Track B (P2). Precedent retrieval over the KB split.

Exact cosine search with numpy, deliberately — not faiss. P1 measured that on
macOS faiss and torch each bundle libomp, and importing faiss first aborts the
process with OMP: Error #15. The pipeline imports torch, so faiss is out. At
22,863 x 384 an exact matmul is about 0.9 ms per query, so there is nothing to
gain anyway.

Two embedding files exist on purpose (docs/p1_workdone.md §5.3):
  kb_embeddings.npy        KB encoded as passages  -> this index
  kb_query_embeddings.npy  KB encoded as queries   -> the classifier's features
Never point one at the other.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config
from .schema import Precedent
from .text import build_text

_INDEX: dict | None = None
_LIVE: dict | None = None

META_COLUMNS = ["ticket_id", "subject", "body", "answer", "language", "queue", "type", "priority"]
# The live store carries two extra provenance columns; the frozen index has no
# use for them and _row_to_precedent reads everything with .get().
LIVE_COLUMNS = META_COLUMNS + ["resolved_by", "resolved_at"]
SNIPPET_CHARS = 240


def build_index(show_progress: bool = True) -> None:
    """Encode the KB as passages and persist the index. Run once, ~5 min on an M4.

    KB order is data.load_kb() (22,863 rows, the answerless ones dropped), which
    is the order every other artifact assumes.
    """
    from . import data, embed

    kb = data.load_kb()
    texts = [build_text(s, b) for s, b in zip(kb["subject"], kb["body"])]
    print(f"[retrieve] encoding {len(texts):,} KB tickets as passages")
    emb = embed.encode(texts, is_query=False, show_progress=show_progress)

    if len(emb) != len(kb):
        raise RuntimeError(f"embedding/row mismatch: {len(emb)} vs {len(kb)}")

    config.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    np.save(config.KB_EMB_PATH, emb)
    kb[[c for c in META_COLUMNS if c in kb.columns]].to_parquet(config.KB_META_PATH, index=False)
    print(f"[retrieve] wrote {config.KB_EMB_PATH.name} {emb.shape} and {config.KB_META_PATH.name}")


def load_index() -> dict:
    """Load once and keep it. Streamlit should call this at startup."""
    global _INDEX
    if _INDEX is None:
        if not config.KB_EMB_PATH.exists():
            raise FileNotFoundError(
                f"{config.KB_EMB_PATH} missing — run: PYTHONPATH=src python scripts/build_kb_index.py"
            )
        matrix = np.load(config.KB_EMB_PATH)
        meta = pd.read_parquet(config.KB_META_PATH)
        if len(matrix) != len(meta):
            raise RuntimeError(f"index/meta mismatch: {len(matrix)} vs {len(meta)}")
        _INDEX = {"matrix": np.ascontiguousarray(matrix, dtype=np.float32), "meta": meta}
    return _INDEX


def is_ready() -> bool:
    return config.KB_EMB_PATH.exists() and config.KB_META_PATH.exists()


# --------------------------------------------------------------------------
# Live store: precedents learned during a session.
#
# Kept in its own files, never merged into the frozen index, for three reasons:
#   1. reproducibility — scripts/evaluate.py and retrieval_check.py pass
#      include_live=False, so published metrics never depend on session state;
#   2. leakage — a holdout ticket appended during a demo would otherwise end up
#      answering its own question in the next evaluation run;
#   3. it can be wiped between demo runs without rebuilding anything.
#
# Live ids are LIVE-xxxxx, deliberately distinct from the KB's TKT-xxxxx, so a
# citation in a draft shows at a glance whether it came from history or from
# something a human resolved minutes ago.
# --------------------------------------------------------------------------

def _empty_live() -> dict:
    return {"matrix": np.zeros((0, config.EMBED_DIM), dtype=np.float32),
            "meta": pd.DataFrame(columns=LIVE_COLUMNS)}


def load_live() -> dict:
    global _LIVE
    if _LIVE is None:
        if config.LIVE_EMB_PATH.exists() and config.LIVE_META_PATH.exists():
            _LIVE = {"matrix": np.load(config.LIVE_EMB_PATH).astype(np.float32),
                     "meta": pd.read_parquet(config.LIVE_META_PATH)}
        else:
            _LIVE = _empty_live()
    return _LIVE


def live_count() -> int:
    return len(load_live()["meta"])


def clear_live() -> None:
    """Wipe the session store. Does not touch the frozen index."""
    global _LIVE
    _LIVE = _empty_live()
    for p in (config.LIVE_EMB_PATH, config.LIVE_META_PATH):
        p.unlink(missing_ok=True)


def add_precedent(subject: str | None, body: str | None, answer: str,
                  language: str, queue: str = "", type_: str = "",
                  resolved_by: str = "") -> str:
    """Add a HUMAN-RESOLVED ticket to the live store and return its LIVE-xxxxx id.

    This is the escalation loop closing: the gate says "no precedent", a person
    resolves it, and the resolution becomes retrievable for the next ticket.
    Costs one encode (~11 ms) — there is no index to rebuild.

    `resolved_by` is required and recorded. A KB is only as good as what goes
    into it: if an AI draft could become a precedent, the next draft would be
    grounded in the previous guess, and the one after that in the guess about
    the guess. Every row here must trace back to a named person.

    Call it through pipeline.resolve_ticket(), which fills in the labels.
    """
    from . import embed

    answer = (answer or "").strip()
    if not answer:
        raise ValueError("a precedent needs an answer; that is the whole point of it")
    if not (resolved_by or "").strip():
        raise ValueError(
            "resolved_by is required: only human-written resolutions may become precedents"
        )

    live = load_live()

    # Resolving the same ticket twice must not add it twice.
    text = build_text(subject, body)
    if len(live["meta"]):
        same = live["meta"][(live["meta"]["subject"].fillna("") == (subject or ""))
                            & (live["meta"]["body"].fillna("") == (body or ""))]
        if len(same):
            return str(same.iloc[0]["ticket_id"])

    ticket_id = f"LIVE-{len(live['meta']) + 1:05d}"
    vec = embed.encode([text], is_query=False)[0]

    row = {"ticket_id": ticket_id, "subject": subject or "", "body": body or "",
           "answer": answer, "language": language, "queue": queue, "type": type_,
           "priority": "", "resolved_by": resolved_by.strip(),
           "resolved_at": pd.Timestamp.utcnow().isoformat(timespec="seconds")}
    live["matrix"] = np.vstack([live["matrix"], vec[None, :]]).astype(np.float32)
    live["meta"] = pd.concat([live["meta"], pd.DataFrame([row])], ignore_index=True)

    config.LIVE_DIR.mkdir(parents=True, exist_ok=True)
    np.save(config.LIVE_EMB_PATH, live["matrix"])
    live["meta"].to_parquet(config.LIVE_META_PATH, index=False)
    return ticket_id


def _row_to_precedent(row: pd.Series, score: float) -> Precedent:
    body = str(row.get("body") or "")
    return Precedent(
        ticket_id=str(row["ticket_id"]),
        score=float(score),
        subject=str(row.get("subject") or ""),
        body_snippet=body[:SNIPPET_CHARS] + ("…" if len(body) > SNIPPET_CHARS else ""),
        answer=str(row.get("answer") or ""),
        language=str(row.get("language") or ""),
        queue=str(row.get("queue") or ""),
    )


# --------------------------------------------------------------------------
# Hybrid search (Track A): keyword cosine (TF-IDF) fused with embedding cosine.
#
# e5 captures the topic but can drop the one keyword that matters ("VPN keeps dropping ... for our
# hospital staff" returned hospital *security* tickets). Reciprocal-rank fusion (RRF) of the two
# rankings decides WHICH precedents are picked; every returned score is still the e5 cosine, so the
# gate's similarity floors keep their calibration. HYBRID_LEXICAL_WEIGHT = 0 restores dense-only.
# --------------------------------------------------------------------------
_LEX: dict | None = None
RRF_K = 60


def load_lexical() -> dict | None:
    """TF-IDF index over the frozen KB, row-aligned with kb_meta. Built once (~10 s), then cached."""
    global _LEX
    if _LEX is None:
        import joblib
        from scipy import sparse
        from sklearn.feature_extraction.text import TfidfVectorizer
        meta = load_index()["meta"]
        vec_path, mat_path = config.KB_LEX_PATH.with_suffix(".joblib"), config.KB_LEX_PATH
        if vec_path.exists() and mat_path.exists():
            vec, mat = joblib.load(vec_path), sparse.load_npz(mat_path)
            if mat.shape[0] != len(meta):
                vec = mat = None
        else:
            vec = mat = None
        if vec is None:
            texts = [build_text(s_, b_) for s_, b_ in zip(meta["subject"], meta["body"])]
            vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=200_000, sublinear_tf=True)
            mat = vec.fit_transform(texts).tocsr()
            config.ARTIFACTS.mkdir(parents=True, exist_ok=True)
            joblib.dump(vec, vec_path)
            sparse.save_npz(mat_path, mat)
        _LEX = {"vec": vec, "matrix": mat.tocsr()}
    return _LEX


def _ranks(scores: np.ndarray) -> np.ndarray:
    """1-based rank of every element, highest score = 1."""
    order = np.argsort(-scores, kind="stable")
    r = np.empty(len(scores), dtype=np.int64)
    r[order] = np.arange(1, len(scores) + 1)
    return r


def _candidates(store: dict, q: np.ndarray, k: int, queue_filter: str | None,
                exclude_language: str | None = None, lex_scores: np.ndarray | None = None,
                hybrid: bool = False):
    """Top candidates from one store as a list of (rank_key, cosine, row_index), best first.

    exclude_language restricts the search to rows NOT in that language, which
    is how the cross-lingual slots find anything: the unrestricted top-30 for a
    German query is usually 30 German tickets, so a reserved slot has nothing
    to put in it unless we search the other language's rows directly.

    hybrid=False: rank_key is the cosine itself (the original behaviour).
    hybrid=True : rank_key is the RRF score; lex_scores (keyword cosine per row) adds a second
                  ranking when available. A store without a keyword index (the live store) gets
                  an RRF key from its dense ranking alone, so keys stay comparable across stores.
    """
    matrix, meta = store["matrix"], store["meta"]
    if len(matrix) == 0:
        return []
    # Apple's Accelerate BLAS leaves FP exception flags set, so numpy reports
    # spurious divide-by-zero/overflow warnings here. Verified: inputs and
    # outputs are finite and normalized.
    with np.errstate(all="ignore"):
        sims = matrix @ q

    rows = np.arange(len(meta))
    if exclude_language:
        rows = (meta["language"].to_numpy() != exclude_language).nonzero()[0]
        if len(rows) == 0:
            return []
    elif queue_filter:
        mask = (meta["queue"].to_numpy() == queue_filter).nonzero()[0]
        # Only trust the filter if it leaves room; a wrong queue prediction
        # (macro-F1 0.61) must never starve retrieval.
        if len(mask) >= k * 4:
            rows = mask

    pool = min(len(rows), max(k * 6, 30))
    dense = sims[rows]
    if not hybrid:
        local = np.argpartition(-dense, kth=pool - 1)[:pool]
        local = local[np.argsort(-dense[local])]
        return [(float(sims[i]), float(sims[i]), int(i)) for i in rows[local]]

    key = 1.0 / (RRF_K + _ranks(dense))
    if lex_scores is not None:
        key = key + config.HYBRID_LEXICAL_WEIGHT / (RRF_K + _ranks(lex_scores[rows]))
    local = np.argpartition(-key, kth=pool - 1)[:pool]
    local = local[np.argsort(-key[local])]
    return [(float(key[j]), float(dense[j]), int(rows[j])) for j in local]


def search(query_vec: np.ndarray, k: int | None = None,
           queue_filter: str | None = None,
           include_live: bool = True,
           language: str | None = None,
           cross_lingual_slots: int | None = None,
           query_text: str | None = None) -> list[Precedent]:
    """Top-k precedents across the frozen KB and the live store, best first.

    Vectors are L2-normalized, so the dot product is cosine similarity.

    include_live=False is mandatory for anything that produces a published
    number — scripts/evaluate.py, scripts/retrieval_check.py — so metrics never
    depend on what someone typed into the console.

    cross_lingual_slots reserves places for the best precedent written in a
    language OTHER than `language`. This is needed because e5 does NOT bridge
    languages on its own: measured against DETECTED language (not the dataset's
    noisy label), only 1-3% of unrestricted top-5 hits cross languages. The
    apparent 16% in an earlier measurement was mislabelled tickets — "de" rows
    written in English — not genuine cross-lingual matching.
    """
    k = k or config.TOP_K
    # Hybrid ranking needs the ticket text; callers that pass only a vector get dense-only search.
    hybrid = bool(query_text) and config.HYBRID_LEXICAL_WEIGHT > 0
    lex = None
    if hybrid:
        L = load_lexical()
        lex = (L["matrix"] @ L["vec"].transform([query_text]).T).toarray().ravel()
    slots = config.CROSS_LINGUAL_SLOTS if cross_lingual_slots is None else cross_lingual_slots
    q = np.asarray(query_vec, dtype=np.float32).reshape(-1)

    frozen = load_index()
    pools = [(frozen, key, s, i) for key, s, i in _candidates(frozen, q, k, queue_filter,
                                                             lex_scores=lex, hybrid=hybrid)]
    if include_live:
        live = load_live()
        pools += [(live, key, s, i) for key, s, i in _candidates(live, q, k, queue_filter, hybrid=hybrid)]
    pools.sort(key=lambda t: -t[1])          # by rank key (= cosine unless hybrid)

    def lang_of(store, i):
        return str(store["meta"].iloc[i].get("language") or "")

    # Drop near-identical precedents: templated answers make five copies of one
    # resolution look like five independent sources, which misleads on screen.
    picked: list[tuple[dict, float, int]] = []

    def try_add(store, score, i) -> bool:
        vec = store["matrix"][i]
        if any(float(vec @ s2["matrix"][j]) >= config.DEDUP_SIMILARITY
               for s2, _, j in picked):
            return False
        picked.append((store, score, i))
        return True

    reserve = slots if (language and slots) else 0
    for store, _key, score, i in pools:
        if len(picked) >= k - reserve:
            break
        try_add(store, score, i)

    # Fill the reserved places with the best other-language precedents, then
    # top up with same-language ones if the KB has none to offer.
    if reserve:
        other = [(frozen, key, s2, i) for key, s2, i in
                 _candidates(frozen, q, slots, None, exclude_language=language,
                             lex_scores=lex, hybrid=hybrid)]
        if include_live:
            other += [(live, key, s2, i) for key, s2, i in
                      _candidates(live, q, slots, None, exclude_language=language, hybrid=hybrid)]
        other.sort(key=lambda t: -t[1])
        for store, _key, score, i in other:
            if len(picked) >= k:
                break
            if any(j == i and st is store for st, _, j in picked):
                continue
            try_add(store, score, i)
        for store, _key, score, i in pools:
            if len(picked) >= k:
                break
            try_add(store, score, i)

    picked.sort(key=lambda t: -t[1])
    return [_row_to_precedent(store["meta"].iloc[i], score) for store, score, i in picked]
