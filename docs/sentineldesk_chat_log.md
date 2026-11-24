# SentinelDesk: hackathon chat log

GDG hackathon, 21 November 2026. Six-hour build, team of four.
This file records everything decided and produced in the planning chat, in order.

Related deliverables:
- Code scaffold: `sentineldesk.zip` (first build plus the parallel-work update)
- Full execution plan doc: https://claude.ai/artifact/3w4TJWC4NCZ5t8PqRDv4cM

---

## 1. The problem statement

**SentinelDesk: Autonomous Incident Triage and Grounded Resolution Copilot.**
Track: Applied AI, NLP, RAG and agentic workflows. Time limit: 6 hours.

### What the system must do for each incoming ticket (subject + body)

1. **Classify and prioritize.** Predict `type` (Incident, Request, Problem, Change), `queue` (department) and `priority` (high, medium, low), each with a calibrated confidence score.
2. **Escalation and safety gate.** Decide whether the ticket can get an AI-drafted reply or must go to a human. Escalate on high-priority Incidents, low confidence, low retrieval similarity, or requests with no historical precedent.
3. **Retrieve precedents (RAG).** Find the top 3 to 5 similar resolved tickets.
4. **Draft a grounded reply** in the customer's language (English or German), using only what the retrieved resolutions say, citing their ticket IDs, and never inventing policies, prices or guarantees.

### Dataset

- Hugging Face `Tobi-Bueck/customer-support-tickets`, licence CC-BY-NC-4.0.
- Recommended file: `aa_dataset-tickets-multi-lang-5-2-50-version.csv`.
- Columns: `subject` (nullable), `body`, `type`, `queue`, `priority`, `language`, `tag_1..tag_8`, `answer`.
- **Leakage rule:** `answer` may be indexed only from the 80% knowledge-base split. The 20% holdout's answers and labels must never be used at inference time.
- Official split: shuffle with `random_state=42`, assign `TKT-xxxxx` ids, first 80% is the KB, last 20% is the holdout.

### Required deliverables

- Holdout metrics: macro-F1 for each label and high-priority Incident recall.
- Explicit escalation rules.
- A RAG generator that cites ticket IDs and refuses to fabricate.
- A live console where judges paste unseen tickets and see the predictions, confidence, latency, escalation badge, retrieved tickets and draft reply.

### Optional bonuses

- Cross-lingual precedent matching (English precedent for a German ticket, or the reverse).
- Outage or burst detection with a "Major Incident" banner.
- A PII guardrail that masks emails, phones, IPs and account numbers before any LLM call.

### Judging

5-minute live demo, 3-minute Q&A where judges type their own tickets, a public repo with an evaluation script, and disqualification for data leakage.

---

## 2. First build: the full MVP scaffold

Claude built a complete working codebase covering all 4 required parts and all 3 bonuses, and smoke-tested it with a mock embedder on synthetic data.

### Architecture

```
ticket -> PII mask (email/phone/IP/IBAN/card/account) -> language detect (langdetect + German heuristic)
       -> multilingual-e5-small embedding (local)
       |-> triage heads: [TF-IDF 1-2gram || e5 embedding] -> 3x LogisticRegression (class_weight balanced)
       |      priority uses a P(high) threshold tuned on a KB validation slice for >=80% high recall
       |-> retrieval: cosine top-k over KB embeddings (FAISS, numpy fallback), cross-lingual by construction
       |-> pre-gate -> Gemini draft (JSON: reply, cited ids, grounded, unsupported_requests)
       '-> post-gate -> AUTO_DRAFT_READY | HUMAN_REVIEW | ESCALATE_ONCALL (+ reasons)
```

### Files

| File | Purpose |
| --- | --- |
| `config.py` | Paths, model names, default gate thresholds |
| `data.py` | Loading, cleaning, official split, `ticket_text()` handling null subjects |
| `embed.py` | Sentence-transformers wrapper (e5 with the `query:` prefix, normalized vectors) |
| `model.py` | Feature builder, multi-head prediction with the P(high) override, `Retriever` (FAISS or numpy) |
| `pii.py` | Regex PII masking |
| `gate.py` | Risk regexes, pre-gate, post-gate (citation check, invented-figure check), final decision |
| `pipeline.py` | `SentinelDesk.triage()` end to end, Gemini call, extractive fallback, burst detection |
| `build_index.py` | Offline build (later split into two scripts) |
| `evaluate.py` | Holdout metrics: macro-F1, ECE, high-Incident recall, gate escalation recall, retrieval stats, latency |
| `app.py` | Streamlit console with live threshold sliders, sample tickets, burst simulator |
| `README.md` | Setup, architecture, gate rules, leakage guarantees, demo script |

### Escalation gate rules

| Rule | Result |
| --- | --- |
| Predicted `priority=high` and `type=Incident` | Escalate to on-call |
| 3 or more near-identical live tickets within 30 minutes | Escalate to on-call + major-incident banner |
| Any head's confidence below its threshold | Human review |
| Top precedent similarity below threshold | Human review (no precedent) |
| Prompt injection, credential request, destructive action, legal threat | Human review (injection also blocks drafting) |
| Draft has no citation, or cites an ID that wasn't retrieved | Human review |
| LLM flags the request as unsupported or not grounded | Human review |
| Draft contains a money, % or time figure not found in any retrieved resolution | Human review |

### Design choices

- **Gemini for drafting** (it's a Google Developer Group event). Without an API key, an extractive fallback quotes the closest same-language resolution, so the demo never dies.
- **Logistic regression over a fine-tuned transformer:** fast (about 20 ms per ticket), calibrated probabilities the gate can threshold, minutes to train.
- **Leakage safety:** the split is the organisers' snippet verbatim, thresholds are tuned on a KB validation slice, and the holdout is written without its answer column.

---

## 3. First work split (four people)

Claude explained the problem in plain terms, then split the work:

- **P1, data and triage:** classifier, evaluation, metrics table.
- **P2, retrieval and RAG drafting:** embeddings, index, prompt, German quality.
- **P3, safety gate and guardrails:** adversarial tests, thresholds, burst detection.
- **P4, UI, integration and demo:** Streamlit console, README, merges, rehearsal.

Team checkpoints: 0:45 quick build working, 2:00 first metrics and merge, 4:00 model/prompt/gate frozen, 5:00 code freeze, 5:30 full rehearsal.

---

## 4. Honest assessment: how good is it for 6 hours

**Strengths**
- Covers every requirement plus all three bonuses.
- The gate is explainable, with a rule table and live sliders.
- The anti-hallucination story is strong: citation validation plus the invented-figure check.
- Leakage is handled visibly.
- The extractive fallback means no single point of failure.

**Weaknesses**
- Not yet run on the real data.
- Logistic regression has a lower ceiling than a fine-tuned transformer.
- Regex risk detection is brittle.
- The figure check can over-trigger.
- Streamlit looks generic.

**Biggest non-technical risk:** many hackathons require code to be written during the event. Check the rules. If pre-written code isn't allowed, use this as a blueprint and rebuild it during the event. Either way, every teammate must be able to explain every file.

**Best use of spare time:** get real metrics into the README early, run the adversarial sheet, rehearse the demo twice. Don't add features.

---

## 5. Second split: fully parallel work

The first split had a bottleneck: everyone waited on P1's build. The code was changed so all four people can start at minute 0.

### Code changes

- **`build_index.py` split in two:**
  - `build_kb_index.py` (P2) writes `kb.parquet`, `kb_emb.npy` and `test.parquet` (without answers).
  - `train_classifier.py` (P1) writes `classifier.joblib` and `meta.json`. It runs TF-IDF-only with `SD_NO_EMB=1`, or reuses P2's `kb_emb.npy` when the row counts match.
- **`mock_desk.py`:** a fake desk returning the same result shape instantly. Run the UI with `SD_MOCK=1 streamlit run app.py` and no models.
- **`tests/test_gate.py`:** 9 pure-function tests for the gate and PII masking that need no models.
- **`CONTRACT.md`:** file ownership, artifact ownership, function signatures and the exact shape of the `triage()` result.

### File ownership

| Owner | Files |
| --- | --- |
| P1 Triage | `train_classifier.py`, `model.py`, `evaluate.py` |
| P2 Retrieval + drafting | `build_kb_index.py`, `embed.py`, `pipeline.py` (generate, `_extractive`, `SYSTEM_PROMPT`) |
| P3 Safety | `gate.py`, `pii.py`, `tests/` |
| P4 UI + integration | `app.py`, `mock_desk.py`, `README.md`, repo, demo |
| Shared, frozen after 0:15 | `config.py`, `data.py`, `CONTRACT.md` |

Merge points: 2:00 (artifacts shared, mock switched off), 4:00 (everything frozen), 5:00 (code freeze).

---

## 6. Cloning a friend's repo as a collaborator

1. Accept the invite (email, or github.com/notifications).
2. Clone with one of these:
   - GitHub CLI: `gh auth login`, then `gh repo clone OWNER/REPO`.
   - HTTPS: `git clone https://github.com/OWNER/REPO.git`. If it asks for a password, use a personal access token with `repo` scope, not your GitHub password.
   - SSH: `git clone git@github.com:OWNER/REPO.git`.
3. Work on your own branch:
   ```bash
   git checkout -b p3-safety
   git add . && git commit -m "..."
   git push -u origin p3-safety
   ```
4. If the repo is empty, one person unzips the scaffold, adds a `.gitignore` (`artifacts/`, `reports/`, `__pycache__/`, `.env`, `*.npy`, `*.parquet`, `*.joblib`), and pushes to `main`. Large artifacts are shared through Drive, not git.

---

## 7. Which part is the main AI/ML work

- **P1 (triage classifier):** the core ML. Produces every number on the metrics slide, and draws the model-choice questions in Q&A.
- **P2 (retrieval + grounded generation):** the core LLM/RAG work. It's the headline of the brief and what judges see in the demo.
- **P3:** ML-adjacent; mostly rules and thresholds.
- **P4:** no ML.

Recommendation: the strongest ML person takes P1, because a weak metrics table is harder to recover from than a slightly weaker prompt.

---

## 8. Dataset analysis (uploaded files)

Uploaded:
- `aa_dataset-tickets-multi-lang-5-2-50-version.csv`
- `dataset-tickets-multi-lang-4-20k.csv`
- `kb_train.parquet`
- `test_holdout.parquet`

### Key facts

| Fact | Value | Consequence |
| --- | --- | --- |
| Rows (5-2-50 file) | 28,587, not the ~61,800 the brief says | Small full build: about 23k KB tickets to embed |
| Languages | en 16,338, de 12,249 | Replies are only ever en or de |
| Null subjects | 3,838 (13.4%) | `ticket_text()` must handle a missing subject |
| Null answers | 7 | Drop KB rows with an empty answer (KB becomes 22,863 rows) |
| Duplicate bodies | 0 | No dedup step needed |
| Body length | median 386 chars, max 1,469 | Fits e5's 256-token window |
| Type | Incident 11,466, Request 8,187, Problem 6,012, Change 2,922 | Mildly imbalanced |
| Queue | 10 classes, from Technical Support (8,362) down to General Inquiry (405) | Heavily imbalanced; needs class weights |
| Priority | medium 11,515, high 11,178, low 5,894 | High is 39% of tickets |
| High-priority Incidents | 4,931 overall, 995 in the holdout | Support for the recall metric |
| Bodies contain the literal two characters `\n` | Not real newlines | Clean them into real newlines |
| Placeholders in answers | 48% of answers; `<tel_num>` 10,395, `<name>` 6,105, `<acc_num>` 2,508, `<br>` 462 | Strip `<br>`; scrub tokens from replies |
| Figures in answers | Only 0.3% contain a number with %, currency or a time unit | Any figure the LLM writes is almost certainly invented |
| The 20k CSV | Shares 8,399 bodies with the 5-2-50 file | Never mix it in; it would leak holdout tickets into the KB |

### The uploaded parquets

- `kb_train.parquet` has 22,869 rows (TKT-00000 to TKT-22868) and `test_holdout.parquet` has 5,718 rows (TKT-22869 to TKT-28586).
- Both exactly match the official seed-42 80/20 split of the 5-2-50 CSV.
- **`test_holdout.parquet` still contains the `answer` column.** It must never be loaded whole by pipeline code. Read it only as `columns=["ticket_id", "body"]`.

### Baseline measured on the official split

TF-IDF (1-2 grams) + logistic regression, trained on the KB, scored on the holdout:

| Head | Macro-F1, no weights | Macro-F1, balanced | Note |
| --- | --- | --- | --- |
| type | 0.870 | 0.880 | Easy head |
| queue | 0.494 | 0.582 | Balanced weights add 9 points |
| priority | 0.620 | 0.632 | High recall only 0.676 at argmax |

With the cleaned loader and a tuned P(high) threshold of 0.30 (TF-IDF only), the holdout scores were:
- type 0.874, queue 0.572, priority 0.599 macro-F1
- high-priority Incident recall: 0.856 on priority alone, 0.766 on priority and type together
- ECE: type 0.050, queue 0.144, priority 0.038

The threshold trades about 3 points of priority macro-F1 for about 13 points of high recall.

---

## 9. The complete execution plan (summary of the doc)

The full plan, with every command and every code block, is in the doc linked at the top. Every script in it was tested in the sandbox against the real data. Summary below.

### Shared setup (0:00 to 0:15, everyone)

- **S.1** Create a Python 3.11 venv, run `pip install -r requirements.txt`, and check the imports.
- **S.2** Put the CSV and both parquets in `data/`. Never copy the 20k CSV in.
- **S.3** Replace `data.py` with the cleaned version. It:
  - reads the local CSV first,
  - converts the literal `\n` to newlines and strips `<br>`,
  - assigns ids before cleaning,
  - drops KB rows with empty answers.
- **S.4** Add `verify_split.py`, which proves our split matches the uploaded parquets (asserts 22,869 / 5,718) while reading only `ticket_id` and `body`.
- **S.5** Create the branches `p1-triage`, `p2-rag`, `p3-safety`, `p4-ui`; the Gemini key goes in `.env`, never committed.
- **S.6** P4 commits the setup to `main`. After that, `config.py`, `data.py` and `CONTRACT.md` are frozen.

### P1: triage engine

Golden rule: pick every setting by the KB validation score. Run the holdout eval once, on the final model.

- **P1.1 (0:15 to 0:25)** Patch `train_classifier.py` with the `SD_CHAR=1` switch (adds char 3-5-gram TF-IDF for German compounds) and the `SD_C` switch (regularization strength).
- **P1.2 (0:25 to 0:45)** `SD_NO_EMB=1 python train_classifier.py`. Expected validation macro-F1: type 0.874, queue 0.586, priority 0.626; threshold 0.30 with validation high recall 0.813. Upload the artifacts to Drive.
- **P1.3 (0:45 to 1:00)** Add `eval_triage.py`, a classifier-only holdout eval that drops answers on load and writes `reports/triage_metrics.json`.
- **P1.4 (1:00 to 2:00)** Retrain with P2's `kb_emb.npy`, or self-embed if P2 is late.
- **P1.5 (2:00 to 3:30)** Experiment grid. Pick the winner by validation queue + priority macro-F1, with validation high recall at least 0.80:

  | Run | Settings |
  | --- | --- |
  | E1 | Default with e5 |
  | E2 | C=1 |
  | E3 | C=8 |
  | E4 | Char n-grams |
  | E5 | Char n-grams + embedding weight 2 |

- **P1.6 (3:30 to 4:15)** Run `eval_triage.py` and `evaluate.py --latency-n 20`, then fill the README metrics table.
- **P1.7 (4:15 to 5:00)** Write `QA.md` covering: why logistic regression, why queue is about 0.57, the threshold trade-off, the leakage proof, and what ECE means.

### P2: retrieval and grounded drafting

- **P2.1 (0:15 to 0:30)** `check_llm.py` lists the flash models and checks a JSON reply. If the model isn't found, pick a current flash model name.
- **P2.2 (0:15 to 1:00)** Dev index with `SD_KB_LIMIT=3000`, then the full index. Done when `kb_emb.npy` has shape `(22863, 384)`. Upload it and tell P1.
- **P2.3 (1:00 to 1:30)** `retrieval_check.py` on 500 holdout tickets gives top-1 similarity percentiles, same-queue and same-type rates, and the cross-lingual share. Send P3 the p10 value as the suggested `min_sim`.
- **P2.4 (1:30 to 2:00)** Patch `pipeline.py`:
  - add a `scrub()` function that strips `<name>`, `<tel_num>`, `<acc_num>` and `<br>`,
  - add a new prompt rule against copying those tokens,
  - apply `scrub()` to LLM replies and the extractive fallback.
  
  Testing showed the extractive fallback leaked tokens in 67% of drafts; after the patch, 0%.
- **P2.5 (2:00 to 2:30)** `draft_eval.py` runs 10 English and 10 German holdout tickets end to end. It scores citations, fake citations, invented figures, correct language, placeholder leaks, word count and latency.
- **P2.6 (2:30 to 3:30)** Prompt iterations. Targets: 100% cited, 0 fake citations, 0 invented figures, 100% right language, 0 leaks, 80 to 170 words. Change one rule at a time and log each change in `reports/prompt_log.md`.
- **P2.7 (3:30 to 3:45)** Find a German demo ticket whose top 5 includes an English precedent that the reply cites. Send it to P4.
- **P2.8 (3:45 to 4:00)** Freeze, push, and send the summary line for the README.

### P3: safety gate and guardrails

- **P3.1 (0:15 to 0:35)** `tests/test_adversarial.py` with 25 cases:
  - 6 injection (English and German),
  - 3 credential requests,
  - 3 destructive actions,
  - 4 legal threats,
  - 2 financial,
  - 7 false-positive look-alikes.
  
  The original regexes pass 19 of 25.
- **P3.2 (0:35 to 0:55)** New `RISK_PATTERNS` covering "forget everything above", "new instructions:", "developer mode", German "Vergiss deine Regeln", "share the root credentials", "schicken Sie mir die Zugangsdaten", "delete all … records" and "löschen Sie alle". Result: 25/25 with no false alarms, and the existing 9 tests still pass.
- **P3.3 (0:55 to 1:10)** PII masking uses the dataset's own tokens (`<email>`, `<tel_num>`, `<acc_num>`, `<ip_address>`), so masked live tickets look like training data.
- **P3.5 (1:15 to 2:00)** `attack_table.py` runs all 25 cases plus a burst scenario through the real pipeline. Lower `burst_sim` in 0.02 steps until 3 VPN tickets trigger the banner and an invoice ticket doesn't.
- **P3.4 (2:00 to 2:45)** `gate_sweep.py` tunes thresholds on P1's 10% KB validation slice, excluding each ticket's own match from retrieval. The rule is fixed in advance:
  1. at least 95% of high-priority Incidents escalated,
  2. at least 25% of tickets auto-drafted,
  3. then the highest queue accuracy among auto-drafted tickets.
  
  The dry run picked type 0.55, queue 0.30, priority 0.50: 25% auto-drafted, 96% of high Incidents escalated, and 74% queue accuracy on auto-drafted tickets against 57% overall.
- **P3.6 (2:45 to 4:00)** Final attack table with the frozen prompt. Target 26/26 pass.
- **P3.7 (4:00 to 5:00)** Q&A prep:
  - Regex is the first of three layers (regex, prompt fencing, post-gate).
  - The threshold selection rule was written before the sweep ran.
  - Refunds have precedents, so they're allowed, but any figure not found in a precedent forces review.

### P4: UI, integration and demo

P4 is the only person who edits `config.py` after setup. Others send their values in the chat.

- **P4.1 (0:15 to 0:45)** `SD_MOCK=1 streamlit run app.py` and click through everything.
- **P4.2 (0:45 to 1:15)** Seven numbered demo samples:
  1. EN hospital VPN outage
  2. DE billing (cross-lingual)
  3. EN refund + invented SLA + PII
  4. EN prompt injection
  5. DE password, no subject
  6. EN pre-sales, no precedent
  7. DE injection
- **P4.3 (1:15 to 2:00)** Harden the console:
  - import `scrub`,
  - cap input at 300/5,000 characters,
  - wrap `triage()` in try/except with a clean error,
  - scrub answers in the precedents tab.
- **P4.4 (2:00 to 2:30)** Integration 1: merge in the order p3 → p2 → p1 → p4, run the tests, download the artifacts, then run an 8-row smoke table of expected statuses.
- **P4.5 (2:30 to 3:30)** README, every number traced to a file in `reports/`: pitch, architecture, metrics, draft quality, attack table, leakage section, screenshot.
- **P4.6 (4:00 to 4:45)** Integration 2, a fresh-clone test in `/tmp`, then `git tag v1.0`.
- **P4.7 (4:45 to 5:00)** Record a 2-minute backup video.
- **P4.8 (5:00 to 6:00)** Demo script, rehearsed twice:

  | Time | Who | Content |
  | --- | --- | --- |
  | 0:00 to 0:30 | P4 | The two failure modes from the brief |
  | 0:30 to 1:20 | P1 | Sample 1 escalated to on-call |
  | 1:20 to 2:10 | P2 | Sample 2, a German reply citing an English precedent |
  | 2:10 to 3:00 | P3 | Sample 3: PII, legal flag, figure guard |
  | 3:00 to 3:30 | P3 | Sample 4: injection blocked |
  | 3:30 to 4:00 | P4 | Burst banner |
  | 4:00 to 5:00 | P1 | Metrics, attack table, leakage proof |

### Hand-offs

| What | From | To | When |
| --- | --- | --- | --- |
| Baseline `classifier.joblib`, `meta.json` | P1 | P2, P3, P4 | 0:45 |
| `kb.parquet`, `kb_emb.npy`, `test.parquet` | P2 | P1, P3, P4 | 1:00 |
| Similarity percentiles, suggested `min_sim` | P2 | P3 | 1:30 |
| Chosen thresholds for `config.py` | P3 | P4 | 2:45 |
| Final classifier artifacts | P1 | Everyone | 3:30 |
| German cross-lingual demo ticket | P2 | P4 | 3:45 |
| `triage_metrics.json`, `draft_eval.json`, `attack_table.md` | P1, P2, P3 | P4 | 4:15 |

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| No parquet engine | `pip install pyarrow` |
| `verify_split.py` row assertion fails | Use the 5-2-50 CSV (28,587 rows) |
| `kb_emb.npy row count mismatch` | Same `SD_KB_LIMIT` for both scripts; P2 rebuilds the full index |
| Gemini 404 | Pick a current flash model (P2.1) |
| Gemini 429 | Extractive fallback kicks in automatically; reduce `SD_DRAFT_N` |
| Key not picked up | `export $(cat .env \| xargs)` and restart Streamlit |
| Old code after a merge | Restart Streamlit (`st.cache_resource`) |
| Everything escalates | Rerun `gate_sweep.py` on the real artifacts |
| Burst never fires | Lower `burst_sim` (P3.5) |
| faiss won't install | Skip it; the numpy fallback is automatic |
| Slow embedding | Use a Colab GPU and download `artifacts/` |
| `config.py` merge conflict | Keep `main`; send your value to P4 |

---

## 10. Open item

The plan assumes Gemini for drafting. If the team uses another LLM API, P2.1 and `generate()` in `pipeline.py` need swapping.

## 11. Note on code versions

`sentineldesk.zip` contains the scaffold as of the parallel-work update (section 5). Several later fixes exist only as tested code blocks in the plan doc and need applying from there:
- the cleaned `data.py`, `verify_split.py`
- the trainer switches, `eval_triage.py`
- `check_llm.py`, `retrieval_check.py`, `draft_eval.py`, the `scrub()` patch
- the new risk regexes, the PII token change, `test_adversarial.py`, `gate_sweep.py`, `attack_table.py`
- the app samples and hardening
