# SentinelDesk: technical reference

Moved from the README so the README can stay short. Start with [README.md](../README.md) to run and use the app.


**Autonomous incident triage and grounded resolution copilot.** For each support ticket (subject + body, English or German),
SentinelDesk does four things:

1. **Triage:** predicts `type`, `queue`, `priority` and `language`, each with a confidence.
2. **Escalation gate:** decides with deterministic, explainable rules whether the ticket gets an AI draft or goes to a human.
3. **Precedent retrieval:** finds the most similar resolved tickets, across both languages.
4. **Grounded reply:** drafts a reply in the customer's language that cites those tickets and invents nothing.

Data: `Tobi-Bueck/customer-support-tickets`, file `aa_dataset-tickets-multi-lang-5-2-50-version.csv`
(28,587 tickets, EN 57% / DE 43%), with the official seed-42 80/20 split.

## Layout

```
src/sentineldesk/        the package (import with PYTHONPATH=src)
  schema.py              interface contract: Prediction, Precedent, TriageResult
  pipeline.py            triage(subject, body) -> TriageResult; STAGES flags switch stubs to real stages
  config.py              paths, model names, thresholds (shared; announce changes)
  data.py, text.py       data access (leakage-safe) and build_text()
  embed.py               e5 encoder with query:/passage: prefixes          [Track B]
  classify.py            triage heads                                       [Track A, done]
  rootcause.py           ITIL root-cause grouping + known Problem/Change    [Track A, done]
  retrieve.py            KB index + search                                  [Track B, todo]
  generate.py            grounded draft + citation verification             [Track C, todo]
  gate.py, pii.py        escalation rules + risk regexes, PII masking with dataset tokens  [P3, done]
  burst.py               major-incident (burst) detector                                  [P3, done]
scripts/
  prepare_data.py        writes data/processed/{kb_train,test_inputs,test_labels}.parquet
  train_classifier.py    trains the triage heads, tunes the P(high) threshold
  evaluate.py            holdout metrics (the only reader of test labels)
  gate_sweep.py          tunes gate thresholds on the KB validation slice                [P3]
  attack_table.py        25 attacks + burst scenario through the real pipeline           [P3]
tests/test_contract.py   edge cases that must never crash
tests/test_rootcause.py  root-cause grouping and KB linking
tests/test_gate.py       pure gate / PII / burst tests                                   [P3]
tests/test_adversarial.py  25 adversarial tickets (EN + DE)                              [P3]
notebooks/01_eda.ipynb   EDA (KB split only)
docs/p1_workdone.md      Track A results + takeover guide for retrieval/generation
docs/p3_workdone.md      safety gate results, thresholds, attack table, Q&A prep
```

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# put aa_dataset-tickets-multi-lang-5-2-50-version.csv in data/raw/
python scripts/prepare_data.py
PYTHONPATH=src python scripts/train_classifier.py   # ~1 min, plus 3-5 min the first time to encode the KB
PYTHONPATH=src python scripts/evaluate.py           # holdout metrics -> reports/triage_metrics.json
PYTHONPATH=src python -m pytest -q tests/           # contract + gate + adversarial
PYTHONPATH=src python scripts/attack_table.py      # -> reports/attack_table.md
```

### Console (Streamlit)

```bash
PYTHONPATH=src python scripts/build_kb_index.py     # once: the retrieval index the console needs
streamlit run app.py                                # http://localhost:8501
```

- **Customer portal** (`/customer`): users file **Incidents** or **Requests** only. Problems and Changes are raised
  by the organisation from incidents.
  - Every submission runs through the real pipeline (`sentinel_ui/backend.py`) and is stored in
    `data/live_tickets.json` as `INC…` / `REQ…`.
  - The form's choice is the ticket type of record; the model's type is shown as the AI's opinion.
  - Priority: incidents take the more urgent of the model and the form's impact × urgency matrix, and a ticket the
    gate sends to on-call is always P1.
  - Assignment: on-call engineer for `ESCALATE_ONCALL`, otherwise the predicted queue's group.
- **Organisation** (`/agent`): ticket list, ticket form with SLA timer, the gate's three-tier status, and the AI draft.
- **Dashboard** (`/dashboard`): volume charts and the holdout metrics from `reports/triage_metrics.json`.
- Tick "Use mock backend" in the Organisation sidebar to run without models.

#### Sign in

1. Open http://localhost:8501 and click **Customer portal** in the left sidebar.
2. Optional: pick **English** or **Deutsch** at the top right. The whole portal switches language.
3. Sign in with a demo account. These are demo accounts in `sentinel_ui/common.py` (`DEMO_USERS`), not real
   Northeastern authentication:

   | Email | Password |
   |---|---|
   | `demo@northeastern.edu` | `demo` |
   | `nima@northeastern.edu` | `husky2026` |
   | `prof@northeastern.edu` | `demo` |

4. You land on "Hi <name>, how can we help today?". The pill under it shows service status; it turns red when
   several urgent incidents arrive within an hour.

#### Report an incident (something is broken)

1. Open the **Report an incident** tab. A **Popular services** tile pre-selects the service.
2. Fill in:
   - **What isn't working?**: the service, e.g. *VPN or campus network*.
   - **Who is affected?**: *Just me*, *My class or team*, or *A whole department or building* (impact).
   - **How urgent is it for you?**: *Low*, *Medium* or *High* (urgency).
   - **Short summary**: optional.
   - **Describe it in your own words**: required, in English or German.
3. Click **Submit incident**. The ticket goes through the full pipeline (a few seconds for the first ticket while
   the models load) and you get a number like `INC0000001`:
   - **Red badge, "went straight to the on-call team"**: the gate escalated it (`ESCALATE_ONCALL`). The ticket is
     P1 and assigned to the on-call engineer.
   - **Green badge, "Your ticket is with the <team> team"**: it was routed to the predicted queue. If the gate
     found good precedents, similar solved issues are listed underneath.

#### Request something (a service or information)

1. Open the **Request something** tab.
2. Pick **What do you need?** (account, software, billing, product information, something else), add a summary,
   and describe the request.
3. Click **Submit request**. You get a number like `REQ0000001` and the team it was routed to.

#### Track and work tickets

- **My tickets** (portal tab): your tickets with number, opened time, team and status.
- **Organisation** (sidebar): the service-desk view.
  1. Portal tickets are listed first, then the history.
  2. Click a row to open it. You get the customer's message, the ticket form (state, priority P1–P3, assignment
     group) with **Save changes**, and the SLA timer: P1 4 h, P2 8 h, P3 24 h.
  3. The **AI assistant** panel shows the gate's status and reasons, the AI's type and priority next to the
     customer's own, and the drafted reply with the past tickets it cites.
  4. **Send this reply and resolve** closes the ticket with that reply.
- **Dashboard** (sidebar): volume by team, priority and type, plus the holdout model metrics; portal tickets are
  included when the toggle is on.
- **Start clean:** portal tickets live in `data/live_tickets.json` (gitignored). Delete that file to reset the demo.

## Pipeline status

| Stage | Status |
|---|---|
| PII masking, escalation gate, burst | live: thresholds tuned on the KB validation slice, 26/26 attack table ([docs/p3_workdone.md](p3_workdone.md)) |
| Embed | live: `multilingual-e5-small`, about 11 ms per ticket after warm-up |
| Classify | live: frozen model, metrics below |
| Retrieve | live: exact cosine over the e5 passage index, cross-lingual slot, live precedent store |
| Generate | live: Gemini with citation/figure verification; extractive fallback without a key |
| Root cause | live: groups similar live issues (suggests a Problem at 3+), links known KB Problems/Changes |

## Triage model

- **Features:** word TF-IDF (1–2 grams) next to the ticket's e5 query embedding.
- **Heads:** one `LogisticRegression(C=32, class_weight="balanced")` per head.
- **Priority rule:** priority is labelled `high` whenever P(high) ≥ 0.25. The threshold was tuned on a KB validation slice to catch
  at least 80% of high-priority tickets, which feed the escalation gate.
- **Model selection:** every setting was chosen on that validation slice (10 runs; table in
  [docs/p1_workdone.md](p1_workdone.md#4-results)).

### Holdout metrics (5,718 tickets, never used for selection)

| Metric | TF-IDF baseline | **Final model** |
|---|---|---|
| Type macro-F1 | 0.8747 | **0.8777** |
| Queue macro-F1 | 0.5718 | **0.6109** |
| Priority macro-F1 | 0.5974 | **0.6195** |
| Language macro-F1 | n/a | **0.9666** |
| ECE type / queue / priority / language | 0.050 / 0.144 / 0.039 / n/a | 0.028 / 0.012 / 0.082 / 0.003 |
| High-priority Incident recall: predicted high (n=995) | 0.8563 | 0.8523 |
| High-priority Incident recall: predicted high **and** Incident | 0.7658 | **0.7729** |
| High-priority Incident recall: gate hard rule (high + Incident **or Problem**) | n/a | **0.8503** (escalates 34% of tickets) |
| High-priority Incident recall: full gate | pending (needs retrieval + generation) | |
| Latency p50 / p95 | pending | |

Priority ECE rises because the recall-oriented threshold labels tickets with P(high) as low as 0.25 as `high`.
The trade is deliberate: a missed outage costs more than a false alarm.

## Safety gate

Deterministic rules, no LLM in the decision path. Every escalation reason is a sentence shown on the badge.

| Rule | Action |
|---|---|
| Prompt injection, credential request, destructive bulk action, legal threat (EN + DE regexes) | Always escalate; injections never reach the LLM |
| High priority + Incident **or Problem** (`CRITICAL_TYPES`, Track A) | Escalate to on-call |
| 3+ similar tickets within 30 min (multilingual, `BURST_SIM=0.86`) | Major-incident banner + escalate |
| Outage words + urgency words (e.g. "keeps dropping" + "immediately") | Escalate to on-call |
| Any head below its confidence floor (type 0.75, queue 0.50, priority 0.70) | Human review |
| Best precedent < 0.865 or mean top-3 < 0.845 (calibrated on hand-typed tickets) | Human review (no precedent) |
| Refund / compensation request with no precedent that mentions it | Human review |
| Empty, emoji-only or bare-URL ticket | Human review |

Thresholds were chosen by `scripts/gate_sweep.py` on the 2,286-ticket KB validation slice, using a rule fixed in
advance (≥95% of high-priority Incidents escalated, ≥25% auto-drafted, then the best queue accuracy on auto-drafted
tickets).

- **25.2%** of tickets are auto-drafted.
- **97.0%** of high-priority Incidents are escalated.
- Queue accuracy on auto-drafted tickets is **0.815**, against 0.609 on all tickets.

PII is masked with the dataset's own tokens (`<email>`, `<tel_num>`, `<acc_num>`) before any external call.
Attack table: `reports/attack_table.md` (26/26).

The sweep numbers above were measured with the Incident-only hard rule; including Problem escalates more (see Root-cause grouping below).

## Root-cause grouping (ITIL)

Support work follows the ITIL model: a **Request** asks for something ("I need a laptop"), an **Incident** reports something
broken, and many Incidents share one **Problem** (the root cause), which is fixed by **Changes**.
`src/sentineldesk/rootcause.py` uses this model in three ways:

- **Critical rule covers Problems too.** Incident and Problem differ by relationship, not wording (712 of 760 type errors
  are Incident ↔ Problem), so the gate's hard rule fires on *high + (Incident or Problem)*. On validation this raises
  high-priority Incident recall from 0.803 to 0.882, while the share of tickets this rule escalates goes from 26% to 37%.
  To revert, set `config.CRITICAL_TYPES = ("Incident",)`.
- **Live grouping.** Each new issue is compared with live issues from the last 30 minutes. Three or more at cosine
  similarity ≥ 0.89 (just above the 90th percentile of unrelated pairs) escalate with *"Probable shared root cause — raise a
  Problem record"*. Grouping works across languages: three English Outlook tickets and a German one group together, and
  an invoice ticket stays out.
- **Known history, integrated with RAG.** The closest past Problem and Change are found in the same retrieval index the
  drafter uses (query → passage), shown when similarity is ≥ 0.89 (just above the 99th percentile of unrelated pairs).
  If retrieval didn't already return that Problem, it's added to the drafter's precedents, so the reply can cite the root
  cause. On 300 holdout tickets, 92% of issues linked to a known Problem. Hand-typed tickets score lower (about
  0.86–0.89), so they link less often.

The dataset has no explicit Incident → Problem links, so these thresholds come from similarity distributions, not
labelled groups. Tests: `PYTHONPATH=src python tests/test_rootcause.py`.

## Leakage guarantees

- **Holdout split by file.** `prepare_data.py` writes the holdout as two files: `test_inputs.parquet` (ticket_id, subject, body)
  and `test_labels.parquet`. Only `scripts/evaluate.py` reads the labels.
- **Training data.** The classifier, its threshold and all hyperparameters come from the 80% KB split; tuning uses a 10% slice of it.
- **Retrieval and prompts.** Only KB answers may be retrieved or shown.
- **No mixing of files.** The 20k CSV is never mixed in, because it shares 8,399 bodies with the main file.
