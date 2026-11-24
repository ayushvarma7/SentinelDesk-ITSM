"""Data access. The ONLY module that reads from disk.

Leakage discipline is structural, not remembered: `load_test_inputs()` returns a
frame that physically has no label columns, so the inference path cannot cheat
even by accident. Labels live in a separate file behind `load_test_labels()`,
which only scripts/evaluate.py may call.
"""
from __future__ import annotations

import pandas as pd

from .config import DATA_PROCESSED
from .text import build_text  # re-exported for convenience

__all__ = ["build_text", "load_kb", "load_test_inputs", "load_test_labels"]

LABEL_COLUMNS = ["type", "queue", "priority", "language", "answer"]



def load_kb() -> pd.DataFrame:
    """The 80% split: trainable, indexable, includes `answer`."""
    df = pd.read_parquet(DATA_PROCESSED / "kb_train.parquet")
    # 6 rows have no answer and would produce an empty precedent.
    return df[df["answer"].notna() & (df["answer"].str.strip() != "")].reset_index(drop=True)


def load_test_inputs() -> pd.DataFrame:
    """The 20% holdout, inputs only: ticket_id, subject, body. No labels exist here."""
    return pd.read_parquet(DATA_PROCESSED / "test_inputs.parquet")


def load_test_labels() -> pd.DataFrame:
    """Holdout ground truth.

    EVALUATION ONLY. Importing this anywhere under src/sentineldesk/ outside of
    this file, or in app/, is a disqualification risk. scripts/evaluate.py is the
    only legitimate caller.
    """
    return pd.read_parquet(DATA_PROCESSED / "test_labels.parquet")
