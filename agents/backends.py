"""Triage + retrieval backends.

real: the pipeline's own stages (embed.encode, classify.predict, retrieve.search, pipeline.BURST,
      pipeline._detected_language). Needs torch/numpy installed and artifacts/ built.
mock: api/mock_engine's classifier and fake precedent corpus (the same one the console demo uses),
      plus a lexical retriever over that corpus so a rewritten query really retrieves differently.
"""
from __future__ import annotations

import os
import re
import time

from sentineldesk import config
from sentineldesk.schema import Precedent, Prediction

_STOP = set("""the and for with that this from have has are was were you your our we they them not but can
could would should will please thanks thank hello dear any all its into been also there their what when which
der die das und ist nicht wir ich sie bitte mit seit unser unsere für auf eine ein einen kann werden wurde
keine danke hallo sehr geehrte damen herren uns ihr ihre haben hat noch""".split())


def _tokens(text: str) -> set[str]:
    return {w[:6] for w in re.findall(r"[^\W\d_]{3,}", (text or "").lower()) if w not in _STOP}


class MockBackend:
    mode = "mock"

    def __init__(self, reason: str):
        import mock_engine  # api/mock_engine.py (read-only reuse)

        self.reason = reason
        self.me = mock_engine
        self.corpus: list[tuple[Precedent, list[str]]] = []
        seen: set[str] = set()
        for topic in mock_engine.TOPICS.values():
            for p in topic["precedents"]:
                if p["ticket_id"] not in seen:
                    seen.add(p["ticket_id"])
                    self.corpus.append((Precedent(**p), topic["kw"]))
        for p in mock_engine.GENERIC_PRECEDENTS:
            self.corpus.append((Precedent(**p), []))

    def triage(self, subject, body, text, track_burst=True):
        t = time.perf_counter()
        r = self.me.mock_triage(subject, body, track_burst=track_burst)
        lang, lconf = self.me.detect_language(text)
        preds = {"type": r.type, "queue": r.queue, "priority": r.priority,
                 "language": Prediction(r.language, round(lconf, 4), {r.language: round(lconf, 4)})}
        ms = (time.perf_counter() - t) * 1000
        return preds, r.burst, {"embed": 0.0, "classify": round(ms, 1)}

    def search(self, query: str, language: str, queue: str | None, k: int = config.TOP_K) -> list[Precedent]:
        q, ql = _tokens(query), (query or "").lower()
        scored = []
        for p, kw in self.corpus:
            hits = sum(1 for w in kw if w in ql)
            d = _tokens(f"{p.subject} {p.body_snippet} {p.answer}")
            overlap = len(q & d) / max(1, min(len(q), 10))
            s = 0.815 + 0.03 * min(hits, 2) + 0.06 * min(1.0, overlap)
            s += 0.01 if p.language == language else 0.0
            s += 0.005 if queue and p.queue == queue else 0.0
            scored.append((round(min(s, 0.95), 4), p))
        scored.sort(key=lambda x: -x[0])
        top = [Precedent(**{**p.__dict__, "score": s}) for s, p in scored[:k]]
        # Mirror retrieve.search's cross-lingual slot.
        if config.CROSS_LINGUAL_SLOTS and top and all(p.language == language for p in top):
            other = next((Precedent(**{**p.__dict__, "score": s}) for s, p in scored[k:]
                          if p.language != language), None)
            if other:
                top[-1] = other
        return sorted(top, key=lambda p: -p.score)


class RealBackend:
    mode = "real"

    def __init__(self):
        from sentineldesk import classify, embed, pipeline, retrieve  # noqa: F401  (fail fast)

        self.reason = "pipeline + artifacts found"
        self.embed, self.classify, self.pipeline, self.retrieve = embed, classify, pipeline, retrieve
        self._last: tuple[str, object] | None = None

    def _vec(self, text: str):
        if self._last and self._last[0] == text:
            return self._last[1]
        v = self.embed.encode([text], is_query=True)[0]
        self._last = (text, v)
        return v

    def triage(self, subject, body, text, track_burst=True):
        t = time.perf_counter()
        qvec = self._vec(text)
        lat = {"embed": round((time.perf_counter() - t) * 1000, 1)}
        t = time.perf_counter()
        preds = self.classify.predict(qvec, text)
        det = self.pipeline._detected_language(text) if len(text) >= 20 else None
        if det and det[0] != preds["language"].label:
            preds["language"] = Prediction(det[0], det[1], {**preds["language"].all_probs, "langdetect": det[1]})
        burst = (self.pipeline.BURST.check(qvec) if track_burst
                 else {"active": False, "related": [], "live_id": None, "max_sim": 0.0})
        lat["classify"] = round((time.perf_counter() - t) * 1000, 1)
        return preds, burst, lat

    def search(self, query: str, language: str, queue: str | None, k: int = config.TOP_K) -> list[Precedent]:
        return self.retrieve.search(self._vec(query), k, queue, language=language)


_BACKEND = None


def get_backend():
    """Real when SD_MOCK!=1, the pipeline imports and artifacts exist; mock otherwise."""
    global _BACKEND
    if _BACKEND is not None:
        return _BACKEND
    reason = ""
    if os.environ.get("SD_MOCK") == "1":
        reason = "SD_MOCK=1"
    else:
        needed = (config.HEADS_PATH, config.KB_EMB_PATH, config.KB_META_PATH)
        missing = [p.name for p in needed if not p.exists()]
        if not config.DATA_PROCESSED.exists() and not config.ARTIFACTS.exists():
            reason = "data/ and artifacts/ missing"
        elif missing:
            reason = f"artifacts missing: {', '.join(missing)}"
        else:
            try:
                _BACKEND = RealBackend()
                return _BACKEND
            except Exception as exc:
                reason = f"pipeline import failed: {type(exc).__name__}: {exc}"[:200]
    _BACKEND = MockBackend(reason)
    return _BACKEND
