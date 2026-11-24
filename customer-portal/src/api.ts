/**
 * Data layer for the customer portal.
 *
 * Everything the UI sees goes through toPublic(): it reads only id/subject/body/status/created_at/
 * final_reply/history from the API ticket. Confidence, precedents, escalation reasons, PII counts,
 * queue, tags, copilot and agent_trace are never copied into UI state.
 *
 * If the API is down (or an endpoint is missing) the portal falls back to a localStorage mock store,
 * so the demo keeps working. App shows an "offline demo mode" chip in that case.
 */
import type { Kind, PublicTicket, Status, TimelineEvent, Urgency, User } from './types'

export const API_URL = String(import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
/** The admin console is a separate app (frontend/). */
export const ADMIN_URL = String(import.meta.env.VITE_ADMIN_URL || 'http://localhost:5173').replace(/\/+$/, '')
export const MAX_BODY = 10_000
const TIMEOUT_MS = 5000

// ------------------------------------------------------------------ helpers
async function http<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(API_URL + path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    if (!res.ok) throw new HttpError(res.status)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export class HttpError extends Error {
  status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode: the demo still works for this session */
  }
}

/** Demo-only Northeastern accounts (same as the old Streamlit sign-in). Not real authentication:
 *  there is no server-side session, the API trusts the email it is given. */
export const DEMO_ACCOUNTS: Record<string, { password: string; name: string }> = {
  'demo@northeastern.edu': { password: 'demo', name: 'Demo Student' },
  'varma.ay@northeastern.edu': { password: 'ayush', name: 'Ayush Varma' },
}

export function signIn(email: string, password: string): User | null {
  const id = email.trim().toLowerCase()
  const acct = DEMO_ACCOUNTS[id]
  return acct && acct.password === password ? { id, display: acct.name } : null
}

// Customer-side memory: which card was used, the unmasked text they typed, follow-ups.
const META_KEY = 'sd-portal-meta-v1'
interface Meta {
  kind: Record<string, Kind>
  body: Record<string, string>
  followups: Record<string, TimelineEvent[]>
}
const meta = (): Meta => readLS<Meta>(META_KEY, { kind: {}, body: {}, followups: {} })
function saveMeta(fn: (m: Meta) => void) {
  const m = meta()
  fn(m)
  writeLS(META_KEY, m)
}

/** Strip internal precedent citations and dataset anonymisation tokens from a reply. */
export function cleanReply(text: string): string {
  return text
    .replace(/\s*\[(?:TKT|LIVE)-\d+\](?:\s*,\s*\[(?:TKT|LIVE)-\d+\])*/g, '')
    .replace(/<(?:name|tel_num|acc_num|email|ip_address)>|\[(?:Name|name|tel_num|Telefonnummer)\]/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** The API stores the body PII-masked; show a neutral placeholder rather than internal tokens. */
function unmaskForDisplay(text: string): string {
  return text.replace(/<(?:email|tel_num|acc_num|ip_address)>/g, '•••')
}

function refFor(id: string, kind: Kind): string {
  const digits = id.replace(/\D/g, '') || '0'
  return (kind === 'request' ? 'REQ' : 'INC') + digits.padStart(4, '0')
}

// ------------------------------------------------------------------ API -> public projection
interface ApiTicket {
  id: string
  subject?: string
  body?: string
  status?: string
  created_at?: string
  final_reply?: string | null
  history?: { at: string; actor?: string; action?: string }[]
}

const STATUS_MAP: Record<string, Status> = {
  'New': 'new',
  'In Progress': 'in_progress',
  'Escalated': 'escalated',
  'Auto-Resolved': 'resolved',
  'Closed': 'resolved',
}

function toPublic(t: ApiTicket): PublicTicket {
  const m = meta()
  const rawStatus = t.status || 'New'
  const status = STATUS_MAP[rawStatus] ?? 'in_progress'
  const kind: Kind = m.kind[t.id] ?? (/^(REQ|CHG)/.test(t.id) ? 'request' : 'incident')
  const created = t.created_at || new Date().toISOString()

  const timeline: TimelineEvent[] = [{ at: created, key: 'submitted' }]
  for (const h of t.history || []) {
    const a = (h.action || '').toLowerCase()
    if (a.startsWith('auto-resolved')) {
      timeline.push({ at: h.at, key: 'analysed' })
      // A seeded/hinted ticket can carry this entry while a human still owns it.
      if (status === 'resolved') timeline.push({ at: h.at, key: 'resolvedAuto' })
      else timeline.push({ at: h.at, key: 'reviewing' })
    } else if (a.startsWith('escalated')) {
      timeline.push({ at: h.at, key: 'analysed' })
      timeline.push({ at: h.at, key: status === 'escalated' ? 'escalated' : 'reviewing' })
    } else if (a.startsWith('approved')) {
      timeline.push({ at: h.at, key: 'resolvedAgent' })
    } else if (a.startsWith('assigned') || a.startsWith('rejected')) {
      timeline.push({ at: h.at, key: 'assigned' })
    }
  }
  timeline.push(...(m.followups[t.id] || []))
  timeline.sort((a, b) => a.at.localeCompare(b.at))

  // Reply only when auto-resolved or approved by an agent.
  const replyVisible = (rawStatus === 'Auto-Resolved' || rawStatus === 'Closed') && !!t.final_reply
  return {
    id: t.id,
    ref: refFor(t.id, kind),
    kind,
    subject: t.subject && t.subject !== '(no subject)' ? t.subject : '',
    body: m.body[t.id] ?? unmaskForDisplay(t.body || ''),
    status,
    createdAt: created,
    reply: replyVisible ? cleanReply(t.final_reply || '') : null,
    timeline,
    source: 'api',
  }
}

// ------------------------------------------------------------------ live API
export async function health(): Promise<boolean> {
  try {
    const h = await http<{ ok?: boolean }>('/health')
    return !!h.ok
  } catch {
    return false
  }
}

export async function listApiTickets(user: User): Promise<PublicTicket[]> {
  const rows = await http<ApiTicket[]>(`/tickets?email=${encodeURIComponent(user.id)}`)
  return Array.isArray(rows) ? rows.map(toPublic) : []
}

export interface NewTicket {
  kind: Kind
  subject: string
  body: string
  urgency: Urgency
  service?: string    // incidents: which service is affected
  category?: string   // requests: what kind of request
}

// ------------------------------------------------------------------ site-wide reads (no user needed)
export interface Overview {
  kb_tickets: number | null
  queues: number | null
  languages: number | null
  high_incident_pct: number | null
}

export const overview = () => http<Overview>('/overview')

/** The minimum of every ticket the site needs: counts and the service-status pill. */
export interface TicketLite {
  id: string
  created_at: string
  priority: string
  type: string
  tags: string[]
}

export const listAllTickets = () => http<TicketLite[]>('/tickets')

/** Outage: the burst detector fired in the last hour, or 3+ urgent incidents arrived in that hour. */
export function serviceOutage(all: TicketLite[]): boolean {
  const cutoff = Date.now() - 3600_000
  const recent = all.filter((x) => new Date(x.created_at).getTime() >= cutoff)
  return recent.some((x) => x.tags?.includes('major-incident')) ||
    recent.filter((x) => x.priority === 'high' && x.type === 'Incident').length >= 3
}

// ------------------------------------------------------------------ live triage (preview, nothing stored)
export interface Pred { label: string; confidence: number }
export interface Precedent {
  ticket_id: string
  score: number
  subject: string | null
  answer: string
  language: string
  queue: string
}
export interface Burst { active: boolean; related: string[]; live_id: string | null; max_sim: number }
export interface Problem {
  problem_id: number
  is_new: boolean
  status: string
  occurrences: number
  similarity: number
  resolution?: string | null
}
export interface TriageResult {
  language: string
  type: Pred
  queue: Pred
  priority: Pred
  escalate: boolean
  escalation_reasons: string[]
  precedents: Precedent[]
  draft_reply: string | null
  cited_ticket_ids: string[]
  unverified_claims: string[]
  masked_pii: Record<string, number>
  latency_ms: Record<string, number>
  status: 'AUTO_DRAFT_READY' | 'HUMAN_REVIEW' | 'ESCALATE_ONCALL'
  risks: string[]
  burst: Burst | null
  engine: string | null
  problem: Problem | null
  mode?: string
}

export const triage = (subject: string, body: string) =>
  http<TriageResult>('/triage', { method: 'POST', body: JSON.stringify({ subject, body }) }, 30_000)

/** Outage drill: files a real ticket (it lands in the admin queue) and returns its triage. */
export async function fileDrillTicket(subject: string, body: string): Promise<{ id: string; triage: TriageResult }> {
  return http('/tickets', {
    method: 'POST',
    body: JSON.stringify({ subject, body, kind: 'incident', name: 'Outage drill', email: 'drill@northeastern.edu' }),
  }, 30_000)
}

export async function createApiTicket(user: User, t: NewTicket): Promise<PublicTicket> {
  const row = await http<ApiTicket>('/tickets', {
    method: 'POST',
    body: JSON.stringify({
      subject: t.subject,
      body: t.body,
      // The API reads `email`; `requester_email` is the documented portal name (ignored by api/ today).
      email: user.id,
      name: user.display,
      kind: t.kind,
      // Shown to agents in the admin console; triage reads only subject and body.
      fields: Object.fromEntries(Object.entries({ urgency: t.urgency, service: t.service, category: t.category })
        .filter(([, v]) => v)),
    }),
  }, 30_000) // the first triage after a restart loads the models
  saveMeta((m) => {
    m.kind[row.id] = t.kind
    m.body[row.id] = t.body
  })
  return toPublic(row)
}

/** Returns true if the API accepted it, false if it was only recorded locally. Never throws. */
export async function sendFollowUp(ticket: PublicTicket, user: User, message: string): Promise<boolean> {
  const event: TimelineEvent = { at: new Date().toISOString(), key: 'followup', note: message }
  let accepted = false
  if (ticket.source === 'api') {
    try {
      await http(`/tickets/${encodeURIComponent(ticket.id)}/followup`, {
        method: 'POST',
        body: JSON.stringify({ message, email: user.id }),
      })
      accepted = true
    } catch {
      accepted = false // 404 today: endpoint missing in api/
    }
  }
  if (ticket.source === 'local') {
    mockAddFollowUp(ticket.id, event)
  } else {
    saveMeta((m) => {
      ;(m.followups[ticket.id] ||= []).push(event)
    })
  }
  return accepted
}

// ------------------------------------------------------------------ offline mock store
const MOCK_KEY = 'sd-portal-mock-v1'
const SETTLE_MS = 4000 // "analysing" delay before the mock outcome shows

interface MockTicket {
  id: string
  owner: string
  kind: Kind
  subject: string
  body: string
  createdAt: string
  settleAt: number
  outcome: Status
  reply: string | null
  timeline: TimelineEvent[]
  seed?: boolean
}
interface MockDB {
  seq: number
  tickets: MockTicket[]
}
const mockDB = (): MockDB => readLS<MockDB>(MOCK_KEY, { seq: 11, tickets: [] })

const DE_RE = /[äöüß]|\b(der|die|das|und|ist|nicht|wir|ich|bitte|mit|seit|unser|kann|keine?|funktioniert)\b/i
const URGENT_RE = /\b(urgent|asap|immediately|critical|emergency|outage|down|all users|patients?|dringend|sofort|kritisch|ausfall|alle mitarbeiter)\b/i

const REPLIES: { re: RegExp; en: string; de: string }[] = [
  {
    re: /passw|login|log in|anmeld|sign in|locked|gesperrt/i,
    en: 'Thanks for reaching out. Reset emails are sometimes held by the spam filter, so please check your spam folder and request the reset again. If your account is locked after several attempts, reply here and we will unlock it for you.',
    de: 'Vielen Dank für Ihre Nachricht. E-Mails zum Zurücksetzen landen manchmal im Spam-Ordner. Bitte prüfen Sie diesen und fordern Sie den Link erneut an. Falls Ihr Konto nach mehreren Versuchen gesperrt ist, antworten Sie hier und wir entsperren es.',
  },
  {
    re: /print|drucker/i,
    en: 'Thanks for the report. This usually happens when the printer picks up a new network address after an update. Please remove and re-add the printer; if jobs still stay in the queue, reply here and we will reserve a fixed address for it.',
    de: 'Danke für Ihre Meldung. Das passiert meist, wenn der Drucker nach einem Update eine neue Netzwerkadresse erhält. Bitte entfernen Sie den Drucker und fügen Sie ihn erneut hinzu. Bleiben Aufträge weiter hängen, antworten Sie hier.',
  },
  {
    re: /invoice|rechnung|billing|abbuch|charged/i,
    en: 'Thanks for letting us know. We have checked your invoice and corrected it; an updated copy will be sent to your billing contact shortly.',
    de: 'Danke für Ihren Hinweis. Wir haben Ihre Rechnung geprüft und korrigiert; eine aktualisierte Rechnung geht in Kürze an Ihren Rechnungskontakt.',
  },
  {
    re: /access|zugang|zugriff|licen[cs]e|lizenz|install|software/i,
    en: 'Thanks for your request. Access and software requests are approved by your manager; we have forwarded it and you will receive a confirmation email once it is granted.',
    de: 'Danke für Ihre Anfrage. Zugänge und Software werden von Ihrer Führungskraft freigegeben; wir haben die Anfrage weitergeleitet und Sie erhalten eine Bestätigung per E-Mail.',
  },
]

function mockOutcome(t: NewTicket): { status: Status; reply: string | null } {
  const text = `${t.subject}\n${t.body}`
  const letters = (text.match(/\p{L}/gu) || []).length
  if (letters < 3) return { status: 'new', reply: null } // emoji-only / empty: a human reads it
  if (t.urgency === 'critical' || t.urgency === 'high' || URGENT_RE.test(text)) {
    return { status: 'escalated', reply: null }
  }
  const hit = REPLIES.find((r) => r.re.test(text))
  if (!hit) return { status: 'in_progress', reply: null }
  return { status: 'resolved', reply: DE_RE.test(text) ? hit.de : hit.en }
}

function mockToPublic(m: MockTicket, now = Date.now()): PublicTicket {
  const settled = now >= m.settleAt
  const status: Status = settled ? m.outcome : 'new'
  const at = new Date(m.settleAt).toISOString()
  const tl: TimelineEvent[] = [{ at: m.createdAt, key: 'submitted' }]
  if (settled) {
    tl.push({ at, key: 'analysed' })
    if (m.outcome === 'resolved') tl.push({ at, key: 'resolvedAuto' })
    else if (m.outcome === 'escalated') tl.push({ at, key: 'escalated' })
    else if (m.outcome === 'in_progress') tl.push({ at, key: 'reviewing' })
  }
  tl.push(...m.timeline)
  tl.sort((a, b) => a.at.localeCompare(b.at))
  return {
    id: m.id,
    ref: m.id,
    kind: m.kind,
    subject: m.subject,
    body: m.body,
    status,
    createdAt: m.createdAt,
    reply: settled && m.outcome === 'resolved' ? m.reply : null,
    timeline: tl,
    source: 'local',
  }
}

export function mockCreate(user: User, t: NewTicket, opts: { seed?: boolean; ageMin?: number } = {}): PublicTicket {
  const db = mockDB()
  db.seq += 1
  const id = (t.kind === 'request' ? 'REQ' : 'INC') + String(db.seq).padStart(4, '0')
  const created = Date.now() - (opts.ageMin || 0) * 60_000
  const { status, reply } = mockOutcome(t)
  const row: MockTicket = {
    id,
    owner: user.id,
    kind: t.kind,
    subject: t.subject,
    body: t.body,
    createdAt: new Date(created).toISOString(),
    settleAt: opts.ageMin ? created + 60_000 : created + SETTLE_MS,
    outcome: status,
    reply,
    timeline: [],
    seed: opts.seed,
  }
  db.tickets.push(row)
  writeLS(MOCK_KEY, db)
  return mockToPublic(row)
}

function mockAddFollowUp(id: string, ev: TimelineEvent) {
  const db = mockDB()
  const row = db.tickets.find((x) => x.id === id)
  if (row) {
    row.timeline.push(ev)
    writeLS(MOCK_KEY, db)
  }
}

/** Local tickets for this user. Seeds only appear in offline mode. */
export function mockList(user: User, offline: boolean): PublicTicket[] {
  const now = Date.now()
  return mockDB()
    .tickets.filter((x) => x.owner === user.id && (offline || !x.seed))
    .map((x) => mockToPublic(x, now))
}

/** Give an offline demo user two example tickets so My History is not empty. */
export function ensureMockSeed(user: User) {
  if (mockDB().tickets.some((x) => x.owner === user.id && x.seed)) return
  mockCreate(user, {
    kind: 'incident', subject: 'Password reset link not arriving', urgency: '',
    body: 'I tried to reset my password three times this morning but the reset email never arrives.',
  }, { seed: true, ageMin: 180 })
  mockCreate(user, {
    kind: 'request', subject: 'Neue Lizenz für Adobe Acrobat', urgency: '',
    body: 'Hallo, ich benötige eine zusätzliche Lizenz für unser neues Teammitglied. Vielen Dank!',
  }, { seed: true, ageMin: 45 })
}
