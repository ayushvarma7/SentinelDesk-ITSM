# P1 / Track A (Triage): work done and P2 takeover guide

Branch `feature-kunal` (on top of Jay's scaffold `07f33b26`) · 21 Nov 2026 ·
Status: **classifier frozen, holdout evaluated, wired into `pipeline.triage()`, contract tests pass**

1. [Summary](#1-summary)
2. [Where P1 lives in the scaffold](#2-where-p1-lives-in-the-scaffold)
3. [What P1 did, step by step](#3-what-p1-did-step-by-step)
4. [Results](#4-results)
5. [How P2 takes over (Track B retrieval + Track C generation)](#5-how-p2-takes-over-track-b-retrieval--track-c-generation)
6. [Findings the gate owner must act on](#6-findings-the-gate-owner-must-act-on)
7. [Open items](#7-open-items)

---

## 1. Summary

- `classify.py` (Track A) is implemented to the scaffold's contract: four heads (type, queue, priority, language)
  over `[word TF-IDF || e5 query embedding]`, returning `schema.Prediction` objects.
- Holdout macro-F1 (5,718 tickets):
  - type **0.878**
  - queue **0.611**
  - priority **0.620**
  - language **0.967**
- High-priority Incident recall is **0.852**, from a P(high) threshold of 0.25 tuned on a KB validation slice.
- `pipeline.triage()` now runs the real `embed` and `classify` stages (`STAGES["embed"]`/`["classify"] = True`).
  `retrieve` and `generate` are still stubs, and they are P2's job.
- `embed.encode()` is implemented to the contract because the classifier needs it. Track B still owns the file.
- `tests/test_contract.py` passes with the real classifier.

## 2. Where P1 lives in the scaffold

```
src/sentineldesk/
  classify.py        Track A (P1): fit / predict_proba / decide / train / save / load / predict
  embed.py           Track B: encode(texts, is_query): implemented by P1 to the contract
  text.py            shared: build_text() now also cleans the literal "\n" and <br> (see §3)
  config.py          shared: new "triage classifier (Track A)" block (HEADS_PATH, CLASSIFIER_C, thresholds)
  pipeline.py        embed + classify stages switched on, with stub fallback if heads.joblib is missing
  schema.py, data.py, gate.py, pii.py, retrieve.py, generate.py   unchanged
scripts/
  prepare_data.py    Jay's: kb_train / test_inputs / test_labels parquets
  train_classifier.py   P1: trains heads on 90% of KB, tunes P(high) on the 10% validation slice
  evaluate.py        P1: holdout eval, the only caller of load_test_labels()
tests/test_contract.py
docs/p1_workdone.md  this file
```

Run everything from the repo root with `PYTHONPATH=src`:

```bash
python scripts/prepare_data.py                                 # once: writes data/processed/*.parquet
PYTHONPATH=src python scripts/train_classifier.py              # ~1 min (+3-5 min the first time to encode the KB)
PYTHONPATH=src python scripts/evaluate.py                      # holdout, once per frozen model
PYTHONPATH=src python tests/test_contract.py
```

## 3. What P1 did, step by step

The first pass followed the execution plan doc's flat layout. When Jay's scaffold landed on `main` and `feature-kunal`,
the work was ported into it. The flat version is kept on the local branch `kunal-p1-flat-backup`.

| Step | What happened |
|---|---|
| EDA review | Took from `notebooks/01_eda.ipynb`: always use subject + body (14% of subjects are missing), use class weights (queue imbalance is 21x), report macro-F1, and train on the KB split only. |
| Data cleaning | Bodies store newlines as a literal backslash + n, and some fields contain `<br>`. Both are now normalised in `text.build_text()`, the one place text is assembled, so TF-IDF doesn't learn junk tokens like `nThe` and retrieval sees clean text too. |
| Baseline | TF-IDF only, C=4. Validation (2,286 KB tickets): type 0.8745, queue 0.5858, priority 0.6242. Holdout: type 0.8747, queue 0.5718, priority 0.5974; high-Incident recall 0.8563. |
| Embeddings | KB encoded with `intfloat/multilingual-e5-small`, `"query: "` prefix, L2-normalised, cached in `artifacts/kb_query_embeddings.npy`. |
| Experiment grid | 10 runs on the validation slice (§4). Selection rule fixed in advance: best val queue + priority macro-F1, with val high recall ≥ 0.80. Winner: **C=32, embedding weight 1.0**. |
| Holdout | One evaluation of the frozen model (§4). |
| Scaffold port | Implemented `classify.py` to the contract, added the language head, wired `pipeline.py`, implemented `embed.encode()`, and moved the eval into `scripts/evaluate.py` using `load_test_inputs()` / `load_test_labels()`. The port reproduces the frozen validation numbers to four decimals. |
| Bug avoided | On macOS, importing faiss before torch aborts the process (`OMP: Error #15`, duplicate libomp). P1 code never imports faiss. See §5.4. |

## 4. Results

### Holdout (5,718 tickets; never used to choose anything)

| Metric | TF-IDF baseline | **Final** |
|---|---|---|
| Type macro-F1 / ECE | 0.8747 / 0.050 | **0.8777 / 0.028** |
| Queue macro-F1 / ECE | 0.5718 / 0.144 | **0.6109 / 0.012** |
| Priority macro-F1 / ECE | 0.5974 / **0.039** | **0.6195** / 0.082 |
| Language macro-F1 / ECE | n/a | **0.9666 / 0.003** |
| High-priority Incident recall: predicted high (n=995) | **0.8563** | 0.8523 |
| High-priority Incident recall: predicted high **and** Incident | 0.7658 | **0.7729** |

Priority ECE rises because any ticket with P(high) ≥ 0.25 is labelled `high`, so those tickets carry confidences
of 0.25–0.5. That's the intended trade: a missed outage costs more than a false alarm.

The language head reproduces the dataset's `language` label. The EDA found that label disagrees with langdetect
on 12% of tickets, mostly German-labelled tickets written in English, so 0.97 is close to the ceiling.

### Validation grid (first 10% of `RandomState(42).permutation(22863)` = 2,286 KB tickets)

| Run | Settings | Type | Queue | Priority | High recall |
|---|---|---|---|---|---|
| E0 | TF-IDF only, C=4 | 0.8745 | 0.5858 | 0.6242 | 0.8115 |
| E1 | C=4 + e5 | 0.8789 | 0.5808 | 0.6167 | 0.8624 |
| E1b | C=4 + e5, emb weight 0.5 | 0.8773 | 0.5836 | 0.6233 | 0.8028 |
| E2 | C=1 | 0.8595 | 0.4976 | 0.5846 | 0.8115 |
| E3 | C=8 | 0.8836 | 0.5966 | 0.6350 | 0.8527 |
| E4 | char 3-5-grams | 0.8782 | 0.5907 | 0.6249 | 0.8407 |
| E5 | char + emb weight 2 | 0.8786 | 0.5807 | 0.6242 | 0.8397 |
| E6 | C=16 | 0.8860 | 0.6106 | 0.6315 | 0.8353 |
| E7 | C=8 + char | 0.8779 | 0.6117 | 0.6289 | 0.8342 |
| **E8** | **C=32 (frozen)** | **0.8854** | **0.6160** | **0.6343** | **0.8202** |

Language head on validation: 0.9691. C=16 and C=32 differ by under one point (close to noise), so the grid stopped there.

## 5. How P2 takes over (Track B retrieval + Track C generation)

### 5.1 Setup

```bash
git fetch origin && git checkout feature-kunal        # or merge it into your own branch
python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
# put the raw CSVs in data/raw/, then:
python scripts/prepare_data.py
PYTHONPATH=src python scripts/train_classifier.py     # rebuilds artifacts/heads.joblib in YOUR environment
PYTHONPATH=src python tests/test_contract.py          # must end with "all contract tests passed"
```

**Retrain locally; don't copy `heads.joblib` from Drive.** It was trained with scikit-learn 1.9.1 on Python 3.14.
`requirements.txt` pins scikit-learn 1.5.2, and joblib pickles aren't safe across sklearn versions. Training takes
about 1 minute once the embeddings are cached. `kb_query_embeddings.npy` and `kb_query_ids.npy` (about 35 MB) can be
shared via Drive to skip the 3–5 minute encode.

### 5.2 What the pipeline already gives you

In `pipeline.triage()`, by the time retrieval runs:

```python
text  = build_text(subject, body)                     # cleaned
qvec  = embed.encode([text], is_query=True)[0]        # (384,) float32, L2-normalised: reuse it, don't re-encode
preds = classify.predict(qvec, text)                  # {"type"|"queue"|"priority"|"language": Prediction}
```

To plug in retrieval:
1. Replace `precedents = _stub_precedents()` with `retrieve.search(qvec, config.TOP_K, ...)`.
2. Flip `STAGES["retrieve"] = True`.

`preds["queue"].label` is available if you implement `queue_filter`.

### 5.3 Rules that keep P1 and P2 compatible

1. **Two KB embedding files, on purpose.**
   - `artifacts/kb_embeddings.npy` (yours): the KB encoded with `is_query=False` (`passage:`), for the retrieval index, as the scaffold intends.
   - `artifacts/kb_query_embeddings.npy` (mine): the KB encoded with `is_query=True`, the classifier's training features.
     At inference the classifier sees a query-prefixed vector, so it must be trained on query-prefixed vectors.
   - Don't point the classifier at `kb_embeddings.npy`, and don't delete `kb_query_embeddings.npy`.
2. **Don't change `embed.encode()` semantics** (model, prefixes, normalisation) without telling P1. Any change means
   re-encoding `kb_query_embeddings.npy` and retraining. The trainer detects a changed KB order, but not a changed encoder.
3. **Always build text with `build_text()`.** It now cleans the literal `\n` and `<br>`. Index the KB with the same function.
4. **KB order = `data.load_kb()`** (22,863 rows; the 6 answerless rows dropped). `kb_query_ids.npy` stores the
   `ticket_id` for each row.
5. **Leakage:** only `load_kb()` answers go into prompts or the UI. `load_test_labels()` is for `scripts/evaluate.py` only.

### 5.4 Retrieval notes from P1's measurements

- **faiss on macOS:** `faiss` and `torch` each bundle libomp. Importing faiss before torch kills the process with
  `OMP: Error #15`, and the pipeline imports both. As `retrieve.py`'s docstring already suggests, use numpy:
  exact search over 22,863 × 384 measured **0.9 ms** per query. If you keep faiss, import `sentence_transformers`/torch first.
- **Similarity scale:** e5 cosine scores fall in a narrow band. Query-vs-query KB scores were p5 0.935, p10 0.946,
  p25 0.958 on 500 holdout tickets. Your query-vs-passage scores will differ, so measure them, but expect a narrow, high band.
- **Retrieval quality (query-vs-query, 500 holdout tickets):**
  - the top-1 precedent has the same type 90.4% of the time and the same queue 76.0%;
  - ~~16.2% of top-5 hits are in the other language, so cross-lingual matching works without extra work.~~
    **Corrected by P2:** measured against the *detected* language, only 1–3% of hits really cross languages. The 16%
    was tickets labelled `de` but written in English. P2 added a reserved cross-lingual slot (`CROSS_LINGUAL_SLOTS`).
- **Latency:** after warm-up, `encode` takes about 11 ms per ticket on CPU. The **first** `triage()` call takes about 4.5 s
  (model load), so the console should call `triage()` once at startup.

### 5.5 Contract change P1 made (announce to the team)

`classify.predict(x, text=None)`. The scaffold signature was `predict(x)`, but the frozen model also uses TF-IDF on the
ticket text. `text` is optional, so the old call still works, but without it predictions rely on the embedding alone
and are worse. `pipeline.py` already passes it. `classify.train(X, y, texts=None)` got the same treatment.

## 6. Findings the gate owner must act on

The thresholds in `config.py` were set before any model existed:

| Setting | Current | Issue |
|---|---|---|
| `MIN_TOP1_SIMILARITY` | 0.72 | e5 similarities sit around 0.88–0.98, so this will practically never fire. Set it from the measured percentiles once retrieval exists (p10 is a reasonable start). |
| `MIN_MEAN_TOP3_SIMILARITY` | 0.65 | Same problem. |
| `MIN_CONFIDENCE["queue"]` | 0.45 | Queue confidence is often 0.3–0.5. Even the German VPN demo ticket escalates with "queue: 0.41 < 0.45". With queue ECE 0.012 the confidences are honest, so expect a high escalation rate. Tune it on the validation slice. |
| `MIN_CONFIDENCE["priority"]` | 0.55 | Any ticket pushed to `high` by the 0.25 threshold can have confidence below 0.55. Those are high-priority tickets, which the hard rule escalates anyway when the type is Incident. |
| emoji-only ticket | — | `tests/test_contract.py` shows `"🔥🔥🔥"` gets `escalate=False`. That will auto-draft once generation is on. Consider a minimum-content rule. |

Tune on the same validation slice the classifier held out (`RandomState(42).permutation(len(kb))[:2286]`). The saved
heads were trained without those rows, so the confidences there are honest.

## 6b. Root-cause grouping (added after the first push)

`src/sentineldesk/rootcause.py` (Track A) follows the ITIL model:

```
Request  "I need a laptop"            -> fulfilled, no root cause
Incident "Outlook not working"    ┐
Incident "Can't receive mails"    ├─ many -> one  Problem "Outlook mail sync broken" ── fixed by ─> Change(s)
Incident "Outlook keeps crashing" ┘
```

| Piece | What it does | Evidence |
|---|---|---|
| Critical rule | `gate.py` hard rule now fires on high + **Incident or Problem** (`config.CRITICAL_TYPES`) | Validation recall 0.803 → **0.882**; share escalated by this rule 26.2% → 36.5%. Holdout: 0.7729 → **0.8503** (34.2% escalated) |
| Live grouping | `rootcause.GROUPER` links each new issue to live issues from the last 30 min at sim ≥ 0.89; 3+ → gate reason *"Probable shared root cause … raise a Problem record"* | 0.89 is just above the p90 of unrelated KB issue pairs (0.891). Test: 3 EN Outlook tickets group, invoice/VPN/printer stay separate; a German Outlook ticket joins through a bridging ticket |
| Known history | Closest KB Problem and Change, searched in **P2's retrieval index** (`kb_embeddings.npy`, Problem/Change rows only, query → passage); shown if sim ≥ 0.89 | Query → passage scale: unrelated issue → Problem/Change pairs p99 = 0.883; KB issues' best related Problem median 0.923. The task-sync ticket links correctly (TKT-08224, 0.899) |
| Root-cause-aware RAG | If the known Problem wasn't already retrieved, the pipeline appends it to the precedents given to the drafter (after the gate, so similarity rules judge plain retrieval only) | 300 holdout tickets: 92% of issues linked to a known Problem, 59% to a known Change; Problem added to the RAG context 94 times; 15 extractive drafts cited it. p50 latency 13 ms end to end |

**Limit:** hand-typed tickets score about 0.86–0.89 against the KB (P2 measured the same band), so for typed demo input
the known-history link usually stays empty. The KB-style holdout tickets link 92% of the time. Lowering the threshold
toward 0.875 would show more links but enters the unrelated-pair tail (p99 0.883).

Contract changes, all backwards compatible:
- `schema.RootCause` is new.
- `TriageResult.root_cause` is optional and defaults to None.
- `gate.evaluate(..., root_cause=None)` takes a new optional argument.

Latency is about 3–5 ms per ticket, plus about 190 ms once while the KB index loads.

Decision for the gate owner: the critical rule's escalation volume (36% on validation) is above the scaffold's 15–25%
target. Recall versus volume is a product call. To revert, set `CRITICAL_TYPES = ("Incident",)`.

Limits:
- The dataset has no Incident → Problem links, so grouping accuracy can't be scored, only demonstrated.
- Grouping is per process, in memory, and resets on restart.

## 7. Open items

| Item | Owner | Blocked on |
|---|---|---|
| `evaluate.py`: gate escalation recall, retrieval stats, latency p50/p95 | P1 | `retrieve` + `generate` stages |
| Gate threshold sweep (§6) | gate owner + P1 | retrieval similarities |
| `QA.md` (model choice, queue ceiling, threshold trade-off, leakage proof, ECE) | P1 | nothing |
| `requirements.txt`: pins say Python 3.12 and torch 2.5.1; P1 ran on Python 3.14 with torch 2.15 / sklearn 1.9.1 | team | agree one environment |
