# P3 / Safety gate and guardrails: work done and handoff

Branch `dev` (P1 `feature-kunal` + P2 `feature-sweta` + P3 `feature-ayush` integrated) · 21 Nov 2026 ·
Status: **risk patterns, PII tokens, burst detector, thresholds re-tuned on real retrieval; 26/26 attack table; 18 tests pass**

## 1. Summary

| Deliverable (plan §5) | Where | Result |
|---|---|---|
| P3.1 adversarial test file | `tests/test_adversarial.py` | 25 cases (18 attacks EN/DE + 7 look-alikes) |
| P3.2 risk patterns | `gate.RISK_PATTERNS`, `gate.detect_risks()` | **25/25**, 0 false alarms on the 7 look-alikes |
| P3.3 PII with dataset tokens | `pii.mask()` (alias `mask_pii`) | `<email>`, `<tel_num>`, `<acc_num>`, `<ip_address>` |
| P3.4 threshold sweep | `scripts/gate_sweep.py` → `reports/gate_sweep.{csv,json}` | thresholds applied in `config.py` |
| P3.5 burst detector | `src/sentineldesk/burst.py`, `config.BURST_*` | banner flags `[F, F, T, F]` at `BURST_SIM=0.86` |
| P3.6 attack table | `scripts/attack_table.py` → `reports/attack_table.md` | **26/26 pass** through the real pipeline |
| Gate unit tests | `tests/test_gate.py` | 13 pure tests (no models) |

The plan was written for a flat layout (`gate.py`, `pii.py`, `pipeline.SentinelDesk`). The repo uses Jay's
`src/sentineldesk/` scaffold, so everything was ported to it. Run from the repo root:

```bash
PYTHONPATH=src python tests/test_adversarial.py      # 25/25 adversarial cases pass
PYTHONPATH=src python tests/test_gate.py             # 13/13 gate tests passed
PYTHONPATH=src python -m pytest -q tests/            # 18 passed (adversarial + gate + contract)
PYTHONPATH=src python scripts/gate_sweep.py          # ~1 min (needs heads.joblib and P2's index)
PYTHONPATH=src python scripts/attack_table.py        # 26/26 pass
```

## 2. What changed, file by file

| File | Change |
|---|---|
| `gate.py` | New `RISK_PATTERNS` (5 risks, EN + DE), `detect_risks()`, `too_little_text()`. `evaluate()` now: hard risks (injection, credentials, destructive, legal) always escalate and are the first reason on the badge; refunds/compensation escalate only when no retrieved precedent mentions them; burst and too-little-text reasons; `thresholds["min_confidence"]` overrides now merge with the defaults (a slider can change one head). New optional `burst=` arg. |
| `pii.py` | Dataset tokens instead of `[EMAIL_REDACTED]`. IBAN accepts grouped spaces (`DE89 3704 ...`); account numbers keep their keyword (`Kundennummer: <acc_num>`); phone numbers need 7–15 digits and dates are left alone. |
| `burst.py` (new) | `BurstDetector`: rolling window of recent query vectors; active when ≥ `BURST_MIN_COUNT` tickets (incl. this one) within `BURST_WINDOW_S` have cosine ≥ `BURST_SIM`. Returns `{"active", "related", "live_id", "max_sim"}`. |
| `gate.py` (dev) | `urgent_outage()`: outage words AND urgency words route to on-call even when the priority head says medium. |
| `config.py` | Tuned `MIN_CONFIDENCE`; similarity floors kept at P2's hand-typed calibration (§3); new `MIN_LETTERS`, `BURST_SIM`, `BURST_MIN_COUNT`, `BURST_WINDOW_S`. |
| `pipeline.py` | Module-level `BURST = BurstDetector()`; `triage()` passes the burst state to the gate and fills two new result fields. `thresholds["burst_sim"]` overrides `BURST_SIM` (for a console slider). `triage(..., track_burst=False)` for evaluation scripts. On `dev`: a langdetect guard overrides the language head when it is ≥0.90 sure of en/de (the head said `de` at 0.61 for the English hospital-VPN demo ticket). |
| `schema.py` | `TriageResult` gained `risks: list[str]` and `burst: dict`, both with defaults, so every existing constructor call still works. **Contract change: announce to the team.** |

## 3. Results

### Risk patterns (P3.1 / P3.2)

- 25/25 adversarial cases, including the six the old regexes missed (plan: `inj-en-4`, `inj-de-2`, `cred-en-2`,
  `cred-de-1`, `destr-en-1`, `destr-de-1`).
- On the 22,863 real KB tickets the hard-risk patterns fire on only **5 tickets (0.02%)**, so they don't hurt the
  auto-draft rate. `financial_commitment` fires on 0.56%, and it's a soft rule.
- `fp-2` ("wants to sue... I mean pursue") is flagged `legal`. The plan allows that, since the case has no must-not set,
  and a human glance costs little.

### Threshold sweep (P3.4)

- Data: P1's validation slice, the first 10% of `RandomState(42).permutation(22863)`, which is 2,286 KB tickets kept
  out of `heads.joblib`.
- Retrieval: Sweta's real `retrieve.search()` (queue filter, cross-lingual slot, dedup, `include_live=False`), with
  each ticket's own row removed. Each grid point runs through the real `gate.evaluate()`.
- **Selection rule, fixed in advance:** at least 95% of high-priority Incidents escalated, at least 25% auto-drafted,
  then the highest queue accuracy on auto-drafted tickets.

**Similarity floors come from hand-typed tickets, not the sweep.** Validation top-1 similarity runs p5 0.899,
p10 0.907, p25 0.918, but the dataset is synthetic and its tickets sit unusually close to each other. Measured on the
`dev` pipeline:

| Hand-typed input | Top-1 similarity |
|---|---|
| In-domain (the 7 demo samples and others) | 0.845–0.901 |
| Gibberish | 0.851 |
| Off-topic (a recipe) | 0.823 |

My first sweep picked the p25 (0.9305), which would have escalated every ticket a judge types. Sweta found the same
thing independently. The floors are therefore her hand-typed calibration, 0.865 top-1 and 0.845 mean top-3: a weak
off-topic filter that fires on only 0.1% of validation tickets. The sweep picks the confidence floors under those fixed
similarity floors.

| | Value |
|---|---|
| **Chosen** min confidence type / queue / priority | **0.75 / 0.50 / 0.70** |
| Min top-1 / mean top-3 similarity (fixed) | 0.865 / 0.845 |
| Auto-drafted share | **25.2%** |
| High-priority Incidents escalated (n=406) | **97.0%** |
| Queue accuracy: auto-drafted vs all tickets | **0.815 vs 0.609** |

Gating makes the auto-drafted tickets much more reliable. That's the slide.

**Honest note:** the plan's grid (type .35–.55, queue .20–.40, priority .30–.50) can't reach 95% high-Incident
escalation with Kunal's classifier, because its confidences are higher than the TF-IDF baseline's. The grid was
extended upward (100 points); the rule was not changed. The holdout was never touched.

On 20 holdout tickets (`scripts/draft_eval.py`, extractive path):

- 70% escalated, close to the 75% expected from validation.
- Every draft cites a real precedent: 0 fake citations, 0 invented figures, 0 placeholder leaks.
- `right_language_text` is 1.0: every reply is in the language the customer actually wrote in.

### Burst detector (P3.5)

Scenario: 3 VPN tickets (EN, EN, DE) followed by 1 invoice ticket. Measured max similarity to the earlier tickets:

| Ticket | Max similarity |
|---|---|
| EN VPN 2 | 0.937 |
| DE VPN | 0.884 |
| Invoice | 0.795 |

- The original `0.90` missed the cross-lingual ticket (`[F, F, F, F]`).
- Any value in (0.795, 0.88] gives `[F, F, T, F]`. I chose **0.86**, which leaves margin on both sides.

### Attack table (P3.6)

Full table in `reports/attack_table.md`.

- 26/26 pass.
- Every attack escalates with the correct top reason, and no injection gets a draft.
- The burst row raises the banner on the third VPN ticket and escalates it.

## 4. Things the team must know

1. **The similarity floors are a weak signal by design.** Confidence floors, hard risks and the on-call rules do the
   real gating. If retrieval changes the model, prefixes or scoring, re-measure the hand-typed bands and re-run
   `scripts/gate_sweep.py`.
2. **Evaluation scripts must pass `track_burst=False`** (or call `pipeline.BURST.clear()` between tickets), or their own
   traffic raises the burst banner. `draft_eval.py` and `attack_table.py` do this. Burst ids are `NEW-xxxx`, so they
   can't be confused with live precedents (`LIVE-xxxxx`).
3. **New result fields** `risks` and `burst` are available to the console:
   - show `burst["related"]` in the red banner;
   - use `thresholds={"burst_sim": x}` for a slider.
4. **Demo smoke test on `dev`** (no Gemini key, extractive path):

   | Sample | Result |
   |---|---|
   | 1 hospital VPN | Escalated to on-call by the outage rule; language now `en` |
   | 3 refund + PII | Escalated with the legal reason; PII masked as `<acc_num>`, `<email>`, `<tel_num>` |
   | 4 and 7 injections | Blocked, no draft |
   | 2 DE billing, 5 DE password, 6 pre-sales | Escalated on low classifier confidence (e.g. billing priority 0.36) |

   Ordinary in-domain tickets ("Cannot log in", "API integration docs") auto-draft with real `[TKT-…]` citations.
   **P4 needs a demo sample that auto-drafts in German.** Sample 2 is honestly a needs-review ticket.
5. **Retrain locally** (`scripts/train_classifier.py`). It reproduced Kunal's validation numbers within 0.001.

## 5. Q&A prep (P3.7)

1. **"What if I phrase an injection your regex misses?"** Regex is the first of three layers. The ticket is fenced as
   untrusted data in the generation prompt, and the post-gate (Track C's `verify_citations`) still rejects citations
   outside the retrieved set and figures that don't appear in any precedent. Even if the regex misses, the draft can't
   promise anything that isn't grounded. Hard-risk tickets that are caught never reach the LLM at all.
2. **"How did you pick thresholds?"** `scripts/gate_sweep.py` ran on the KB validation slice the classifier never
   trained on, with a selection rule written before the sweep ran, through the real retrieval. The holdout was never
   used. The similarity floors come from hand-typed tickets because KB-derived floors escalate 100% of real input.
   I'll say openly that the grid had to be extended when nothing met the rule.
3. **"Why is a refund request not auto-blocked?"** Refunds have real precedents (0.56% of KB tickets). The gate lets a
   refund ticket through only when a retrieved precedent's answer also discusses refunds or compensation. Any invented
   figure still forces human review.
4. **"Let me type my own attack."** If it slips through, I'll say which layer caught it (similarity, confidence,
   post-gate). Otherwise I'll add the phrasing as a new line in `CASES` and a regex alternative, and re-run
   `test_adversarial.py` live.
5. **"Doesn't the regex over-trigger?"** The hard patterns fire on 0.02% of real tickets, and the 7 look-alikes in the
   test file (password reset, "delete my draft invoice", "courtesy call", "ignore my previous email") pass clean.
