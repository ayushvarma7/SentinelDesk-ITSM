"""Gemini client for the agents: per-ticket call budget, global rate limit, structured JSON output.

Uses the REST endpoint through the standard library, so it works without google-genai installed.
Any failure raises LLMError and disables the session for the rest of the ticket (saves quota);
callers fall back to the pipeline's deterministic paths.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from collections import deque

from sentineldesk import config

from . import ROOT

MAX_CALLS_PER_TICKET = 3
RPM = int(os.environ.get("SD_AGENT_RPM", "12"))          # Gemini free tier is ~15/min; keep margin
TIMEOUT_S = float(os.environ.get("SD_AGENT_TIMEOUT", "30"))
RETRY_BACKOFF_S = 2.0
THINKING = os.environ.get("SD_AGENT_THINKING", "low")      # "" disables the thinkingConfig field
_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class LLMError(Exception):
    pass


def load_env(path=ROOT / ".env") -> None:
    """Minimal .env reader (python-dotenv may not be installed). Never overrides real env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and v and k not in os.environ:
            os.environ[k] = v


load_env()


def model_name() -> str:
    return os.environ.get("SD_LLM_MODEL") or config.LLM_MODEL


_calls: deque[float] = deque()
_lock = threading.Lock()


def _throttle() -> float:
    """Block until a call fits in the RPM window. Returns seconds waited."""
    waited = 0.0
    with _lock:
        while True:
            now = time.monotonic()
            while _calls and now - _calls[0] >= 60:
                _calls.popleft()
            if len(_calls) < RPM:
                _calls.append(now)
                return waited
            w = 60 - (now - _calls[0]) + 0.05
            time.sleep(w)
            waited += w


def _generate(system: str, user: str, schema: dict, max_tokens: int) -> dict:
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "temperature": 0.2,
            "maxOutputTokens": max_tokens,
        },
    }
    # Thinking tokens count against maxOutputTokens and truncated the JSON in testing; keep it low.
    if THINKING and model_name().startswith("gemini-3"):
        body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": THINKING}
    req = urllib.request.Request(
        _URL.format(model=model_name()), data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:160].replace("\n", " ")
        raise LLMError(f"HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LLMError(f"network: {e}") from e

    cands = data.get("candidates") or []
    if not cands:
        raise LLMError(f"no candidates (promptFeedback={data.get('promptFeedback')})")
    parts = (cands[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"bad JSON (finishReason={cands[0].get('finishReason')}): {text[:80]!r}") from e


class LLMSession:
    """One per ticket. Enforces MAX_CALLS_PER_TICKET and stops after the first error."""

    def __init__(self, max_calls: int = MAX_CALLS_PER_TICKET):
        self.max_calls = max_calls
        self.calls = 0
        self.disabled: str | None = None if os.environ.get("GEMINI_API_KEY") else "GEMINI_API_KEY not set"
        self.fallbacks: list[str] = []

    def unavailable(self) -> str | None:
        if self.disabled:
            return self.disabled
        if self.calls >= self.max_calls:
            return f"LLM budget exhausted ({self.max_calls} calls per ticket)"
        return None

    def call_json(self, system: str, user: str, schema: dict,
                  max_tokens: int | None = None) -> tuple[dict, float]:
        """Returns (parsed_json, seconds_waited_for_rate_limit). Raises LLMError."""
        why = self.unavailable()
        if why:
            raise LLMError(why)
        waited = 0.0
        while True:
            self.calls += 1
            waited += _throttle()
            try:
                out = _generate(system, user, schema, max_tokens or max(config.LLM_MAX_TOKENS, 4096))
                break
            except LLMError as e:
                # One backoff retry on transient overload, only if the per-ticket budget allows it.
                transient = str(e).startswith(("HTTP 503", "HTTP 429"))
                if transient and self.calls < self.max_calls and not getattr(self, "_retried", False):
                    self._retried = True
                    self.fallbacks.append(f"retry after: {str(e)[:60]}")
                    time.sleep(RETRY_BACKOFF_S)
                    waited += RETRY_BACKOFF_S
                    continue
                self.disabled = f"disabled after error: {e}"[:200]
                raise
        if not isinstance(out, dict):
            self.disabled = "disabled after non-object JSON"
            raise LLMError("response JSON is not an object")
        return out, waited
