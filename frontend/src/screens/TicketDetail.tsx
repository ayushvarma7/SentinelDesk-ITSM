import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Bot, Check, Clock, Edit3, Languages, Loader2, Lock, Send, ShieldCheck, Sparkles, UserCheck, UserRound, XCircle } from 'lucide-react'
import { api, type Precedent, type Ticket } from '../api'
import { LangContext, useT } from '../i18n'
import { useToast } from '../toast'
import { Card, PiiText, PrecedentModal, PriorityBadge, SlaCountdown, StatusPill, fmtDate } from '../ui'
import DraftEditor from '../components/DraftEditor'
import PhaseTimeline from '../components/PhaseTimeline'
import EscalationCards from '../components/EscalationCards'
import ProblemCard from '../components/ProblemCard'

const DONE = ['Closed', 'Auto-Resolved']

export default function TicketDetail({ ticket, onBack, onUpdate, replay }: {
  ticket: Ticket; onBack: () => void; onUpdate: (t: Ticket) => void; replay: number
}) {
  const t = useT()
  const toast = useToast()
  const [override, setOverride] = useState(false)
  const [prec, setPrec] = useState<Precedent | null>(null)
  useEffect(() => { setOverride(false) }, [ticket.id])
  const copilotView = ticket.escalated || ticket.priority === 'high' || override

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-navy">
          <ArrowLeft size={15} />{t('back')}
        </button>
        <span className="text-xs text-slate-400"><kbd className="rounded border border-slate-300 bg-white px-1.5 font-mono text-[10px]">Esc</kbd> to go back</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm font-semibold text-coral">{ticket.id}</span>
        <h1 className="text-xl font-bold text-navy">{ticket.subject}</h1>
        <PriorityBadge p={ticket.priority} /><StatusPill s={ticket.status} />
      </div>

      <PhaseTimeline phases={ticket.agent_trace} replay={replay + (override ? 1000 : 0)} escalated={ticket.escalated} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {copilotView
            ? <CopilotCard ticket={ticket} onUpdate={onUpdate} openPrec={setPrec} />
            : <AgentView ticket={ticket} openPrec={setPrec} onOverride={async () => {
                try {
                  onUpdate(await api.reject(ticket.id, 'Override'))
                  setOverride(true)
                  toast('info', `Override on ${ticket.id}`, 'Draft moved to you for editing')
                } catch (e) { toast('warning', 'Override failed', (e as Error).message) }
              }} />}
          <ProblemCard ticket={ticket} />
          <Card className="p-5">
            <SectionTitle icon={<Lock size={12} />}>{t('ticketBody')}</SectionTitle>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{ticket.body ? <PiiText text={ticket.body} /> : '—'}</p>
          </Card>
        </div>
        <SideForm ticket={ticket} />
      </div>
      <PrecedentModal p={prec} onClose={() => setPrec(null)} />
    </div>
  )
}

function SectionTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{icon}{children}</div>
}

function PiiChip({ ticket }: { ticket: Ticket }) {
  const t = useT()
  const pii = ticket.triage.masked_pii || {}
  const n = Object.values(pii).reduce((a, b) => a + b, 0)
  if (!n) return null
  return (
    <span title={Object.entries(pii).map(([k, v]) => `${k}: ${v}`).join(', ')}
      className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
      <Lock size={11} />{t('piiMasked')} · {n}
    </span>
  )
}

/* ---------------------------------------------------------------- high priority / escalated */
function CopilotCard({ ticket, onUpdate, openPrec }: { ticket: Ticket; onUpdate: (t: Ticket) => void; openPrec: (p: Precedent) => void }) {
  const t = useT()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(ticket.copilot.text ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [blocking, setBlocking] = useState(0)
  useEffect(() => { setDraft(ticket.copilot.text ?? ''); setEditing(false) }, [ticket.id, ticket.copilot.text])
  const onBlocking = useCallback((n: number) => setBlocking(n), [])

  const act = async (name: string, fn: () => Promise<Ticket>, ok: [string, string]) => {
    setBusy(name)
    try { onUpdate(await fn()); setEditing(false); toast('success', ok[0], ok[1]) }
    catch (e) { toast('warning', `${name} failed`, (e as Error).message) }
    finally { setBusy(null) }
  }
  const closed = ticket.status === 'Closed'
  const high = ticket.priority === 'high'
  const r = ticket.triage
  const blockedWhy = !draft.trim() ? 'Write a reply first' : blocking ? `Resolve ${blocking} amber issue${blocking > 1 ? 's' : ''} in Suggestions first (Accept or Dismiss)` : null

  return (
    <Card className="rounded-xl">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-t-xl px-5 py-3 text-white ${high ? 'bg-navy' : 'bg-slate-800'}`}>
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${high ? 'pulse-ring bg-coral' : 'bg-white/15'}`}><Sparkles size={16} /></span>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-300">AI Copilot</div>
            <div className="font-semibold">{closed ? 'Resolved by you' : high ? t('needsYou') : ticket.escalated ? t('needsReview') : 'Overridden — you own this reply'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5">
          <Clock size={14} className="text-slate-300" /><span className="text-xs text-slate-300">{t('sla')}</span>
          <span className="[&_span]:!text-white"><SlaCountdown due={ticket.sla_due} done={DONE.includes(ticket.status)} /></span>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div>
          <p className="line-clamp-2 text-[15px] font-medium leading-snug text-slate-900"><PiiText text={ticket.summary} /></p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1"><UserRound size={14} />{t('raisedBy')}: <b className="font-medium text-slate-800">{ticket.requester.name}</b></span>
            <span className="inline-flex items-center gap-1"><Languages size={14} />{t('language')}: <b className="font-medium uppercase text-slate-800">{ticket.language}</b></span>
            <PiiChip ticket={ticket} />
          </div>
        </div>

        {r.escalation_reasons.length > 0 && (
          <div>
            <SectionTitle>{t('escalationReasons')}</SectionTitle>
            <EscalationCards reasons={r.escalation_reasons} />
          </div>
        )}

        <div>
          <SectionTitle icon={<Bot size={13} />}>{closed ? t('finalReply') : t('recommended')}</SectionTitle>
          {closed && ticket.final_reply ? (
            <DraftEditor text={ticket.final_reply} precedents={r.precedents} unverified={[]} lang={ticket.language} readOnly openPrec={openPrec} resetKey={ticket.id} />
          ) : ticket.copilot.text || editing ? (
            <DraftEditor text={draft} onChange={setDraft} precedents={r.precedents} unverified={ticket.copilot.unverified}
              lang={ticket.language} editing={editing} openPrec={openPrec} onBlocking={onBlocking} resetKey={ticket.id} />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
              {t('noDraft')}
              <div><button onClick={() => setEditing(true)} className="mt-2 text-sm font-semibold text-navy hover:underline">Write a reply</button></div>
            </div>
          )}
        </div>

        {!closed && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <span className="group relative">
              <button disabled={!!busy || !!blockedWhy}
                onClick={() => act('Approve', () => api.approve(ticket.id, draft !== ticket.copilot.text ? draft : undefined),
                  [`Reply sent on ${ticket.id}`, `${ticket.requester.name} will see it in the portal`])}
                className="inline-flex items-center gap-1.5 rounded-lg bg-coral px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-coral-dark disabled:cursor-not-allowed disabled:opacity-45">
                {busy === 'Approve' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{t('approve')}
              </button>
              {blockedWhy && (
                <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-64 rounded-lg bg-navy px-3 py-2 text-xs text-white shadow-xl group-hover:block">
                  {blockedWhy}
                </span>
              )}
            </span>
            <button onClick={() => setEditing(e => !e)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
              {editing ? <Check size={15} /> : <Edit3 size={15} />}{editing ? t('save') : t('edit')}
            </button>
            <button disabled={!!busy} onClick={() => act('Assign', () => api.assign(ticket.id), [`${ticket.id} assigned to you`, ticket.status === 'New' ? 'Status moved to In Progress' : `Status stays ${ticket.status}`])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
              <UserCheck size={15} />{t('assignMe')}
            </button>
            {blocking > 0 && <span className="text-xs font-medium text-amber-700">{blocking} blocking issue{blocking > 1 ? 's' : ''}</span>}
            <button disabled={!!busy} onClick={() => act('Reject', () => api.reject(ticket.id), [`AI draft rejected on ${ticket.id}`, 'Ticket stays with you, In Progress'])}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              <XCircle size={15} />{t('reject')}
            </button>
          </div>
        )}
        <PrecedentList precs={r.precedents} cited={ticket.copilot.cited_ids} openPrec={openPrec} />
      </div>
    </Card>
  )
}

function PrecedentList({ precs, cited, openPrec }: { precs: Precedent[]; cited: string[]; openPrec: (p: Precedent) => void }) {
  const t = useT()
  if (!precs.length) return null
  return (
    <div>
      <SectionTitle>{t('precedents')}</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-3">
        {precs.slice(0, 3).map(p => (
          <button key={p.ticket_id} onClick={() => openPrec(p)}
            className={`rounded-lg border p-3 text-left text-xs transition hover:border-navy/40 hover:bg-slate-50 ${cited.includes(p.ticket_id) ? 'border-navy/30 bg-navy/[0.03]' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between font-mono font-semibold text-navy"><span>{p.ticket_id}</span><span className="text-slate-500">{p.score.toFixed(3)}</span></div>
            <div className="mt-1 line-clamp-2 text-slate-700">{p.subject}</div>
            <div className="mt-1 flex items-center justify-between text-[10px] uppercase text-slate-400">
              <span>{p.language} · {p.queue}</span>{cited.includes(p.ticket_id) && <span className="rounded bg-navy px-1 text-white">cited</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- handled by agent */
function AgentView({ ticket, openPrec, onOverride }: { ticket: Ticket; openPrec: (p: Precedent) => void; onOverride: () => void }) {
  const t = useT()
  const reply = ticket.final_reply ?? ticket.triage.draft_reply
  return (
    <Card className="rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-teal-100 bg-teal-50 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white"><ShieldCheck size={16} /></span>
          <div>
            <div className="font-semibold text-teal-900">{t('handledByAgent')}</div>
            <div className="flex items-center gap-2 text-xs text-teal-700">{ticket.triage.engine ?? '—'} · {ticket.triage.latency_ms.total?.toFixed(0)} ms <PiiChip ticket={ticket} /></div>
          </div>
        </div>
        <button onClick={onOverride} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
          <Edit3 size={14} />{t('override')}
        </button>
      </div>
      <div className="space-y-4 p-5">
        {reply ? (
          <div>
            <SectionTitle icon={<Send size={13} />}>{ticket.final_reply ? t('finalReply') : t('draftReply')}</SectionTitle>
            <DraftEditor text={reply} precedents={ticket.triage.precedents} unverified={ticket.triage.unverified_claims}
              lang={ticket.language} readOnly openPrec={openPrec} resetKey={ticket.id} />
          </div>
        ) : <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No reply was drafted.</div>}
        <PrecedentList precs={ticket.triage.precedents} cited={ticket.triage.cited_ticket_ids} openPrec={openPrec} />
      </div>
    </Card>
  )
}

/* ---------------------------------------------------------------- side form */
function SideForm({ ticket }: { ticket: Ticket }) {
  const t = useT()
  const { lang } = useContext(LangContext)
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{children}</div>
    </div>
  )
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="text-sm font-semibold text-navy">{t('details')}</div>
        <Row label={t('incId')}><span className="font-mono">{ticket.id}</span></Row>
        <Row label={t('name')}>{ticket.requester.name}<div className="truncate text-xs text-slate-500">{ticket.requester.email}</div></Row>
        <Row label={t('state')}><StatusPill s={ticket.status} /></Row>
        <Row label={t('priority')}><PriorityBadge p={ticket.priority} /> <span className="ml-1 text-xs text-slate-500">{(ticket.triage.priority.confidence * 100).toFixed(0)}%</span></Row>
        <Row label={t('sla')}><SlaCountdown due={ticket.sla_due} done={DONE.includes(ticket.status)} /></Row>
        <div className="grid grid-cols-2 gap-3">
          <Row label={t('type')}>{ticket.type}</Row>
          <Row label={t('language')}><span className="uppercase">{ticket.language}</span></Row>
        </div>
        <Row label={t('queue')}>{ticket.queue}
          {ticket.routing?.rule_name && (
            <div className="mt-0.5 text-xs text-slate-500" title={`Model predicted ${ticket.routing.predicted_queue}`}>
              Routed by rule: {ticket.routing.rule_name} (model said {ticket.routing.predicted_queue})
            </div>)}
        </Row>
        <Row label={t('assigned')}>{ticket.assigned_to}</Row>
        <Row label={t('created')}>{fmtDate(ticket.created_at, lang)} · {ticket.channel}</Row>
      </Card>
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold text-navy">{t('history')}</div>
        <ol className="space-y-2 text-xs">
          {[...ticket.history].reverse().map((h, i) => (
            <li key={i} className="border-l-2 border-slate-200 pl-2.5">
              <div className="font-medium text-slate-800">{h.action}</div>
              <div className="text-slate-500">{h.actor} · {fmtDate(h.at, lang)}</div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  )
}
