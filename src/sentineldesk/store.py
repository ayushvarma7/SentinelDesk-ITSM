"""The backend database: a log of every live triage plus a registry of distinct problems.

SQLite (standard library), one file: config.DB_PATH (artifacts/sentineldesk.db, git-ignored).

Tables
  problems         every distinct problem users have reported. A new ticket is compared (e5 cosine)
                   with the stored problems: >= PROBLEM_MATCH_SIM means "same problem" (occurrences +1),
                   otherwise it is ADDED as a new problem. Status open -> resolved when a human resolves it.
  triage_log       one row per live triage: masked text, predictions, gate status and reasons,
                   precedents with scores, engine, latency. The audit trail of what the system did.
  problem_tickets  which logged ticket belongs to which problem, with its similarity.

What this is NOT: a source of RAG precedents. Only human-written resolutions become precedents
(retrieve.add_precedent via pipeline.resolve_ticket); an unresolved problem has no answer to cite.

Privacy and evaluation
  * Only PII-masked subject/body are stored.
  * Only live triage is recorded (pipeline passes track_burst=True); evaluation scripts run with
    track_burst=False, so published metrics never touch or depend on the database.
  * Attacks and too-short tickets are logged but not registered as problems.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

import numpy as np

from . import config
from .schema import ProblemMatch, RelatedProblem

_LOCK = threading.Lock()
_CACHE: dict = {"path": None, "ids": np.zeros(0, dtype=np.int64),
                "matrix": np.zeros((0, config.EMBED_DIM), dtype=np.float32)}

SCHEMA = """
CREATE TABLE IF NOT EXISTS problems (
    problem_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    text         TEXT NOT NULL,                -- PII-masked subject + body of the first report
    language     TEXT, type TEXT, queue TEXT, priority TEXT,
    embedding    BLOB NOT NULL,                -- float32 e5 query vector, L2-normalised
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    occurrences  INTEGER NOT NULL DEFAULT 1,
    status       TEXT NOT NULL DEFAULT 'open', -- open | resolved
    resolution   TEXT, resolved_by TEXT, resolved_at TEXT,
    precedent_id TEXT                          -- LIVE-xxxxx once the resolution became a precedent
);
CREATE TABLE IF NOT EXISTS triage_log (
    log_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT NOT NULL,
    problem_id    INTEGER, is_new_problem INTEGER,
    subject       TEXT, body TEXT,             -- PII-masked
    language      TEXT,
    type          TEXT, type_conf REAL, queue TEXT, queue_conf REAL, priority TEXT, priority_conf REAL,
    status        TEXT, escalate INTEGER, reasons TEXT,
    precedents    TEXT,                        -- JSON [[ticket_id, cosine], ...]
    top1_similarity REAL,
    engine        TEXT, drafted INTEGER, cited TEXT,
    latency_ms    REAL, details TEXT           -- JSON: per-stage latency, risks, root cause, burst
);
CREATE TABLE IF NOT EXISTS problem_tickets (
    problem_id INTEGER NOT NULL, log_id INTEGER NOT NULL, similarity REAL
);
CREATE INDEX IF NOT EXISTS idx_log_problem ON triage_log(problem_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def _conn():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(config.DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        con.executescript(SCHEMA)
        yield con
        con.commit()
    finally:
        con.close()


def _load_vectors(con) -> None:
    """Keep all problem embeddings in memory; reload only when the DB file changes."""
    if _CACHE["path"] == str(config.DB_PATH):
        return
    rows = con.execute("SELECT problem_id, embedding FROM problems ORDER BY problem_id").fetchall()
    _CACHE["ids"] = np.array([r["problem_id"] for r in rows], dtype=np.int64)
    _CACHE["matrix"] = (np.vstack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
                        if rows else np.zeros((0, config.EMBED_DIM), dtype=np.float32))
    _CACHE["path"] = str(config.DB_PATH)


def _similar(qvec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(problem_ids, cosines) of all stored problems, most similar first."""
    if len(_CACHE["ids"]) == 0:
        return _CACHE["ids"], np.zeros(0)
    with np.errstate(all="ignore"):
        s = _CACHE["matrix"] @ np.asarray(qvec, np.float32).reshape(-1)
    order = np.argsort(-s)
    return _CACHE["ids"][order], s[order]


def _related(con, ids, sims, skip: int | None) -> list[RelatedProblem]:
    out = []
    for pid, s in zip(ids, sims):
        if len(out) >= config.PROBLEM_RELATED_K or s < config.PROBLEM_RELATED_MIN_SIM:
            break
        if skip is not None and int(pid) == skip:
            continue
        r = con.execute("SELECT title, occurrences, status, resolution FROM problems WHERE problem_id=?",
                        (int(pid),)).fetchone()
        out.append(RelatedProblem(int(pid), r["title"], round(float(s), 4), int(r["occurrences"]),
                                  r["status"], r["resolution"]))
    return out


def record(result, qvec: np.ndarray | None, subject: str | None, body: str | None,
           register: bool = True, at: str | None = None) -> ProblemMatch | None:
    """Log one live triage and match-or-add its problem. Returns the ProblemMatch (None if not registered).

    subject/body must already be PII-masked. register=False logs the ticket without touching problems
    (attacks, nothing-to-read tickets).
    """
    from .text import build_text
    now = at or _now()      # `at`: when the ticket arrived, for replayed history (demo seeding)
    with _LOCK, _conn() as con:
        _load_vectors(con)
        match = None
        if register and qvec is not None:
            ids, sims = _similar(qvec)
            if len(ids) and sims[0] >= config.PROBLEM_MATCH_SIM:          # same problem as before
                pid, is_new = int(ids[0]), False
                con.execute("UPDATE problems SET occurrences = occurrences + 1, last_seen = ? "
                            "WHERE problem_id = ?", (now, pid))
                best = float(sims[0])
            else:                                                         # new problem: add it
                text = build_text(subject, body)
                title = (subject or "").strip() or text[:80]
                cur = con.execute(
                    "INSERT INTO problems (title, text, language, type, queue, priority, embedding, "
                    "first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?)",
                    (title, text, result.language, result.type.label, result.queue.label,
                     result.priority.label, np.asarray(qvec, np.float32).tobytes(), now, now))
                pid, is_new, best = int(cur.lastrowid), True, 1.0
                _CACHE["ids"] = np.append(_CACHE["ids"], pid)
                _CACHE["matrix"] = np.vstack([_CACHE["matrix"], np.asarray(qvec, np.float32)[None, :]])
            row = con.execute("SELECT title, occurrences, status, resolution FROM problems WHERE problem_id=?",
                              (pid,)).fetchone()
            match = ProblemMatch(problem_id=pid, is_new=is_new, title=row["title"],
                                 occurrences=int(row["occurrences"]), status=row["status"],
                                 resolution=row["resolution"], similarity=round(best, 4),
                                 related=_related(con, ids, sims, skip=pid))

        p = result.precedents
        cur = con.execute(
            "INSERT INTO triage_log (ts, problem_id, is_new_problem, subject, body, language, type, type_conf, "
            "queue, queue_conf, priority, priority_conf, status, escalate, reasons, precedents, top1_similarity, "
            "engine, drafted, cited, latency_ms, details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (now, match.problem_id if match else None, int(match.is_new) if match else None,
             subject or "", body or "", result.language,
             result.type.label, result.type.confidence, result.queue.label, result.queue.confidence,
             result.priority.label, result.priority.confidence,
             result.status, int(result.escalate), json.dumps(result.escalation_reasons),
             json.dumps([[x.ticket_id, round(float(x.score), 4)] for x in p]),
             float(p[0].score) if p else None,
             result.engine, int(result.draft_reply is not None), json.dumps(result.cited_ticket_ids),
             result.latency_ms.get("total"),
             json.dumps({"latency_ms": result.latency_ms, "risks": result.risks,
                         "burst_active": bool((result.burst or {}).get("active")),
                         "root_cause_group": (result.root_cause.group_ticket_ids
                                              if result.root_cause else None)})))
        if match:
            match.log_id = int(cur.lastrowid)
            con.execute("INSERT INTO problem_tickets (problem_id, log_id, similarity) VALUES (?,?,?)",
                        (match.problem_id, match.log_id, match.similarity))
        return match


def mark_resolved(qvec: np.ndarray, resolution: str, resolved_by: str,
                  precedent_id: str | None = None) -> int | None:
    """A human resolved a ticket: mark the matching problem resolved. Returns its problem_id or None."""
    with _LOCK, _conn() as con:
        _load_vectors(con)
        ids, sims = _similar(qvec)
        if not len(ids) or sims[0] < config.PROBLEM_MATCH_SIM:
            return None
        pid = int(ids[0])
        con.execute("UPDATE problems SET status='resolved', resolution=?, resolved_by=?, resolved_at=?, "
                    "precedent_id=? WHERE problem_id=?", (resolution, resolved_by, _now(), precedent_id, pid))
        return pid


# ---------------------------------------------------------------- read side (console / dashboard)
def problems(limit: int = 200) -> list[dict]:
    with _LOCK, _conn() as con:
        rows = con.execute("SELECT problem_id, title, language, type, queue, priority, occurrences, status, "
                           "first_seen, last_seen, resolved_by, precedent_id FROM problems "
                           "ORDER BY last_seen DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


def recent_logs(limit: int = 200) -> list[dict]:
    with _LOCK, _conn() as con:
        rows = con.execute("SELECT log_id, ts, problem_id, is_new_problem, subject, language, type, queue, "
                           "priority, status, top1_similarity, engine, drafted, latency_ms FROM triage_log "
                           "ORDER BY log_id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]


def stats() -> dict:
    with _LOCK, _conn() as con:
        one = lambda q: con.execute(q).fetchone()[0]  # noqa: E731
        return {"tickets_logged": one("SELECT COUNT(*) FROM triage_log"),
                "problems": one("SELECT COUNT(*) FROM problems"),
                "open_problems": one("SELECT COUNT(*) FROM problems WHERE status='open'"),
                "resolved_problems": one("SELECT COUNT(*) FROM problems WHERE status='resolved'"),
                "recurring_problems": one("SELECT COUNT(*) FROM problems WHERE occurrences > 1")}


def get_problem(problem_id: int) -> dict | None:
    with _LOCK, _conn() as con:
        r = con.execute("SELECT problem_id, title, text, language, type, queue, priority, first_seen, last_seen, "
                        "occurrences, status, resolution, resolved_by, resolved_at, precedent_id "
                        "FROM problems WHERE problem_id=?", (int(problem_id),)).fetchone()
        return dict(r) if r else None


def problem_tickets(problem_id: int) -> list[dict]:
    """Every logged ticket attached to a problem, oldest first."""
    with _LOCK, _conn() as con:
        rows = con.execute("SELECT l.log_id, l.ts, pt.similarity, l.subject, l.body, l.language, l.status, "
                           "l.priority, l.engine FROM problem_tickets pt JOIN triage_log l ON l.log_id = pt.log_id "
                           "WHERE pt.problem_id=? ORDER BY l.log_id", (int(problem_id),)).fetchall()
        return [dict(r) for r in rows]


def search(qvec: np.ndarray, k: int = 5, min_sim: float | None = None) -> list[dict]:
    """Read-only: the stored problems most similar to a query vector. Records nothing."""
    min_sim = config.PROBLEM_RELATED_MIN_SIM if min_sim is None else min_sim
    with _LOCK, _conn() as con:
        _load_vectors(con)
        ids, sims = _similar(qvec)
        out = []
        for pid, s in zip(ids[:k], sims[:k]):
            if s < min_sim:
                break
            r = con.execute("SELECT problem_id, title, occurrences, status, resolution FROM problems "
                            "WHERE problem_id=?", (int(pid),)).fetchone()
            out.append({**dict(r), "similarity": round(float(s), 4),
                        "same_problem": bool(s >= config.PROBLEM_MATCH_SIM)})
        return out


def resolve_problem(problem_id: int, resolution: str, resolved_by: str, precedent_id: str | None = None) -> None:
    """Mark one problem resolved (console: agent closed a ticket, or resolved the problem directly)."""
    if not (resolution or "").strip() or not (resolved_by or "").strip():
        raise ValueError("a resolution and the person who resolved it are both required")
    with _LOCK, _conn() as con:
        con.execute("UPDATE problems SET status='resolved', resolution=?, resolved_by=?, resolved_at=?, "
                    "precedent_id=COALESCE(?, precedent_id) WHERE problem_id=?",
                    (resolution.strip(), resolved_by.strip(), _now(), precedent_id, int(problem_id)))


def reopen_problem(problem_id: int) -> None:
    with _LOCK, _conn() as con:
        con.execute("UPDATE problems SET status='open' WHERE problem_id=?", (int(problem_id),))


def reset() -> None:
    """Delete everything (demo reset / tests). The KB and the precedent store are untouched."""
    with _LOCK, _conn() as con:
        con.executescript("DELETE FROM problem_tickets; DELETE FROM triage_log; DELETE FROM problems;")
        try:    # ids restart at 1 (the table only exists once something has been inserted)
            con.execute("DELETE FROM sqlite_sequence WHERE name IN ('problem_tickets','triage_log','problems')")
        except Exception:  # noqa: BLE001
            pass
    _CACHE["path"] = None
