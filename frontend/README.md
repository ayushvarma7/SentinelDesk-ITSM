# SentinelDesk frontend

Vite + React + TypeScript + Tailwind v4 + recharts + lucide-react. Talks to the FastAPI app in `../api`. This is the agent console only; the customer site (overview, live triage, customer portal) is a separate app in `../customer-portal` (:5174).

## Run

From the repo root:

```bash
./run.sh app                 # API on :8000 + this console on :5173 + customer site on :5174
```

Or separately:

```bash
SD_MOCK=1 .venv/bin/uvicorn api.main:app --port 8000 --reload --reload-dir api
cd frontend && npm install && npm run dev
```

`VITE_API_URL` overrides the API base (default `http://localhost:8000`).

## Screens

| Screen | What it shows |
|---|---|
| Organisation › Tickets | Page header, 4 KPI cards, search + P / Status / Dept multiselects, INC · P1–P3 · Assigned to (Dept) · Tag / Type columns, plus quick-filter chips (Needs me, Auto-handled, Major incident, SLA < 1h), sortable table with sticky header, rows tinted by priority, live SLA pills, hover preview, keyboard nav (`↑`/`↓`, `Enter`, `Esc`, `/` to search). Major-incident banner when the burst detector fired in the last 30 min. |
| Ticket detail | Horizontal agent timeline (PII → Triage → Gate → Retrieve → Grade → Draft → Verify → Resolve) with a log panel. High-priority/escalated tickets get the AI copilot: escalation-reason cards and the draft editor. Others get "Handled by agent" with Override. |
| Draft editor | Grammarly-style checks, computed client-side in `src/components/draftAnalysis.ts`: citations underlined (hover = precedent + similarity), unverified figures squiggled amber, PII tokens as violet chips, `+cite` markers on uncited claims. Suggestions rail with Accept/Dismiss; grounding score; Approve & Send is locked while amber issues are open. |
| Dashboard | Count-up stat strip, volume by team × priority, type × priority heatmap, types by language, top tags, model performance (holdout metrics from `GET /metrics`), live latency. Computed client-side from `GET /tickets`. |
| Problems | Recurring issues grouped across tickets: who is affected, the tickets filed under each, and a resolution field. Resolved problems attach their resolution to new matching tickets. |
| Rules | Editable auto-assignment rules (keywords and model predictions mapped to your own assignment groups), a dry-run tester, and the gate policy with the threshold sweep chart. |

Grounding score = share of factual sentences that cite a retrieved precedent, minus 15 per open unverified figure
and 25 per citation that was not retrieved.

## Demo buttons (header)

- **Replay agent** re-animates the timeline on the open ticket (or opens the newest auto-resolved one).
- **Simulate outage** posts three VPN tickets (EN, EN, DE) through `POST /tickets`; the third trips the burst
  detector and the red banner appears.

## API endpoints

Tickets: `GET /tickets[?email=]`, `GET /tickets/{id}`, `POST /tickets`, `POST /tickets/{id}/approve|reject|assign`.
Triage and metrics: `POST /triage`, `GET /metrics`, `GET /health`, `GET /logs`, `GET /overview`.
Problems: `GET /problems`, `GET /problems/search`, `GET /problems/{id}`, `POST /problems/{id}/resolve|reopen`.
Rules: `GET|PUT /rules`, `POST /rules/reset`, `POST /rules/test`, `GET /gate/policy`.
Interactive docs: http://localhost:8000/docs.
