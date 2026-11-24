"""Pure text helpers. No pandas, no models — safe to import from anywhere."""
from __future__ import annotations

import re

_BR = re.compile(r"<\s*/?\s*br\s*/?\s*>", re.IGNORECASE)


def clean_text(s: str | None) -> str:
    """Normalise raw dataset text.

    The dataset stores newlines as the two characters backslash + n (not real newlines) and some
    fields contain <br> tags. Left in, TF-IDF turns "\\nThe" into a junk token "nThe".
    """
    if not isinstance(s, str):
        return ""
    s = s.replace("\\n", "\n")
    s = _BR.sub("\n", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def build_text(subject: str | None, body: str | None) -> str:
    """The one place ticket text is assembled.

    14% of tickets have no subject (16% of English ones), so this must never
    assume either field is present.
    """
    return f"{clean_text(subject)}\n{clean_text(body)}".strip()
