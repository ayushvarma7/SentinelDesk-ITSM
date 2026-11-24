// Problem management. A problem is one underlying issue behind several tickets: when the same fault keeps
// being reported, the tickets are grouped (src/sentineldesk/store.py) so IT can fix the cause once instead of
// answering every incident again. Once a problem is resolved, its resolution is shown to the agent on every
// new ticket that matches it. API: GET /problems, /problems/{id}, /problems/search, /logs.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, ChevronRight, Info, Loader2, RotateCcw, Search, Users } from 'lucide-react'
import { api, type DbStats, type LogRow, type Priority, type ProblemDetail, type ProblemListRow, type ProblemTicket } from '../api'
import { useToast } from '../toast'
import { PRIO_STYLE, PiiText, PriorityBadge, StatusPill } from '../ui'
import { MetricCard, PageHeader } from '../components/kit'

type Tab = 'problems' | 'check' | 'log'
type Filter = 'attention' | 'open' | 'resolved' | 'all'
type Sort = 'reports' | 'recent' | 'priority'
type SearchHit = Awaited<ReturnType<typeof api.searchProblems>>

const RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }
const field = 'h-10 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-coral focus:ring-1 focus:ring-coral/30'

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 2) return 'just now'
  if (m < 90) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const prio = (p: string): Priority => (p in PRIO_STYLE ? p : 'medium') as Priority

function ProblemStatus({ status, reports }: { status: string; reports: number }) {
  if (status === 'resolved') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"><CheckCircle2 size={12} />Resolved</span>
  if (reports >= 2) return <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-coral ring-1 ring-red-200">Needs a fix</span>
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">Open</span>
}

function Panel({ title, right, children, className = '' }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-white ${className}`}>
      {title && <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3"><h2 className="text-sm font-semibold text-ink">{title}</h2>{right}</div>}
      <div className="p-5">{children}</div>
    </section>
  )
}

function TicketChips({ tickets, total, onOpen }: { tickets: ProblemTicket[]; total: number; onOpen: (id: string) => void }) {
  if (!tickets.length) return <span className="text-xs text-muted">no tickets in the queue</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tickets.slice(0, 3).map(t => (
        <span key={t.id} role="link" tabIndex={0} title={t.subject}
          onClick={e => { e.stopPropagation(); onOpen(t.id) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(t.id) } }}
          className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink ring-1 ring-line hover:text-coral hover:ring-coral">{t.id}</span>
      ))}
      {total > 3 && <span className="text-xs text-muted">+{total - 3} more</span>}
    </span>
  )
}

function ListView({ rows, stats, onOpen, onOpenTicket }: {
  rows: ProblemListRow[]; stats: DbStats | null; onOpen: (id: number) => void; onOpenTicket: (id: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('attention')
  const [sort, setSort] = useState<Sort>('reports')
  const [q, setQ] = useState('')
  const attention = (r: ProblemListRow) => r.status === 'open' && r.occurrences >= 2
  const counts = useMemo(() => ({
    attention: rows.filter(attention).length, open: rows.filter(r => r.status === 'open').length,
    resolved: rows.filter(r => r.status === 'resolved').length, all: rows.length,
  }), [rows])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const keep = rows.filter(r =>
      (filter === 'all' || (filter === 'attention' ? attention(r) : r.status === filter)) &&
      (!needle || `${r.title} ${r.queue} ${r.type} ${r.queue_tickets.map(t => t.id).join(' ')}`.toLowerCase().includes(needle)))
    const key: Record<Sort, (r: ProblemListRow) => number> = {
      reports: r => r.occurrences * 1e13 + new Date(r.last_seen).getTime() / 1e3,
      recent: r => new Date(r.last_seen).getTime(),
      priority: r => (RANK[r.priority] ?? 0) * 1e13 + r.occurrences * 1e9 + new Date(r.last_seen).getTime() / 1e3,
    }
    return [...keep].sort((a, b) => key[sort](b) - key[sort](a))
  }, [rows, filter, sort, q])

  const chip = (f: Filter, label: string) => (
    <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${filter === f ? 'bg-navy text-white ring-navy' : 'bg-white text-ink ring-line hover:ring-slate-400'}`}>
      {label} <span className={`ml-1 tabular-nums ${filter === f ? 'text-white/70' : 'text-muted'}`}>{counts[f]}</span>
    </button>
  )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chip('attention', 'Needs a fix')}{chip('open', 'Open')}{chip('resolved', 'Resolved')}{chip('all', 'All')}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by title, team or ticket" className={`${field} w-64 pl-8`} />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as Sort)} className={field} aria-label="Sort problems">
            <option value="reports">Most reported</option><option value="recent">Most recent</option><option value="priority">Highest priority</option>
          </select>
        </div>
      </div>
      {filter === 'attention' && <p className="flex items-start gap-2 text-sm text-muted"><Info size={15} className="mt-0.5 shrink-0" />
        Problems reported more than once and not yet resolved. These are the ones worth a permanent fix.</p>}

      {shown.length === 0 ? (
        <Panel><p className="py-6 text-center text-sm text-muted">
          {rows.length === 0 ? 'No problems yet. Tickets that look alike are grouped here as they arrive.'
            : filter === 'attention' ? 'Nothing is being reported repeatedly right now.' : 'No problems match this filter.'}</p></Panel>
      ) : (
        <ul className="space-y-2">
          {shown.map(r => {
            const p = prio(r.priority)
            return (
              <li key={r.problem_id}>
                <button onClick={() => onOpen(r.problem_id)}
                  className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 rounded-xl border border-line border-l-4 bg-white px-5 py-3.5 text-left transition hover:border-slate-400 hover:shadow-sm ${PRIO_STYLE[p].bar} ${r.status === 'resolved' ? 'opacity-75' : ''}`}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">#{r.problem_id}</span>
                      <span className="truncate font-semibold text-ink">{r.title}</span>
                      <ProblemStatus status={r.status} reports={r.occurrences} />
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{r.queue}</span><span>{r.type}</span><PriorityBadge p={p} />
                      <span>last reported {ago(r.last_seen)}</span>
                      <TicketChips tickets={r.queue_tickets} total={r.queue_ticket_count} onOpen={onOpenTicket} />
                    </span>
                  </span>
                  <span className="flex items-center gap-5">
                    <span className="text-right">
                      <span className="block text-2xl font-semibold leading-none tabular-nums text-ink">{r.occurrences}×</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted"><Users size={11} />{r.people || '—'} {r.people === 1 ? 'person' : 'people'}</span>
                    </span>
                    <ChevronRight size={18} className="text-muted" />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {stats && <p className="text-xs text-muted">{stats.tickets_logged} tickets logged · {stats.problems} distinct problems. Similar tickets are matched by meaning, not by wording, so a repeat in the other language counts too.</p>}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="text-right font-medium text-ink">{children}</dd></div>
}

function DetailView({ d, onBack, onOpenTicket, reload, setDetail }: {
  d: ProblemDetail; onBack: () => void; onOpenTicket: (id: string) => void; reload: () => void; setDetail: (d: ProblemDetail) => void
}) {
  const toast = useToast()
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const people = new Set(d.queue_tickets.map(t => t.email || t.requester)).size
  const resolve = async () => {
    setBusy(true)
    try {
      setDetail(await api.resolveProblem(d.problem_id, resolution.trim()))
      toast('success', `Problem #${d.problem_id} resolved`, 'Agents will see this resolution on matching tickets.'); reload()
    } catch (e) { toast('warning', 'Could not resolve', (e as Error).message) }
    setBusy(false)
  }
  const reopen = async () => {
    try { setDetail(await api.reopenProblem(d.problem_id)); reload() } catch (e) { toast('warning', 'Could not reopen', (e as Error).message) }
  }
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} />All problems</button>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-muted">#{d.problem_id}</span>
        <h2 className="text-xl font-semibold text-ink">{d.title}</h2>
        <ProblemStatus status={d.status} reports={d.occurrences} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Panel title="What is being reported">
            <p className="wrap-any whitespace-pre-wrap border-l-4 border-line pl-4 text-sm leading-relaxed text-ink"><PiiText text={d.text} /></p>
          </Panel>

          {d.status === 'resolved' ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 size={16} />Resolved{d.resolved_by ? ` by ${d.resolved_by}` : ''}{d.resolved_at ? ` · ${when(d.resolved_at)}` : ''}</div>
              <p className="mt-2 text-sm leading-relaxed text-emerald-950">{d.resolution}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-emerald-900/80">
                {d.precedent_id && <span>Saved as knowledge-base precedent <b className="font-mono">{d.precedent_id}</b></span>}
                <button onClick={reopen} className="inline-flex items-center gap-1 font-semibold underline"><RotateCcw size={12} />Reopen</button>
              </div>
            </section>
          ) : (
            <Panel title="Resolve this problem">
              <textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={3}
                placeholder="What fixed it? e.g. Restarted the Exchange connector; mail flows again."
                className="w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-coral focus:ring-1 focus:ring-coral/30" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-md text-xs text-muted">Agents then see this resolution on every new ticket that matches the problem, instead of starting from scratch.</p>
                <button onClick={resolve} disabled={busy || !resolution.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-coral px-4 py-2 text-sm font-semibold text-white hover:bg-coral-dark disabled:opacity-40">
                  {busy && <Loader2 size={14} className="animate-spin" />}Mark resolved</button>
              </div>
            </Panel>
          )}

          <Panel title={`Tickets filed under this problem (${d.queue_tickets.length || d.tickets.length})`}>
            {d.queue_tickets.length > 0 ? (
              <ul className="-my-2 divide-y divide-line">
                {d.queue_tickets.map(t => (
                  <li key={t.id}>
                    <button onClick={() => onOpenTicket(t.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-3 text-left hover:bg-canvas/60">
                      <span className="w-24 shrink-0 font-mono text-xs font-semibold text-coral">{t.id}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.subject}</span>
                      <span className="text-xs text-muted">{t.requester}</span>
                      <StatusPill s={t.status} />
                      <span className="w-24 text-right text-xs text-muted">{ago(t.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted"><tr><th className="pb-2">When</th><th>Subject</th><th>Match</th></tr></thead>
                <tbody>{d.tickets.map(x => (
                  <tr key={x.log_id} className="border-t border-line"><td className="py-2 pr-3 text-xs text-muted">{when(x.ts)}</td>
                    <td className="max-w-xs truncate pr-3">{x.subject || x.body.slice(0, 60)}</td><td className="tabular-nums">{x.similarity.toFixed(2)}</td></tr>))}</tbody>
              </table>
            )}
          </Panel>
        </div>

        <Panel title="Summary" className="h-fit">
          <dl>
            <Fact label="Reported">{d.occurrences}×</Fact>
            <Fact label="People affected">{people || '—'}</Fact>
            <Fact label="Team">{d.queue || '—'}</Fact>
            <Fact label="Type">{d.type || '—'}</Fact>
            <Fact label="Priority"><PriorityBadge p={prio(d.priority)} /></Fact>
            <Fact label="Language"><span className="uppercase">{d.language}</span></Fact>
            <Fact label="First reported">{when(d.first_seen)}</Fact>
            <Fact label="Last reported">{ago(d.last_seen)}</Fact>
          </dl>
        </Panel>
      </div>
    </div>
  )
}

function CheckView() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!q.trim()) return
    setBusy(true)
    try { setHits(await api.searchProblems(q.trim())) } catch (e) { toast('warning', 'Search failed', (e as Error).message) }
    setBusy(false)
  }
  const known = hits?.problems[0]?.same_problem ? hits.problems[0] : null
  return (
    <Panel>
      <p className="mb-3 text-sm text-muted">Before raising a new problem, check whether it is already known. This only looks things up; nothing is recorded.</p>
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="Describe the issue, e.g. Outlook stopped receiving new emails" className={`${field} flex-1`} />
        <button onClick={run} disabled={busy || !q.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-coral px-4 text-sm font-semibold text-white hover:bg-coral-dark disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}Check</button>
      </div>
      {hits && (
        <div className="mt-5 space-y-5">
          {known
            ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                Already known as problem <b>#{known.problem_id}</b>: {known.title} ({known.status}, reported {known.occurrences}×).
                {known.resolution && <div className="mt-1"><b>Resolution:</b> {known.resolution}</div>}</div>
            : <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Not a known problem yet. It is added when a ticket like this arrives.</div>}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Most related problems</h3>
            {hits.problems.length === 0 ? <p className="text-sm text-muted">None close enough.</p> : (
              <ul className="space-y-1.5">{hits.problems.map(p => (
                <li key={p.problem_id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-mono text-xs text-muted">#{p.problem_id}</span> {p.title}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">{p.similarity.toFixed(2)} · {p.occurrences}× · {p.status}</span></li>))}</ul>)}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Most related resolved tickets (knowledge base)</h3>
            <ul className="space-y-1.5">{hits.precedents.map(p => (
              <li key={p.ticket_id} className="rounded-lg border border-line px-3 py-2 text-sm">
                <span className="font-mono text-xs font-semibold text-coral">{p.ticket_id}</span>
                <span className="ml-2 text-xs text-muted tabular-nums">{p.score.toFixed(3)} · {p.language.toUpperCase()}</span>
                <div className="mt-0.5 line-clamp-2 text-ink/80">{p.subject || p.answer}</div></li>))}</ul>
          </div>
        </div>
      )}
    </Panel>
  )
}

function LogView({ logs }: { logs: LogRow[] }) {
  return (
    <Panel>
      <p className="mb-3 text-sm text-muted">Every ticket the pipeline handled and which problem it was matched to. The audit trail behind the grouping.</p>
      {logs.length === 0 ? <p className="py-6 text-center text-sm text-muted">Nothing logged yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="pb-2">When</th><th>Problem</th><th>Subject</th><th>Team</th><th>Gate</th><th className="text-right">Best match</th><th className="text-right">Time</th></tr></thead>
            <tbody>{logs.map(l => (
              <tr key={l.log_id} className="border-t border-line">
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">{when(l.ts)}</td>
                <td className="whitespace-nowrap pr-3">{l.problem_id != null ? <><span className="font-mono text-xs">#{l.problem_id}</span>{l.is_new_problem ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">new</span> : null}</> : <span className="text-muted">not grouped</span>}</td>
                <td className="max-w-[260px] truncate pr-3">{l.subject}</td><td className="whitespace-nowrap pr-3 text-xs">{l.queue}</td>
                <td className="whitespace-nowrap pr-3 text-xs">{l.status.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="text-right tabular-nums">{l.top1_similarity?.toFixed(3) ?? '—'}</td>
                <td className="text-right text-xs tabular-nums text-muted">{Math.round(l.latency_ms)} ms</td></tr>))}</tbody>
          </table>
        </div>)}
    </Panel>
  )
}

export default function Problems({ openId, setOpenId, onOpenTicket }: {
  openId: number | null; setOpenId: (id: number | null) => void; onOpenTicket: (id: string) => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('problems')
  const [stats, setStats] = useState<DbStats | null>(null)
  const [rows, setRows] = useState<ProblemListRow[]>([])
  const [detail, setDetail] = useState<ProblemDetail | null>(null)
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.problems()
      setStats(d.stats); setRows(d.problems)
      if (tab === 'log') setLogs(await api.logs(300))
    } catch (e) { toast('warning', 'Problem database unavailable', (e as Error).message) }
    setLoaded(true)
  }, [tab, toast])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (openId == null) { setDetail(null); return }
    api.problem(openId).then(setDetail).catch(e => { toast('warning', 'Could not load problem', (e as Error).message); setOpenId(null) })
  }, [openId, toast, setOpenId])

  const tabs: [Tab, string][] = [['problems', 'Problems'], ['check', 'Is it known?'], ['log', 'Activity log']]
  const attention = rows.filter(r => r.status === 'open' && r.occurrences >= 2).length
  return (
    <div className="space-y-5">
      <PageHeader title="Problems"
        sub="Recurring issues grouped across tickets, so IT can fix the cause once instead of answering the same incident again." />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Need a fix" value={loaded ? attention : '—'} hint="Open problems reported more than once" />
        <MetricCard label="Open problems" value={stats?.open_problems ?? '—'} />
        <MetricCard label="Tickets grouped" value={stats?.tickets_logged ?? '—'} hint="Tickets the pipeline has logged" />
        <MetricCard label="Resolved" value={stats?.resolved_problems ?? '—'} />
      </div>

      <div className="flex gap-1 border-b border-line">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setOpenId(null) }}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${tab === k ? 'border-coral text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
        ))}
      </div>

      {tab === 'problems' && (detail
        ? <DetailView d={detail} onBack={() => setOpenId(null)} onOpenTicket={onOpenTicket} reload={load} setDetail={setDetail} />
        : <ListView rows={rows} stats={stats} onOpen={setOpenId} onOpenTicket={onOpenTicket} />)}
      {tab === 'check' && <CheckView />}
      {tab === 'log' && <LogView logs={logs} />}
    </div>
  )
}
