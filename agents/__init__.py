"""Agent layer on top of the SentinelDesk pipeline.

    from agents.run import run_agents
    out = run_agents("VPN down", "All users lost VPN ...")

Reuses src/sentineldesk (pii, gate, generate, schema, retrieve, classify) and never edits it.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for _p in (ROOT / "src", ROOT / "api"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))
