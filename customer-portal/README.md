# SentinelDesk Customer Portal

A customer-facing support portal, separate from the agent console (`frontend/`, :5173).
Built with Vite, React, TypeScript, Tailwind 4 and lucide-react. It runs on **port 5174**.

## Run

```bash
# 1. API (repo root) — mock mode works without data/ or artifacts/
SD_MOCK=1 .venv/bin/uvicorn api.main:app --port 8000

# 2. Portal
cd customer-portal
cp .env.example .env          # VITE_API_URL=http://localhost:8000
npm install
npm run dev                   # http://localhost:5174
```

- Production build: `npm run build && npm run preview` (preview also serves on 5174).
- If you skip the API, the portal still works in **offline demo mode**: a chip appears in the header, and tickets are stored in `localStorage`.
- Demo logins that already have tickets on the mock API:
  - `emily.carter@brightwave.io`
  - `t.wagner@wagner-logistik.de` (German)
  - `h.ortiz@stmarys-health.org`
- Any email works for login. A phone number (7–15 digits) works too.

## Features

- **Login:** email or phone. The login is fake and lives in React state only, so a page reload signs you out.
- **EN/DE toggle:** every UI string comes from `src/i18n.ts`. Customers can type their ticket in either language.
- **Home:**
  - A search bar that searches only your own tickets.
  - **Report an Incident** and **Make a Request** cards, each opening a form: subject (optional), description (required), and an optional urgency dropdown.
- **Confirmation:** shows a ticket reference such as `INC10046`, `REQ10047`, or `INC0014` offline.
- **My History sidebar:** status pills (New, In Progress, Resolved, Escalated) and a Status panel for the selected ticket. The list refreshes every 5 s.
- **Ticket detail:**
  - A progress timeline.
  - The reply is shown only for auto-resolved tickets or tickets approved by an agent. Otherwise: "An engineer is reviewing your ticket."
- **Floating assistant:**
  - Shows the latest update for the selected ticket.
  - Takes a follow-up question. It tries `POST /tickets/{id}/followup`; that endpoint is missing today, so the follow-up is recorded locally and the assistant replies "Follow-up sent to support."

## Customer-safe data

`src/api.ts → toPublic()` copies only these fields into UI state: `id`, `subject`, `body`, `status`, `created_at`, `final_reply` and `history`.

- Not shown: confidence, precedents, escalation reasons, PII counts, queue, tags, copilot and agent trace.
- Precedent citations (`[TKT-…]`) and dataset tokens (`<email>`, `<tel_num>`, …) are stripped from replies.
- **Caveat:** the API still sends those internal fields over the network, so they are visible in devtools. See `.shared/BACKEND_REVIEW.md`.

## Edge cases handled

- Empty or whitespace-only description is blocked with a validation message. An empty subject is allowed.
- Descriptions are capped at 10,000 characters, with a counter. Long unbroken text wraps without horizontal scroll, and long messages collapse behind "Show more".
- Emoji-only text and German umlauts are stored and shown unchanged.
- An API that is down or times out (5 s) triggers the offline mock store; the portal does not crash.
- A missing endpoint (404) falls back to local handling.
