# Frontend notes (Step 0 read-through)

1. Entry point: `sentineldesk.pipeline.triage(subject: str|None, body: str|None, thresholds: dict|None=None, track_burst: bool=True) -> TriageResult`. Safe on None/empty/long input.
2. `TriageResult`: `language: str`, `type`/`queue`/`priority: Prediction(label, confidence, all_probs)`, `escalate: bool`, `escalation_reasons: list[str]`, `precedents: list[Precedent]`, `draft_reply: str|None` (None when escalated), `cited_ticket_ids: list[str]`, `unverified_claims: list[str]`, `masked_pii: dict[str,int]`, `latency_ms: dict` (embed/classify/retrieve/generate/total), `risks: list[str]`, `burst: dict` ({active, related, live_id, max_sim}), `engine: str|None`; property `overall_confidence = min(type, queue, priority conf)`.
3. `Precedent`: `ticket_id, score, subject, body_snippet, answer, language, queue`.
4. Priority labels are lowercase `high|medium|low`; types `Incident|Request|Problem|Change`; languages `en|de`. Priority is `high` whenever P(high) >= 0.25 (recall-oriented).
5. Gate (`gate.evaluate`) is deterministic regex + thresholds: hard risks (prompt_injection, credential_request, destructive_action, legal) always escalate; high+Incident or outage+urgency -> on-call; burst; too-little-text; confidence floors type 0.75 / queue 0.50 / priority 0.70; similarity floors 0.865 top-1 / 0.845 mean top-3; refunds without precedent.
6. `gate.py`, `pii.py`, `schema.py`, `generate.py` are pure Python (re/os only) -> the API mock reuses the real gate regexes and PII masker without torch/numpy.
7. `pipeline.py` imports `burst.py` (numpy) and lazily embed/classify/retrieve (torch, sklearn, artifacts/). Stage stubs kick in when `artifacts/` is missing; `data/` and `artifacts/` are not in this checkout.
8. Burst detector: module-level `pipeline.BURST`, active when >=3 tickets within 30 min at cosine >= 0.86; result carries `burst.active` -> major-incident banner.
9. PII tokens: `<email>`, `<tel_num>`, `<acc_num>`, `<ip_address>`; `masked_pii` counts by kind (email, iban, card, ip, account, phone).
10. Dashboard KPI "high-priority Incident recall" = `reports/triage_metrics.json` -> `high_priority_incident.recall_predicted_high_and_incident` (0.7729); gate-escalated recall 0.97 is in `reports/gate_sweep.json` -> `chosen.high_incident_escalated`.
