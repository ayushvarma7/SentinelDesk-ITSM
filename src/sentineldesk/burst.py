"""Burst / major-incident detector.

OWNER: P3. Keeps the query vectors of recent live tickets. When at least
config.BURST_MIN_COUNT tickets (the current one included) inside
config.BURST_WINDOW_S are within cosine config.BURST_SIM of the current ticket,
the console shows a "Major incident" banner listing the related live ids and the
gate escalates to on-call.

Works across languages because e5 is multilingual: three VPN tickets in English
and German count as one burst. Pure numpy, no model loading.
"""
from __future__ import annotations

import threading
import time
from collections import deque

import numpy as np

from . import config


class BurstDetector:
    def __init__(self, sim: float | None = None, min_count: int | None = None,
                 window_s: float | None = None, maxlen: int = 500):
        self.sim = config.BURST_SIM if sim is None else sim
        self.min_count = config.BURST_MIN_COUNT if min_count is None else min_count
        self.window_s = config.BURST_WINDOW_S if window_s is None else window_s
        self._recent: deque[tuple[str, float, np.ndarray]] = deque(maxlen=maxlen)
        self._n = 0
        self._lock = threading.Lock()     # Streamlit and draft_eval call triage() from threads

    def clear(self) -> None:
        """Forget every recent ticket (evaluation scripts call this between tickets)."""
        with self._lock:
            self._recent.clear()

    def __len__(self) -> int:
        return len(self._recent)

    def check(self, vec: np.ndarray | None, now: float | None = None,
              sim: float | None = None) -> dict:
        """Record this ticket and return {"active", "related", "live_id", "max_sim"}."""
        with self._lock:
            return self._check(vec, now, sim)

    def _check(self, vec, now, sim) -> dict:
        now = time.time() if now is None else now
        sim = self.sim if sim is None else sim
        self._n += 1
        live_id = f"NEW-{self._n:04d}"   # not LIVE-: that prefix is the live precedent store (retrieve.py)
        if vec is None:
            return {"active": False, "related": [], "live_id": live_id, "max_sim": 0.0}
        v = np.asarray(vec, np.float32).ravel()
        v = v / (np.linalg.norm(v) or 1.0)

        while self._recent and now - self._recent[0][1] > self.window_s:
            self._recent.popleft()
        related, best = [], 0.0
        if self._recent:
            M = np.stack([r[2] for r in self._recent])
            s = M @ v
            best = float(s.max())
            related = [self._recent[i][0] for i in np.flatnonzero(s >= sim)]
        self._recent.append((live_id, now, v))
        return {"active": len(related) + 1 >= self.min_count, "related": related,
                "live_id": live_id, "max_sim": round(best, 4)}
