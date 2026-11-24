"""OWNER: P2 (P2.1). Prove the Gemini key works and the model name is current.

Run:  PYTHONPATH=src python scripts/check_llm.py
"""
import os

from google import genai

from sentineldesk import config


def main() -> None:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise SystemExit("GEMINI_API_KEY not set. cp .env.example .env, fill it, then:\n"
                         "  export $(grep -v '^#' .env | xargs)")

    client = genai.Client(api_key=key)
    names = [m.name for m in client.models.list()]
    flash = [n.removeprefix("models/") for n in names if "flash" in n]
    print(f"flash models available ({len(flash)}):")
    for n in flash[:15]:
        print("   ", n)

    print(f"\nconfigured LLM_MODEL = {config.LLM_MODEL}")
    if config.LLM_MODEL not in flash:
        print("  !! not in the list — pick one above and set SD_LLM_MODEL or config.LLM_MODEL")

    r = client.models.generate_content(
        model=config.LLM_MODEL,
        contents='Reply with exactly this JSON: {"ok": true}',
        config={"response_mime_type": "application/json"},
    )
    print(f"\n{config.LLM_MODEL} -> {r.text.strip()}")


if __name__ == "__main__":
    main()
