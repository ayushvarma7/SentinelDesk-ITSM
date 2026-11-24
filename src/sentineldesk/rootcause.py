"""Root-cause grouping, following the ITIL model:

    many Incidents  ->  one Problem (the root cause)  ->  fixed by one or more Changes

Two things per Incident/Problem ticket:
  1. Live grouping: compare with recent live issues; a group of >= ROOT_CAUSE_MIN_GROUP similar issues
     inside ROOT_CAUSE_WINDOW_MIN minutes suggests raising a Problem record (e.g. three different
     "Outlook not receiving mail" tickets).
  2. Known history: the closest historical Problem and Change tickets in the KB, i.e. the probable
     root cause and how it was fixed before.

Integration with retrieval: known-history links search the SAME passage index as retrieval
(retrieve.load_index(), artifacts/kb_embeddings.npy), restricted to Problem / Change rows, with the
ticket's query vector, the proper e5 query->passage setup. No second KB copy is loaded. The pipeline
then hands the known Problem to the drafter as an extra precedent, so a reply can cite the root cause.

Live grouping compares live tickets with each other (query vs query), so it keeps its own threshold.
The dataset has no explicit Incident->Problem links, so thresholds are calibrated from similarity
distributions (see config.py), not from labelled groups.
"""
from __future__ import annotations

import itertools
import time
from collections import deque
from dataclasses import dataclass

import numpy as np

from . import config
from .schema import Precedent, RootCause


# --- known history: Problem / Change rows of the retrieval index ---------------------
_TYPE_ROWS: dict | None = None


def _type_rows(meta) -> dict:
    global _TYPE_ROWS
    if _TYPE_ROWS is None or _TYPE_ROWS["n"] != len(meta):
        types = meta["type"].to_numpy()
        _TYPE_ROWS = {"n": len(meta), **{t: np.where(types == t)[0] for t in ("Problem", "Change")}}
    return _TYPE_ROWS


def known_links(qvec: np.ndarray) -> tuple[Precedent | None, Precedent | None]:
    """(closest KB Problem, closest KB Change), each None if below ROOT_CAUSE_LINK_MIN_SIM or no index."""
    from . import retrieve
    if not retrieve.is_ready():
        return None, None
    idx = retrieve.load_index()
    matrix, meta = idx["matrix"], idx["meta"]
    rows_by_type = _type_rows(meta)
    q = np.asarray(qvec, np.float32).reshape(-1)
    out = []
    for t in ("Problem", "Change"):
        rows = rows_by_type[t]
        with np.errstate(all="ignore"):          # Accelerate BLAS sets spurious FP flags (see retrieve.py)
            s = matrix[rows] @ q
        k = int(s.argmax())
        score = float(s[k])
        out.append(retrieve._row_to_precedent(meta.iloc[int(rows[k])], score)
                   if score >= config.ROOT_CAUSE_LINK_MIN_SIM else None)
    return out[0], out[1]


# --- live grouping -----------------------------------------------------------------
@dataclass
class _Live:
    ticket_id: str
    vec: np.ndarray
    ts: float
    gid: int
    queue: str = ""


class IncidentGrouper:
    """Single-linkage grouping of recent live issues; groups merge when a new ticket links them.

    Two issues link when cosine >= sim. (An optional same-queue lower bar exists but is disabled;
    see config.ROOT_CAUSE_GROUP_SIM_SAME_QUEUE for why.) The groups drive the major-incident banner
    (config.MAJOR_INCIDENT_SOURCE).
    """

    def __init__(self, sim: float = config.ROOT_CAUSE_GROUP_SIM,
                 window_min: float = config.ROOT_CAUSE_WINDOW_MIN,
                 min_group: int = config.ROOT_CAUSE_MIN_GROUP,
                 sim_same_queue: float | None = config.ROOT_CAUSE_GROUP_SIM_SAME_QUEUE):
        self.sim, self.window_s, self.min_group = sim, window_min * 60, min_group
        self.sim_same_queue = sim_same_queue
        self.recent: deque[_Live] = deque()
        self._ids = itertools.count(1)
        self._gids = itertools.count(1)

    def reset(self) -> None:
        self.recent.clear()

    def _links(self, r: "_Live", vec: np.ndarray, queue: str) -> bool:
        s = float(r.vec @ vec)
        return s >= self.sim or (self.sim_same_queue is not None and bool(queue)
                                 and r.queue == queue and s >= self.sim_same_queue)

    def add(self, vec: np.ndarray, now: float | None = None, ticket_id: str | None = None,
            queue: str = "") -> list[str]:
        """Register a live issue; return the ids of its group (including itself), oldest first."""
        now = time.time() if now is None else now
        while self.recent and now - self.recent[0].ts > self.window_s:
            self.recent.popleft()
        vec = np.asarray(vec, np.float32)
        linked = {r.gid for r in self.recent if self._links(r, vec, queue)}
        gid = min(linked) if linked else next(self._gids)
        for r in self.recent:                      # merge every group this ticket bridges
            if r.gid in linked:
                r.gid = gid
        tid = ticket_id or f"LIVE-{next(self._ids):04d}"
        self.recent.append(_Live(tid, vec, now, gid, queue))
        return [r.ticket_id for r in self.recent if r.gid == gid]


GROUPER = IncidentGrouper()


def analyze(qvec: np.ndarray, text: str, now: float | None = None, group: bool = True,
            queue: str = "") -> RootCause:
    """Root-cause view for one Incident/Problem ticket: live group + closest known Problem/Change.

    group=False keeps the ticket out of live grouping (batch evaluation, same as track_burst=False).
    """
    # too little text ("help", emoji) to say anything about root cause: not grouped
    group = (GROUPER.add(qvec, now=now, queue=queue)
             if group and len(text.split()) >= config.ROOT_CAUSE_MIN_WORDS else [])
    problem, change = known_links(qvec)
    return RootCause(group_ticket_ids=group, suggest_problem=len(group) >= GROUPER.min_group,
                     known_problem=problem, known_change=change)
