"""Single source of truth for paths, model names and thresholds.

Every module imports this.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
ARTIFACTS = ROOT / "artifacts"

# --- models -----------------------------------------------------------------
# e5 requires the "query: " / "passage: " prefixes; skipping them costs real accuracy.
EMBED_MODEL = "intfloat/multilingual-e5-small"
EMBED_DIM = 384
QUERY_PREFIX = "query: "
PASSAGE_PREFIX = "passage: "

LLM_MODEL = os.getenv("SD_LLM_MODEL", "gemini-3.5-flash-lite")   # 2.5-* are retired (404); 3.5-flash 504s on capacity
LLM_MAX_TOKENS = 1024
LLM_TIMEOUT_MS = 20000   # past this, fall back to extractive rather than stall the UI

# --- triage classifier ------------------------------------------------
# Frozen on the KB validation slice: word TF-IDF || e5 query embedding.
HEADS_PATH = ARTIFACTS / "heads.joblib"
KB_QUERY_EMB_PATH = ARTIFACTS / "kb_query_embeddings.npy"   # KB encoded with is_query=True, for the classifier
CLASSIFIER_C = 32.0
CLASSIFIER_EMB_WEIGHT = 1.0
HIGH_PRIORITY_TARGET_RECALL = 0.80   # P(high) threshold is the highest one reaching this on validation
HIGH_PRIORITY_THRESHOLD = 0.25       # value tuned by scripts/train_classifier.py (also stored in heads.joblib)
VAL_FRACTION = 0.10                  # first 10% of RandomState(RANDOM_SEED).permutation(len(kb)); gate tuning reuses it

# --- root cause (ITIL: many Incidents -> one Problem -> fixed by Changes) ----
# Incident vs Problem is a relationship, not a wording difference (712 of 760 type errors are
# Incident<->Problem), so the critical-escalation rule treats both as "service is broken".
# Validation: high-priority Incident recall 0.803 (Incident only) -> 0.882 (Incident or Problem).
CRITICAL_TYPES = ("Incident", "Problem")
# Escalate to on-call when P(high) x P(Incident or Problem) >= this (gate rule 1a). None disables.
# Chosen by scripts/escalation_sweep.py on the KB validation slice (see reports/escalation_sweep.json).
CRITICAL_SCORE_MIN = 0.20
# Similarity (e5 query vectors) above which two issues are treated as the same root cause.
# Calibrated on KB issue pairs from different queues with no shared tag: p90=0.891, p99=0.917.
# 0.88: tests/test_major_incident.py (4 core problems EN+DE, 5 one-offs) gives grouping and
# banner precision 1.00 with no premature banner, and the attack table's burst case passes
# (its German VPN report scores 0.884). 0.885+ misses that report; the flat 0.86 burst trigger had
# banner precision 0.16 and raised 4 banners before a 3rd report of the same problem.
ROOT_CAUSE_GROUP_SIM = 0.88
# Optional lower bar when both issues share a predicted queue. DISABLED (None): it merged Outlook,
# VPN and printer outages into one group, because the classifier puts all three in the same IT queue
# and single linkage chains them. (A KB check had looked fine only because it defined "unrelated"
# as different queues, exactly where this rule never applies.)
ROOT_CAUSE_GROUP_SIM_SAME_QUEUE = None
# What raises the major-incident banner: "root_cause" (grouping above, 3+ issues) or "burst"
# (burst.py: direct cosine >= BURST_SIM to 2 earlier tickets of any type).
MAJOR_INCIDENT_SOURCE = "root_cause"

# --- problem database (store.py) -------------------------------------------
# SQLite log of every live triage + registry of distinct problems. Git-ignored (artifacts/).
DB_PATH = Path(os.getenv("SD_DB_PATH", str(ARTIFACTS / "sentineldesk.db")))
DB_ENABLED = os.getenv("SD_DB", "1") == "1"
# Same problem = cosine to a stored problem's first ticket. Kept apart from ROOT_CAUSE_GROUP_SIM (0.88):
# measured on the 45 demo tickets, genuine repeats (printer, Outlook sync, the VPN trio in EN and DE)
# score 0.90-0.96, while unrelated German tickets score 0.88-0.91 against each other, so 0.88 merged a
# web-shop outage, a CRM error and a billing question into one problem. At 0.90 almost none do. German
# text is still the weak spot (e5 cosines sit in a narrow band), so the console shows every merge.
PROBLEM_MATCH_SIM = 0.90
PROBLEM_RELATED_MIN_SIM = 0.80               # also show stored problems at least this similar
PROBLEM_RELATED_K = 3
ROOT_CAUSE_MIN_GROUP = 3             # this many similar live issues -> suggest raising a Problem
ROOT_CAUSE_WINDOW_MIN = 30           # live issues older than this drop out of grouping
ROOT_CAUSE_MIN_WORDS = 3             # too-short tickets ("help", emoji) are never grouped
# Known KB Problem/Change links search the retrieval (passage) index with the query vector, a
# different scale from query-vs-query. Unrelated issue->Problem/Change pairs: p90=0.849, p99=0.883;
# KB issues' best related Problem: p10=0.899, median 0.923. 0.89 sits just above unrelated p99.
ROOT_CAUSE_LINK_MIN_SIM = 0.89

# --- retrieval -----------------------------------------------
KB_EMB_PATH = ARTIFACTS / "kb_embeddings.npy"        # KB encoded with is_query=False, for retrieval
KB_META_PATH = ARTIFACTS / "kb_meta.parquet"         # same row order as KB_EMB_PATH

# Live store: precedents added during a session (see retrieve.add_precedent).
# Separate from the frozen index on purpose — evaluation passes include_live=False.
LIVE_DIR = Path(os.getenv("SD_LIVE_DIR", str(ARTIFACTS / "live")))   # SD_LIVE_DIR: isolate tests
LIVE_EMB_PATH = LIVE_DIR / "live_embeddings.npy"
LIVE_META_PATH = LIVE_DIR / "live_meta.parquet"
TOP_K = 5
DEDUP_SIMILARITY = 0.98             # drop a precedent this close to one already selected

# Places in the top-k reserved for a precedent in the OTHER language. e5 does
# not bridge languages on its own: by DETECTED language only 1-3% of hits cross
# over. 0 disables; evaluation passes 0 so metrics measure unaided retrieval.
CROSS_LINGUAL_SLOTS = 1

# Hybrid search: weight of the keyword (TF-IDF cosine) ranking in reciprocal-rank fusion
# with the e5 ranking. 0 = dense only. Displayed scores and gate floors stay e5 cosine.
# Chosen by scripts/hybrid_check.py on the KB validation slice.
HYBRID_LEXICAL_WEIGHT = 0.0
KB_LEX_PATH = ARTIFACTS / "kb_tfidf.npz"            # keyword index, row-aligned with KB_META_PATH

# --- escalation gate --------------------------------------------------------
# The hard rule (high priority + Incident or Problem) alone escalates 34.2% of holdout
# tickets (17.2% of KB tickets for Incident alone). Keep the soft thresholds tight or the
# overall escalation rate balloons and the copilot stops being useful.
# Similarity floors: calibrated on HAND-TYPED tickets, not KB percentiles. The dataset is
# synthetic and its own tickets sit unusually close to the KB (holdout top-1 p10 is 0.919), while
# 16 routine hand-typed tickets (scripts/typed_check.py) score 0.843-0.902. A KB-derived floor would
# hold back every ticket a person types, so these floors are only a weak off-topic filter.
MIN_TOP1_SIMILARITY = 0.8650
MIN_MEAN_TOP3_SIMILARITY = 0.8450
#
# Confidence floors: chosen by scripts/escalation_sweep.py on the 10% KB validation slice (never the
# holdout), through the real retrieve.search(), under the fixed similarity floors above, with a
# rule fixed before the sweep: >=95% of high-priority Incidents escalated and >=0.75 queue accuracy
# on auto-drafted tickets, then the most auto-drafting. Result (reports/escalation_sweep.json):
# 37.5% auto-drafted, 95.1% of high Incidents escalated, auto-drafted queue accuracy 0.751 vs 0.609
# overall.
MIN_CONFIDENCE = {
    "type": 0.0,
    "queue": 0.50,      # 10 classes at 21x imbalance; queue ECE 0.012, so this floor is meaningful
    "priority": 0.0,   # catches true high tickets the P(high)=0.25 rule labelled medium/low
}


# Requests that imply a commitment we cannot make without precedent.
UNSUPPORTED_ACTION_PATTERNS = [
    r"\brefund\b", r"\berstattung\b", r"\brückerstattung\b",
    r"\bcancel (my )?(contract|subscription)\b", r"\bkündig",
    r"\bsla\b", r"\bcompensation\b", r"\bentschädigung\b",
    r"\bchargeback\b", r"\blegal\b", r"\brechtlich\b",
    r"\bgdpr\b", r"\bdsgvo\b", r"\bdelete my (data|account)\b",
    r"\bwire transfer\b", r"\büberweisung\b",
]

# --- safety gate ------------------------------------------------------
# Risk regexes live in gate.RISK_PATTERNS (tested by tests/test_adversarial.py).
MIN_LETTERS = 3                      # fewer letters than this (emoji only, bare URL) -> human

# Burst / major-incident detector (burst.py). A ticket is part of a burst when at least
# BURST_MIN_COUNT tickets (itself included) within BURST_WINDOW_S have pairwise cosine
# >= BURST_SIM to it. e5 query-vs-query cosines sit in a narrow high band, so this is high.
# Tuned by scripts/attack_table.py: the German VPN ticket scores 0.884 against the English
# ones and the invoice ticket 0.795, so any value in (0.795, 0.88] works; 0.86 keeps margin
# on both sides (0.90 missed the cross-lingual ticket).
BURST_SIM = 0.86
BURST_MIN_COUNT = 3
BURST_WINDOW_S = 30 * 60

# Legacy list, kept for anything that still imports it; the gate uses gate.RISK_PATTERNS.
PROMPT_INJECTION_PATTERNS = [
    r"ignore (all |your |the )?(previous|prior|above) instructions",
    r"disregard (all |your |the )?(previous|prior|above)",
    r"you are now\b", r"system prompt", r"reveal your (prompt|instructions)",
]

# --- data -------------------------------------------------------------------
RANDOM_SEED = 42
TRAIN_FRACTION = 0.8
TARGETS = ["type", "queue", "priority", "language"]
