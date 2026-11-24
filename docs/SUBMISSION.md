# SentinelDesk: what was asked, what we built, how

A high-level map of the hackathon brief to the delivered system. Details are in [README.md](../README.md).

## The problem

IT help desks have two failure modes:

- **Missed outages:** critical incidents, like a VPN failure cutting off hospital systems, wait in the same inbox as
  routine questions.
- **AI replies that hallucinate:** generic chatbots invent refunds, SLAs and fixes that past resolutions never offered.

SentinelDesk takes a raw ticket (subject and body, English or German) and classifies it, decides safely whether AI
may answer it, finds matching past resolutions, and drafts a reply grounded in them.

## Core requirements

| # | Asked for | What we built | How |
|---|---|---|---|
| 1 | **Multi-task triage engine:** type, queue and priority with confidence from subject (optional) and body. | Four classifier heads (type, queue, priority, language), each returning a label, a confidence and the full probability spread. Missing subjects are handled. | Word TF-IDF next to a multilingual e5 embedding, one class-balanced logistic regression per head. Priority is `high` when P(high) ≥ 0.25, so urgent tickets are caught. |
| 1 | **Holdout metrics:** Macro-F1 and High-Priority Incident Recall on the 20% split. | Macro-F1 type 0.878, queue 0.611, priority 0.620. High-priority Incident recall 0.852 by the model and 0.902 by the full pipeline. Calibration error 0.01–0.08. | `scripts/evaluate.py` runs once per frozen model on 5,718 unseen tickets and writes `reports/triage_metrics.json`. All settings were chosen on a KB validation slice, never the holdout. |
| 2 | **Confidence and risk escalation gate:** high + Incident, low classifier or retrieval similarity, unsupported actions. | A deterministic gate with three outcomes (Auto-draft ready, Needs human review, Escalate to on-call) and a one-line reason for every rule that fired. | On-call for high-priority Incidents/Problems, a probability-level critical score, outage + urgency words, outage bursts and shared root causes. Human review for low queue confidence, weak precedents, refunds with no supporting precedent, prompt injection, credential requests, destructive actions, legal threats and empty input. No LLM in the decision. |
| 3 | **Evidence-backed RAG:** index the KB split, retrieve top-k, reply in the user's language, cite ticket IDs, never fabricate. | Top-5 retrieval over the 22,863 KB tickets; drafts in English or German that cite `[TKT-…]` IDs. Measured: 100% of drafts cite a real ticket, 0 fake citations, 0 invented figures. | e5 passage index with exact cosine search. Gemini drafts JSON from the masked ticket; code then rejects any citation that wasn't retrieved and any figure that isn't in a precedent. No key or a failure falls back to quoting the closest precedent. |
| 4 | **Live triage console:** paste unseen tickets; see type, queue, priority, confidence, latency, the status badge, retrieved tickets and the draft. | A Streamlit console in Northeastern colours. **Live triage** shows every required field for any pasted ticket, plus 15 sample tickets. It also has a customer portal, an organisation queue and a dashboard. | `sentinel_ui/backend.py` adapts the pipeline's result for the UI. The models load once at startup; a typical ticket takes about 100–200 ms without the LLM. |

## Bonus features

| Asked for | What we built | How |
|---|---|---|
| **Cross-lingual precedent matching** | A German ticket gets English precedents (and the reverse), but the reply is in the customer's language. | e5 alone barely crosses languages here (1–3% of hits), so one of the top-5 slots is reserved for the best precedent in the other language. |
| **Outage / burst detection** | A red **Major Incident** banner when 3+ similar tickets arrive within 30 minutes, in any language. It shows on Live triage, the Organisation queue and the portal status. The dashboard lists every detected incident. | A rolling window of ticket embeddings, cosine ≥ 0.86. The detector is primed from stored tickets at startup, so an outage in progress survives a restart. An outage drill demonstrates it. |
| **PII guardrail** | Emails, phone numbers, IPs, IBANs, card and account numbers are masked before any LLM call. The console shows what was masked and the exact text sent. | Regex masking with the dataset's own tokens (`<email>`, `<tel_num>`, `<acc_num>`). Labels and references stay: "account number: 72942442" becomes "account number: `<acc_num>`", while the bank name and payment reference are kept. |

## Beyond the brief

- **Safety tested adversarially:** 26 attack and look-alike tickets in English and German, plus a burst scenario.
  The attack table passes 27/27, and injections never get a draft.
- **ITIL root-cause grouping:** similar live incidents suggest raising a Problem record, linked to the closest known
  Problem and Change.
- **Learning loop:** an agent-edited resolution becomes a citable precedent immediately; AI drafts are never re-indexed.
- **Realistic demo data:** a week of portal traffic replayed through the real pipeline, with VPN, Outlook and Canvas
  outages, plus demo accounts.
- **One-command setup:** `./run.sh setup` then `./run.sh demo`.

## Fair play

- **Official split:** the organisers' seed-42 80/20 split on the recommended 28,587-ticket file.
- **Labels kept apart:** holdout labels live in a separate file that only the evaluation script reads.
- **Answers:** only KB answers are indexed or shown.
- **Tuning:** thresholds and hyperparameters come from a 10% slice of the KB.
- **No 20k file:** it is never mixed in, because it shares 8,399 bodies with the main file.

## Honest limits

- **Queue routing is the weakest head** (macro-F1 0.61): 10 overlapping teams and noisy labels. Short hand-typed
  tickets are sometimes routed to an unexpected team, which is why queue confidence below 0.50 goes to human review.
- **Similarity is a weak signal on hand-typed text,** because the synthetic dataset's own tickets sit unusually close
  together. The similarity floor was calibrated on hand-typed tickets, not KB percentiles.
- **The console's ticket store is a local JSON file,** fine for a demo. Production would need a database and masked storage.
