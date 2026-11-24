"""OWNER: P2. Score drafts on holdout tickets, end to end.

Runs N English + N German holdout tickets through the real pipeline and scores
the drafts on the things that decide whether the grounding story holds:
citations present, citations real, figures supported, right language, no
dataset placeholders leaking.

Only subject + body ever reach the pipeline. Labels are read once, for
reporting the language breakdown, exactly as scripts/evaluate.py does.

Run:  PYTHONPATH=src python scripts/draft_eval.py          (SD_DRAFT_N=5 for a quick pass)
"""
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from sentineldesk import config, data, retrieve
from sentineldesk.generate import unsupported_figures
from sentineldesk.pipeline import _detected_language, triage
from sentineldesk.text import build_text

N = int(os.getenv("SD_DRAFT_N", "10"))
WORKERS = int(os.getenv("SD_DRAFT_WORKERS", "3"))   # 8 triggers 504s on the capacity-limited model
PLACEHOLDER = re.compile(r"<[A-Za-z_][A-Za-z_0-9 -]{1,20}>"
                         r"|\[(?!(?:TKT|LIVE)-\d{5}\])[A-Za-z_][A-Za-z_0-9 -]{1,20}\]")


def score_one(row) -> dict:
    r = triage(row["subject"], row["body"], track_burst=False)   # eval traffic must not fake a burst
    reply = r.draft_reply or ""
    retrieved = {p.ticket_id for p in r.precedents}
    cited = set(re.findall(r"\b(?:TKT|LIVE)-\d{5}\b", reply))
    evidence = " ".join(p.answer for p in r.precedents)
    return {
        "ticket_id": row["ticket_id"],
        "true_language": row["true_language"],
        "engine": r.engine,
        "escalated": r.escalate,
        "drafted": bool(reply),
        "has_citation": bool(cited),
        "fake_citation": bool(cited - retrieved),
        "invented_figures": bool(unsupported_figures(reply, evidence)),
        # vs the dataset label (noisy: ~12% of "de" tickets are written in English) ...
        "right_language": r.language == row["true_language"],
        # ... and vs the language the customer actually wrote in (langdetect on the text)
        "right_language_text": r.language == (
            (_detected_language(build_text(row["subject"], row["body"])) or (row["true_language"],))[0]),
        "placeholder_leak": bool(PLACEHOLDER.search(reply)),
        "words": len(reply.split()),
        "latency_ms": round(r.latency_ms["total"], 1),
    }


def main() -> None:
    inputs = data.load_test_inputs()
    langs = data.load_test_labels().set_index("ticket_id")["language"]
    inputs["true_language"] = inputs["ticket_id"].map(langs)

    sample = pd.concat([inputs[inputs["true_language"] == lg].sample(n=N, random_state=7)
                        for lg in ("en", "de")]).reset_index(drop=True)

    # The live store must be empty: a demo entry would change the precedents and
    # make this number irreproducible.
    if retrieve.live_count():
        raise SystemExit("live store is not empty — run retrieve.clear_live() first")

    triage(sample.iloc[0]["subject"], sample.iloc[0]["body"], track_burst=False)   # warm the model
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        rows = list(pool.map(score_one, (r for _, r in sample.iterrows())))

    df = pd.DataFrame(rows)
    out = config.ROOT / "reports"
    out.mkdir(parents=True, exist_ok=True)
    df.to_csv(out / "draft_eval.csv", index=False)

    drafted = df[df["drafted"]]
    summary = {
        "n": len(df),
        "escalated": round(float(df["escalated"].mean()), 3),
        "drafted": int(len(drafted)),
        "engine": df["engine"].dropna().mode().iloc[0] if df["engine"].notna().any() else None,
    }
    for c in ("has_citation", "fake_citation", "invented_figures",
              "right_language", "right_language_text", "placeholder_leak"):
        summary[c] = round(float(drafted[c].mean()), 3) if len(drafted) else None
    summary["median_words"] = float(drafted["words"].median()) if len(drafted) else None
    summary["p50_latency_ms"] = float(df["latency_ms"].median())
    summary["p95_latency_ms"] = float(df["latency_ms"].quantile(0.95))

    json.dump(summary, open(out / "draft_eval.json", "w"), indent=2)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
