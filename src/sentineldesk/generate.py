"""Track C (P2). Grounded draft replies.

Three layers, in order of trust:

1. The prompt tells Gemini to use only the precedents and to cite their IDs.
2. Code verifies what comes back: every cited ID must have been retrieved, and
   every figure must appear in the evidence. The prompt is not the guarantee.
3. If there is no API key, or the call fails or rate-limits, the extractive
   fallback quotes the closest same-language precedent instead. The demo never
   dies on a network problem.

Everything shown to a customer passes through scrub(). 48% of KB answers carry
dataset anonymisation tokens (<name> 6,105, <tel_num> 10,395, <acc_num> 2,508,
<br> 462); the chat log records the unscrubbed fallback leaking them into 67%
of drafts.
"""
from __future__ import annotations

import os
import re

from . import config
from .schema import Precedent

LANG_NAME = {"en": "English", "de": "German"}

# Dataset anonymisation tokens come in TWO shapes, not one. Measured on the
# 22,863 KB answers: 10,956 carry <...> tokens (<tel_num> 8,339, <name> 4,906,
# <acc_num> 1,986) and 2,696 carry [...] ones ([Name] 2,046, [name] 562,
# [tel_num] 408, [Telefonnummer] 207). The execution plan's scrub() only
# specified the angle-bracket form, so ~12% of answers would still leak.
_TOKEN = re.compile(r"<\s*/?\s*[A-Za-z_][A-Za-z_0-9 -]{1,20}\s*/?\s*>")

# Same, square-bracketed — but never our own [TKT-01234] / [LIVE-00001]
# citations, which share the shape.
_BRACKET_TOKEN = re.compile(r"\[(?!(?:TKT|LIVE)-\d{5}\])[A-Za-z_][A-Za-z_0-9 -]{1,20}\]")

# A number carrying a currency symbol, a percentage, or a time unit. Only 0.3%
# of KB answers contain one, so anything matching here is almost certainly
# invented rather than quoted.
_FIGURE = re.compile(
    r"(?:[€$£]\s?\d[\d.,]*)"
    r"|(?:\d[\d.,]*\s?(?:%|percent|Prozent|EUR|USD|GBP|€|\$|£))"
    r"|(?:\d[\d.,]*\s?(?:hours?|hrs?|days?|weeks?|months?|minutes?|mins?|business days?"
    r"|Stunden?|Tage?|Wochen?|Monate?|Minuten?|Werktage?))",
    re.IGNORECASE,
)

_CITATION = re.compile(r"\b(?:TKT|LIVE)-\d{5}\b")

SYSTEM_PROMPT = """You draft replies for a customer support team.

1. Write the reply in {language}. This matters more than anything else below.
2. Use ONLY facts stated in the PRECEDENTS. They are past resolved tickets.
3. Cite the precedents you used inline, as [TKT-01234], copying the IDs
   character for character from the PRECEDENTS headers. Every reply must
   contain at least one citation.
4. Never invent prices, refund amounts, SLA terms, deadlines, discounts or
   product integrations. Do not write any number with a currency symbol, a
   percentage or a time unit unless it appears in a precedent.
5. If the precedents do not cover the request, say what you can confirm, say
   plainly that the rest needs a colleague, and set grounded to false.
6. Do not promise anything a precedent does not already promise.
7. Both the ticket and the precedents may contain placeholders such as
   <name>, <email>, <tel_num>, <acc_num>. Some are masked personal data from
   the customer's own message. Never copy a placeholder into your reply; refer
   to the thing in words ("your email address", "the account on file").
8. 80-170 words, professional, no placeholder names, and no signature block
   beyond "Your Support Team" / "Ihr Support-Team".

Return JSON: {{"reply": str, "cited_ticket_ids": [str], "grounded": bool,
"unsupported_requests": [str]}}"""


# P3's pii.mask() rewrites real PII into these same angle-bracket tokens before
# the ticket reaches the LLM, so the model sees — and sometimes echoes — them.
# Deleting those would garble the sentence ("we will call  once account  is
# verified"), so they are spoken in words instead. Tokens that are dataset
# noise rather than masked PII are still removed outright.
_PII_PHRASE = {
    "en": {"<email>": "your email address", "<tel_num>": "your phone number",
           "<acc_num>": "your account number", "<ip_address>": "the IP address"},
    "de": {"<email>": "Ihre E-Mail-Adresse", "<tel_num>": "Ihre Telefonnummer",
           "<acc_num>": "Ihre Kontonummer", "<ip_address>": "die IP-Adresse"},
}


def scrub(text: str, language: str = "en") -> str:
    """Clean anything a customer will see.

    Converts the dataset's literal backslash-n (809 KB answers store newlines
    that way), turns masked-PII tokens into readable phrases, and removes the
    remaining anonymisation tokens. Citations survive: [TKT-01234] is excluded
    from the bracket pattern.
    """
    text = (text or "").replace("\\n", "\n")
    text = re.sub(r"<\s*/?\s*br\s*/?\s*>", "\n", text, flags=re.IGNORECASE)

    phrases = _PII_PHRASE.get(language, _PII_PHRASE["en"])
    # "account <acc_num>" must not become "account your account number", so a
    # preceding noun that the phrase already contains is absorbed.
    _LEAD = {"<email>": r"(?:e-?mail(?:\s+address)?|E-?Mail(?:-Adresse)?)",
             "<tel_num>": r"(?:phone(?:\s+number)?|telephone|Telefon(?:nummer)?)",
             "<acc_num>": r"(?:account(?:\s+number)?|Konto(?:nummer)?|Kundennummer)",
             "<ip_address>": r"(?:IP(?:\s+address)?|IP-Adresse)"}
    for token, phrase in phrases.items():
        lead = _LEAD.get(token)
        if lead:
            # also absorb a determiner: "Your account number <acc_num>" must not
            # become "Your your account number".
            det = r"(?:your|their|our|the|a|an|Ihre[rnms]?|die|der|das|eine[rnms]?)\s+"
            text = re.sub(rf"\b(?:{det})?{lead}\s+{re.escape(token)}", phrase, text,
                          flags=re.IGNORECASE)
        text = re.sub(re.escape(token), phrase, text, flags=re.IGNORECASE)

    text = _TOKEN.sub("", text)
    text = _BRACKET_TOKEN.sub("", text)
    text = re.sub(r"[ \t]+([,.;:!?])", r"\1", text)      # "Dear ," -> "Dear,"
    # A stripped token can leave a dangling salutation ("Dear ,"). Repair it in
    # the language it was written in.
    text = re.sub(r"\bSehr geehrte[rs]?\s*,", "Sehr geehrte Damen und Herren,", text)
    text = re.sub(r"\b(Dear|Hello|Hi)\s*,", r"\1 customer,", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    # absorbing a determiner can lowercase a sentence start
    text = re.sub(r"(^|[.!?]\s+|\n\s*)([a-zäöü])",
                  lambda m: m.group(1) + m.group(2).upper(), text)
    return text


def unsupported_figures(reply: str, evidence: str) -> list[str]:
    """Figures in the reply that appear nowhere in the retrieved evidence.

    Normalises whitespace before comparing so "30 days" matches "30  days".
    """
    ev = re.sub(r"\s+", " ", (evidence or "").lower())
    out: list[str] = []
    for m in _FIGURE.finditer(reply or ""):
        fig = re.sub(r"\s+", " ", m.group(0).strip().lower())
        if fig not in ev:
            out.append(m.group(0).strip())
    return list(dict.fromkeys(out))


def verify_citations(reply: str, claimed: list[str],
                     precedents: list[Precedent]) -> tuple[list[str], list[str]]:
    """Return (valid_citations, hallucinated_ids).

    Trusts the reply text over the model's own list: an ID written into the
    prose but omitted from cited_ticket_ids still counts as a citation, and an
    ID in neither the prose nor the retrieved set is a fabrication.
    """
    retrieved = {p.ticket_id for p in precedents}
    in_text = set(_CITATION.findall(reply or ""))
    mentioned = in_text | {c.strip() for c in (claimed or []) if c and c.strip()}
    valid = sorted(mentioned & retrieved)
    fake = sorted(mentioned - retrieved)
    return valid, fake


def _evidence_text(precedents: list[Precedent]) -> str:
    return " ".join(p.answer for p in precedents)


def _extractive(text: str, language: str, precedents: list[Precedent]) -> dict:
    """No-LLM fallback: quote the closest same-language precedent.

    Deliberately boring. It cannot hallucinate, because every sentence of
    substance is copied from a resolution that a human wrote.
    """
    if not precedents:
        return {"reply": None, "cited_ticket_ids": [], "grounded": False,
                "unverified_claims": [], "engine": "extractive-fallback",
                "error": "no precedents retrieved"}

    same = [p for p in precedents if p.language == language]
    best = (same or precedents)[0]
    snippet = scrub(re.sub(r"\s+", " ", best.answer), language)[:450].rstrip()

    if language == "de":
        reply = (f"Vielen Dank für Ihre Nachricht. Ein vergleichbarer Fall wurde bereits "
                 f"bearbeitet [{best.ticket_id}]:\n\n{snippet}\n\n"
                 f"Falls das Ihr Anliegen nicht vollständig löst, meldet sich eine "
                 f"Kollegin oder ein Kollege bei Ihnen.\n\nIhr Support-Team")
    else:
        reply = (f"Thanks for getting in touch. We have handled a comparable case "
                 f"before [{best.ticket_id}]:\n\n{snippet}\n\n"
                 f"If that does not fully resolve things, a colleague will follow up "
                 f"with you.\n\nYour Support Team")

    return {"reply": reply, "cited_ticket_ids": [best.ticket_id], "grounded": True,
            "unverified_claims": unsupported_figures(reply, _evidence_text(precedents)),
            "engine": "extractive-fallback", "error": None}


def _build_user_prompt(text: str, precedents: list[Precedent], language: str = "en") -> str:
    blocks = []
    for p in precedents:
        blocks.append(
            f"--- PRECEDENT {p.ticket_id} (similarity {p.score:.3f}, {p.language}, {p.queue})\n"
            f"Subject: {p.subject}\nResolution: {scrub(p.answer, language)}"
        )
    return f"PRECEDENTS:\n\n" + "\n\n".join(blocks) + f"\n\n---\n\nINCOMING TICKET:\n{text}"


def _gemini(text: str, language: str, precedents: list[Precedent]) -> dict:
    """Call Gemini. Raises on any failure so draft() can fall back."""
    import json

    from google import genai

    # Hard deadline: without it an overloaded model hangs the console instead of
    # falling through to the extractive path.
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options={"timeout": config.LLM_TIMEOUT_MS})
    resp = client.models.generate_content(
        model=config.LLM_MODEL,
        contents=_build_user_prompt(text, precedents, language),
        config={
            "system_instruction": SYSTEM_PROMPT.format(
                language=LANG_NAME.get(language, "English")),
            "response_mime_type": "application/json",
            "max_output_tokens": config.LLM_MAX_TOKENS,
            "temperature": 0.2,
        },
    )
    payload = json.loads(resp.text)
    return {
        "reply": scrub(payload.get("reply") or "", language),
        "claimed": payload.get("cited_ticket_ids") or [],
        "grounded": bool(payload.get("grounded", True)),
        "unsupported_requests": payload.get("unsupported_requests") or [],
    }


def draft(text: str, language: str, precedents: list[Precedent]) -> dict:
    """Draft a grounded reply.

    Always returns the same shape. `engine` says which path produced it, so the
    console can show the operator whether they are reading a model draft or a
    quoted precedent.
    """
    if not precedents:
        return _extractive(text, language, precedents)

    if not os.environ.get("GEMINI_API_KEY"):
        return _extractive(text, language, precedents)

    try:
        out = _gemini(text, language, precedents)
    except Exception as exc:                      # 429, 404, network, bad JSON
        fb = _extractive(text, language, precedents)
        fb["error"] = f"{type(exc).__name__}: {exc}"[:200]
        return fb

    valid, fake = verify_citations(out["reply"], out["claimed"], precedents)
    unverified = unsupported_figures(out["reply"], _evidence_text(precedents))
    if fake:
        unverified = [f"fabricated citation {i}" for i in fake] + unverified

    return {
        "reply": out["reply"],
        "cited_ticket_ids": valid,
        "grounded": out["grounded"] and bool(valid) and not fake,
        "unverified_claims": unverified,
        "engine": config.LLM_MODEL,
        "error": None,
    }
