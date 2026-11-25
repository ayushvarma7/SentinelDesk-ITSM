# SentinelDesk

**Ticket triage for an IT service desk that decides only what it can justify and hands everything risky to a person.**

In a busy queue, a real outage can sit behind a hundred password resets, and AI auto-replies that invent refunds, SLAs
or fixes create more incidents than they close. SentinelDesk classifies and routes every ticket, escalates outages
with a one-line reason, and drafts replies only when past resolved tickets back them up.

[![Watch the 2-minute SentinelDesk walkthrough on YouTube](docs/demo-thumbnail.jpg)](https://youtu.be/RBENYYlmL4Q)

<p align="center"><b>▶ <a href="https://youtu.be/RBENYYlmL4Q">Watch the 2-minute walkthrough on YouTube</a></b></p>

![Overview](docs/screenshots/overview.jpg)

## What it does, in ITSM terms

| Feature | ITSM equivalent |
|---|---|
| Predicts the type: Incident, Request, Problem or Change | Record type |
| Predicts the queue (one of 10 teams) | Assignment group routing |
| Predicts the priority, tuned to catch high-priority tickets | Priority and SLA risk |
| Escalation gate made of deterministic rules, with no LLM involved | Human in the loop |
| Burst detector: 3 or more similar tickets within 30 minutes | Major incident detection |
| Replies must cite real past ticket IDs; figures not found in those tickets are flagged for the agent | Grounded, auditable automation |
| Personal data masked before any text leaves the machine | Data protection guardrail |
| Recurring issues grouped into problem records, resolved once for every matching ticket | Problem management |
| Auto-assignment rules that admins edit: keywords and model predictions mapped to the organisation's own groups | Assignment mappings, routing policy |

Everything runs in English and German.

## The two apps

**Customer site** (`customer-portal/`, http://localhost:5174): an overview page, a live triage console, and a
customer portal where students and staff sign in, report an incident or make a request, and follow their tickets.

![Customer portal](docs/screenshots/portal-home.jpg)

**Admin console** (`frontend/`, http://localhost:5173): the service-desk queue with priority, assignment group and SLA
countdown. Opening a ticket shows each step of the agent run (PII mask, triage, gate, retrieval, draft, verification),
why the ticket was escalated, and the recommended reply. Agents approve, edit, reject, take a ticket or override the AI draft. Other tabs hold a
dashboard, **Problems** (recurring issues grouped across tickets) and the **Rules** page where admins set the routing
policy.

![Admin queue](docs/screenshots/admin-queue.jpg)
![Agent run and gate decision](docs/screenshots/admin-ticket-gate.jpg)

Both apps are React and TypeScript. They share one FastAPI backend (`api/`, http://localhost:8000) that runs the
triage pipeline, so a ticket raised in the portal appears in the admin queue right away, and the customer sees the
approved reply in the portal.

## Quick start

You need Python 3.12, Node.js 20.19 or later (or 22.12+), about 2 GB of disk, and about 10 minutes the first time.

```bash
git clone https://github.com/ayushvarma7/SentinelDesk.git && cd SentinelDesk
./run.sh setup     # venv, dependencies, dataset, 80/20 split, classifier, retrieval index, npm install
./run.sh app       # API on :8000, admin console on :5173, customer site on :5174 (Ctrl+C stops all three)
```

Open http://localhost:5174, go to **Customer portal** and sign in with `varma.ay@northeastern.edu` / `ayush`. This is a
demo account defined in the front end, not a real login. Its ticket history is already filled in.

![Sign in](docs/screenshots/portal-sign-in.jpg)

To have an LLM write drafts, copy `.env.example` to `.env` and add a Gemini key. Without a key, drafts quote the
closest past resolution instead, and everything else works the same.

| Command | What it does |
|---|---|
| `./run.sh setup` | Creates `.venv`, installs Python and npm dependencies, downloads the dataset, makes the seed-42 split, trains the classifier and builds the retrieval index. Skips steps that are already done; `FORCE=1` redoes them. |
| `./run.sh app` | Starts the API and both web apps. The API seeds 45 example tickets, including a VPN major incident. |
| `./run.sh test` | Contract, gate, adversarial, major-incident, root-cause, status, store and routing-rule tests. |
| `./run.sh eval` | Recomputes the holdout metrics, attack table, retrieval check and draft quality in `reports/`. |

## How a ticket is handled

```mermaid
flowchart LR
    A[Ticket<br/>subject + body] --> B[PII mask]
    B --> C[Embed<br/>multilingual-e5-small]
    C --> D[Classify<br/>type · queue · priority · language]
    C --> E[Retrieve<br/>top 5 of 22,863 resolved tickets]
    C --> F[Burst and<br/>root-cause check]
    D --> G{Safety gate<br/>deterministic rules}
    E --> G
    F --> G
    G -->|ESCALATE_ONCALL| H[On-call engineer<br/>no draft]
    G -->|HUMAN_REVIEW| I[Agent decides<br/>draft only if safe]
    G -->|AUTO_DRAFT_READY| J[Grounded draft<br/>cited IDs checked in code]
    J --> K[Agent approves or edits]
    I --> K
```

| Stage | How it works |
|---|---|
| PII mask | Emails, phone numbers, IPs, IBANs, card numbers and account numbers become tokens such as `<email>` before any text reaches an LLM. |
| Classify | Word TF-IDF features next to the e5 embedding, with one logistic regression per head. Each head returns a calibrated probability, so the gate can apply thresholds to it. Takes about 20 ms per ticket. |
| Retrieve | Exact cosine search over the e5 vectors of the 22,863 resolved tickets in the knowledge base. One of the five slots is kept for the best match in the other language. |
| Burst and root cause | Three or more similar tickets within 30 minutes raise a major incident. Similar live issues are grouped and matched against stored problem records. |
| Draft | Gemini receives the masked text and the retrieved tickets, with the ticket marked as untrusted data. Code then checks that every cited ID was actually retrieved. A draft with an invented citation, or with no valid citation, is dropped and the ticket goes to a person. Any figure (percentage, amount, time) that does not appear in the retrieved tickets is shown to the agent as a warning. |
| Learning loop | When an agent edits a reply, it becomes a new precedent right away. Unedited AI drafts are never indexed, so the system does not learn from its own output. |

![Live triage: a refund demand with card, email and phone masked, escalated with its reasons](docs/screenshots/live-triage-escalation-pii.jpg)

## How the gate decides

The gate is a short list of rules in `src/sentineldesk/gate.py`. Each rule that fires adds a one-sentence reason,
which appears on the ticket. The most severe outcome wins.

| Outcome | When it fires |
|---|---|
| **Escalate to on-call, no draft** | High priority and type Incident or Problem; the ticket reports an outage using urgency words; the probability of a critical incident is high enough; a burst of similar tickets; a shared root cause with other live tickets. |
| **Human review, no draft** | Prompt injection, requests for passwords or credentials, destructive bulk actions, legal threats, refunds or compensation with no precedent, empty or emoji-only text. |
| **Human review, with a draft** | Queue confidence below 0.50, best past match below 0.865 similarity, or the top three matches averaging below 0.845. |
| **Auto-draft ready** | None of the above. An agent still approves the reply before it is sent. |

![Live triage: a prompt injection held for a person](docs/screenshots/live-triage-prompt-injection.jpg)

### Choosing the thresholds

The thresholds were tuned on a validation slice of the knowledge base, never on the holdout. The selection rule was
fixed before the sweep ran: escalate at least 95% of high-priority Incidents, keep routing accuracy on auto-drafted
tickets at 0.75 or better, and within those limits automate as much as possible. 238 of 1,944 settings passed
(`scripts/escalation_sweep.py`, `reports/escalation_sweep.json`).

The admin console's Rules page plots every setting tested. Each dot is one gate setting. Moving right automates more;
moving down lets more high-priority Incidents reach the queue without a person deciding first. The live setting sits
just above the 95% bar. The previous setting was more cautious: it automated less and escalated a little more.

![Gate tradeoff: every setting tested, with the live and previous settings](docs/screenshots/gate-tradeoff.jpg)

The gate thresholds are shown read-only in the console on purpose: they are safety settings, and changing them means
re-running the sweep and the evaluation. The routing rules below are the part an organisation changes freely.

## Problem management

When the same fault is reported again and again, answering each ticket separately never fixes anything. SentinelDesk
groups tickets that describe the same underlying issue into one **problem** record, matching by meaning rather than by
wording. A VPN failure reported in English, English and German becomes one problem with three tickets and three
affected people.

The **Problems** tab lists them with the ones that need a permanent fix first (open and reported more than once). Each
problem shows who is affected, links to every ticket filed under it, and has a field for the resolution. Once a problem
is resolved, any new ticket that matches it arrives with that resolution attached, so the agent starts from the known
fix. "Is it known?" checks a description against the database before anyone opens a new problem, and the activity log
shows how each ticket was matched.

![Problems](docs/screenshots/admin-problems.jpg)
![A problem with its tickets and resolution](docs/screenshots/admin-problem-detail.jpg)

Two tickets count as the same problem when their similarity to the stored problem is at least 0.90. On the demo
tickets, genuine repeats (printers, Outlook sync, the VPN trio) score 0.90 to 0.96 and unrelated German tickets score
0.88 to 0.91 against each other, so 0.90 removes nearly all false merges without losing the real ones
(`PROBLEM_MATCH_SIM` in `src/sentineldesk/config.py`).

## Configurable routing rules

The model predicts one of 10 generic queues. Every organisation routes differently, so admins map those predictions onto
their own assignment groups on the console's **Rules** page. Rules are ordered, the first enabled match wins, and each
one combines:

- **Conditions:** keywords in the ticket text (English or German), and the model's predicted queue, type, priority and
  language. An empty condition matches anything.
- **Actions:** assign to a group (an existing queue or a new one), raise the priority, and name an assignee.

The defaults show a university IT desk's policy: security reports go to IT Security at high priority; Wi-Fi to Network
Operations; passwords and MFA to Identity and Access; Canvas to Academic Technology; printers to Campus Print Services;
German billing tickets (model queue plus language, no keywords) to a DACH billing desk; new-hire requests to HR Systems
with a named assignee. A duty-manager rule ships switched off, as an example of one an organisation turns on when it
needs it.

![Rules page](docs/screenshots/admin-rules.jpg)

Each rule shows how many tickets in the queue it matches right now. "Test a ticket" runs the real triage on any text
and shows which rule fires and where the ticket lands, using unsaved edits. Saved rules apply to every new ticket, and
the ticket records which rule routed it and what the model had predicted.

**Rules change routing only.** They can raise a priority but never lower it, and they never change the gate's decision:
an escalated ticket stays escalated and keeps its on-call assignee. An organisation can route around the model, but it
cannot configure away the safety checks. `tests/test_assignment_rules.py` covers these rules.

## Results

Every figure below comes from a file in `reports/`. `./run.sh eval` regenerates the holdout figures;
`scripts/escalation_sweep.py` regenerates the gate tuning. The numbers come from three different sets of tickets, so
each table names its source.

**Gate tuning: validation slice** (2,286 tickets from the knowledge base; 406 of them high-priority Incidents)

| Metric | Live setting | Previous setting |
|---|---|---|
| High-priority Incidents escalated by the gate | **95.1%** | 97.5% |
| Tickets auto-drafted | **37.5%** | 23.1% |
| Routing accuracy on auto-drafted tickets (0.609 on all tickets) | **0.751** | 0.810 |

The live setting adds a critical-incident rule (P(high) × P(Incident or Problem) ≥ 0.20) and drops two confidence floors
that had been doing that job indirectly. It automates far more tickets and stays above the 95% safety bar. The last row
shows the gate doing its job either way: the tickets it auto-drafts are routed better than average, and the rest go
to a person.

**Holdout: classifier** (5,718 tickets from the official 20% split, never used to choose any setting)

| Metric | Value |
|---|---|
| Macro-F1: type / queue / priority / language | 0.878 / 0.611 / 0.620 / 0.967 |
| Calibration error (ECE): type / queue / priority | 0.028 / 0.012 / 0.082 |
| Recall of high-priority Incidents, predicted as high priority (995 tickets) | **0.852** |
| Queue macro-F1: English / German | 0.693 / 0.491 |

**Holdout: full pipeline, run on a 200-ticket sample**

| Metric | Value |
|---|---|
| High-priority Incidents escalated (41 tickets) | 90.2% |
| Tickets auto-drafted | 39.5% |
| Latency, median / 95th percentile | 185 ms / 1.13 s |

**Safety checks**

| Check | Result |
|---|---|
| Adversarial and look-alike tickets, English and German: prompt injection, credential requests, destructive requests, unsupported refunds, plus harmless tickets that must not trip a rule | **26/26** pass, and the burst scenario passes too (`reports/attack_table.md`) |
| Gemini drafts on sampled holdout tickets: cite a retrieved ticket / invented citations / invented figures / leaked placeholders | 3 of 3 / 0 / 0 / 0. Only 3 of the 10 sampled tickets were drafted, so this sample is small (`reports/draft_eval.json`). |

### The tradeoff, on purpose

Ticket priority counts as high when P(high) ≥ 0.25, not 0.5. That costs some precision: more tickets are escalated
than strictly need it. In return, more real outages get caught, because a missed outage costs far more than a false
alarm that an engineer closes in a minute. The tables show the same choice: the gate escalates almost every
high-priority Incident and auto-drafts only the tickets it can back with precedent.

The validation slice and the holdout sample disagree (95.1% vs 90.2% of high-priority Incidents escalated). The holdout
sample contains only 41 such tickets, and the validation slice was used to choose the thresholds, so the holdout
figure is the more conservative estimate.

## Data and leakage rules

- **Dataset:** [Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets)
  on Hugging Face (CC-BY-NC-4.0), file `aa_dataset-tickets-multi-lang-5-2-50-version.csv`. It has 28,587 tickets:
  57% English, 43% German.
- **Split:** seed-42, 80/20. The 80% becomes the knowledge base; the 20% is the 5,718-ticket holdout.
- **Holdout inputs and labels are stored in separate files.** Only the three evaluation scripts read the labels; training, tuning and the pipeline never do.
- **Training, retrieval and tuning use the knowledge base only.** Only knowledge-base answers are ever indexed or shown.
- **The dataset's 20k variant is never mixed in.** It shares 8,399 ticket bodies with the main file.

## Repository

```
api/                FastAPI backend: triage endpoint, ticket store, routing rules, problem database, seed tickets
customer-portal/    customer site (React): overview, live triage, customer portal
frontend/           admin console (React): queue, agent run, dashboard, problems, rules
src/sentineldesk/   pipeline: pii, embed, classify, retrieve, burst, rootcause, gate, generate, store
scripts/            prepare_data, train_classifier, build_kb_index, evaluate, attack_table, escalation_sweep,
                    retrieval_check, draft_eval
tests/              contract, gate, adversarial, major incident, root cause, status, store, routing rules
reports/            every number in Results, as JSON, CSV or Markdown
run.sh              setup, test, eval, app
```

For the full design write-up (data findings, retrieval and gate decisions, how to retrain), see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Credits

- Dataset: [Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets),
  licensed CC-BY-NC-4.0. Because of that licence, this project is for non-commercial use.
- Embeddings: [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small).
- Drafting: Google Gemini, used only when a key is configured.
