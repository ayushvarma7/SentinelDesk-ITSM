"""Mask PII before any text leaves the machine for an external LLM API.

OWNER: P3. Masks with the dataset's own anonymisation tokens (<email>, <tel_num>,
<acc_num>), so a masked live ticket looks exactly like the training/KB text the
classifier and retriever were built on.
"""
from __future__ import annotations

import re

# same tokens the dataset already uses, so masked live tickets look like training data
TOKENS = {
    "email": "<email>",
    "iban": "<acc_num>",
    "card": "<acc_num>",
    "ip": "<ip_address>",
    "account": "<acc_num>",
    "phone": "<tel_num>",
}

PATTERNS: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    # IBAN with or without the usual 4-character grouping spaces
    "iban": re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b"),
    "card": re.compile(r"\b(?:\d[ -]?){12,18}\d\b"),
    "ip": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    # Keep the keyword and its label, mask only the value: "account number: <acc_num>",
    # "Kundennummer: <acc_num>". The value must contain a digit, so "account is locked" and the word
    # "number" itself are never masked.
    "account": re.compile(
        r"\b(acct|account|konto|kundennummer|customer|kd-nr)"
        r"((?:\s*(?:number|num|no|nr|nummer|id))?\.?\s*[#:]?\s*)"
        r"((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,})\b",
        re.I),
    # candidate phone numbers; _phone() keeps only those with 7-15 digits that are not dates
    "phone": re.compile(r"(?<![\w<])\+?\(?\d[\d ()./-]{5,}\d(?![\w>])"),
}

# Order matters: email before phone, IBAN/card before phone, or the digits get eaten.
ORDER = ["email", "iban", "card", "ip", "account", "phone"]

_DATE = re.compile(r"^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$")


def _phone(m: re.Match) -> str:
    s = m.group(0)
    digits = sum(c.isdigit() for c in s)
    if not 7 <= digits <= 15 or _DATE.match(s.strip()):
        return s
    return TOKENS["phone"]


def mask(text: str) -> tuple[str, dict[str, int]]:
    """Return (masked_text, {kind: count}). Counts only non-zero kinds."""
    counts: dict[str, int] = {}
    out = text or ""
    for kind in ORDER:
        pat = PATTERNS[kind]
        if kind == "account":
            out, n = pat.subn(lambda m: f"{m.group(1)}{m.group(2) or ' '}{TOKENS['account']}", out)
        elif kind == "phone":
            n = 0

            def repl(m: re.Match) -> str:
                nonlocal n
                r = _phone(m)
                n += r != m.group(0)
                return r
            out = pat.sub(repl, out)
        else:
            out, n = pat.subn(TOKENS[kind], out)
        if n:
            counts[kind] = n
    return out, counts


mask_pii = mask  # name used in the execution plan
