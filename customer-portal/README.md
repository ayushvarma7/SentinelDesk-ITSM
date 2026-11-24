# SentinelDesk customer site

The customer-facing side of SentinelDesk, separate from the admin console (`../frontend`, :5173). Built with Vite,
React, TypeScript, Tailwind 4 and lucide-react. It runs on **port 5174** and talks to the FastAPI backend in `../api`.

## Run

From the repo root, this starts the API and both web apps:

```bash
./run.sh app
```

Or this app alone (the API must be running for tickets to reach the admin console):

```bash
cd customer-portal
cp .env.example .env          # VITE_API_URL=http://localhost:8000
npm install
npm run dev                   # http://localhost:5174
```

Production build: `npm run build && npm run preview` (preview also serves on 5174).
`VITE_API_URL` and `VITE_ADMIN_URL` (default `http://localhost:5173`) override the API and admin console addresses.

## Pages

| Page | What it is |
|---|---|
| **Overview** (`#/`) | Knowledge-base numbers from `GET /overview`, the three entry points, and how a ticket moves through the system. |
| **Live triage** (`#/triage`) | Paste any ticket, or pick one of 14 samples, and see type, queue, priority with confidence, the gate's decision with its reasons, what PII was masked, the retrieved past tickets and the draft. Uses `POST /triage`, which stores nothing. The **outage drill** files four real tickets, so they also appear in the admin queue. |
| **Customer portal** (`#/portal`) | Sign in, report an incident or make a request, follow your tickets. Tickets go to `POST /tickets`, the same API the admin console reads. |
| **Admin portal** | Link that opens the admin console. |

EN/DE toggle: every UI string comes from `src/i18n.ts` or the page's own text table. Customers can write tickets in
either language.

## Sign-in

The sign-in is a demo with two accounts defined in `src/api.ts` (`DEMO_ACCOUNTS`). It is not real authentication: it
lives in React state, so a page reload signs you out, and the API trusts the email address it is sent.

| Email | Password |
|---|---|
| `varma.ay@northeastern.edu` | `ayush` |
| `demo@northeastern.edu` | `demo` |

## The portal

- **Home:** greeting, a service-status pill (red when a major incident is active or three urgent incidents arrived in
  the last hour), a search over your own tickets, and the **Report an Incident** and **Make a Request** cards.
- **Forms:** subject (optional), description (required, up to 10,000 characters), optional urgency.
- **My History sidebar:** status pills (New, In Progress, Resolved, Escalated) and a status panel for the selected
  ticket. The list refreshes every 5 seconds.
- **Ticket detail:** a progress timeline. The reply is shown only for auto-resolved tickets or tickets an agent has
  approved; otherwise "An engineer is reviewing your ticket."
- **Floating assistant:** shows the latest update and takes a follow-up question. The API has no follow-up endpoint
  yet, so follow-ups are stored in the browser only.

## Customer-safe data

`src/api.ts → toPublic()` copies only `id`, `subject`, `body`, `status`, `created_at`, `final_reply` and `history` into
UI state. Confidence, precedents, escalation reasons, PII counts, queue, tags, the copilot text and the agent trace are
never shown. Precedent citations (`[TKT-…]`) and dataset tokens (`<email>`, `<tel_num>`, …) are stripped from replies.

**Caveat:** the API still sends those internal fields over the network, so they are visible in the browser's network
tab. A production system would return a separate customer view from its own endpoint.

## Offline demo mode

If the API is down or times out (5 seconds), the portal switches to a local demo store: a chip appears in the header
and tickets are kept in `localStorage`, so the page never crashes. Live triage and the overview need the API.
