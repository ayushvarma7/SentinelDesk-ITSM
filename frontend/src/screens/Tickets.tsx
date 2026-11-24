import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertOctagon, ArrowDown, ArrowUp, ChevronsUpDown, Inbox, RefreshCw, Search, ShieldAlert, X } from 'lucide-react'
import type { Priority, Ticket } from '../api'
import { LangContext, STATUS_DE, useT } from '../i18n'
import { ConfidenceBar, P_CODE, PRIO_STYLE, PriorityBadge, Skeleton, SlaPill, StatusPill, fmtDate, slaMinutesLeft, useNow } from '../ui'
import { MetricCard, MultiSelect, PageHeader } from '../components/kit'
import TicketDetail from './TicketDetail'

type SortKey = 'id' | 'subject' | 'priority' | 'created_at' | 'sla_due' | 'status' | 'queue' | 'type' | 'confidence'
type Quick = 'all' | 'needsMe' | 'auto' | 'major' | 'sla'
const PRIO_RANK = { high: 0, medium: 1, low: 2 } as const
const DONE = ['Closed', 'Auto-Resolved']
const STATUSES = ['New', 'In Progress', 'Auto-Resolved', 'Escalated', 'Closed']
const isHot = (tag: string) => /injection|credential|destructive|^legal$|major-incident/.test(tag)
const isLangTag = (tag: string) => tag === 'en' || tag === 'de'

/** Burst groups: each active ticket plus the earlier tickets the detector matched it against. */
export function burstGroups(tickets: Ticket[]) {
  const byLive = new Map(tickets.filter(t => t.triage.burst?.live_id).map(t => [t.triage.burst.live_id!, t]))
  return tickets.filter(t => t.triage.burst?.active).map(a => {
    const members = [a, ...(a.triage.burst.related ?? []).map(id => byLive.get(id)).filter((x): x is Ticket => !!x)]
    return { key: a.id, at: a.created_at, members: members.sort((x, y) => x.created_at.localeCompare(y.created_at)) }
  }).sort((x, y) => y.at.localeCompare(x.at))
}

export default function Tickets({ tickets, reload, onUpdate, loading, openId, setOpenId, replay }: {
  tickets: Ticket[]; reload: () => void; onUpdate: (t: Ticket) => void; loading: boolean
  openId: string | null; setOpenId: (id: string | null) => void; replay: number
}) {
  const t = useT()
  const { lang } = useContext(LangContext)
  const now = useNow(1000)
  const [q, setQ] = useState('')
  const [prioF, setPrioF] = useState<string[]>([])
  const [statusF, setStatusF] = useState<string[]>([])
  const [deptF, setDeptF] = useState<string[]>([])
  const [quick, setQuick] = useState<Quick>('all')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'created_at', dir: -1 })
  const [sel, setSel] = useState(0)
  const [ack, setAck] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ id: string; left: number; top: number; above: boolean } | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const searchRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => burstGroups(tickets), [tickets])
  const majorIds = useMemo(() => new Set(groups.flatMap(g => g.members.map(m => m.id))), [groups])
  const banner = groups.find(g => now - new Date(g.at).getTime() < 30 * 60e3 && !ack.has(g.key))
  const depts = useMemo(() => [...new Set(tickets.map(x => x.queue))].sort(), [tickets])

  const open = tickets.filter(x => !DONE.includes(x.status))
  const kpi = {
    open: open.length,
    escalated: open.filter(x => x.status === 'Escalated').length,
    p1: open.filter(x => x.priority === 'high').length,
  }

  const quickTest: Record<Quick, (x: Ticket) => boolean> = {
    all: () => true,
    needsMe: x => (x.escalated || x.priority === 'high') && !DONE.includes(x.status),
    auto: x => x.status === 'Auto-Resolved',
    major: x => majorIds.has(x.id),
    sla: x => !DONE.includes(x.status) && slaMinutesLeft(x.sla_due, now) < 60,
  }
  const counts = Object.fromEntries((Object.keys(quickTest) as Quick[]).map(k => [k, tickets.filter(quickTest[k]).length])) as Record<Quick, number>

  const slaTick = quick === 'sla' ? now : 0   // only the SLA chip depends on the clock
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = tickets.filter(x => quickTest[quick](x) &&
      (!prioF.length || prioF.includes(x.priority)) && (!statusF.length || statusF.includes(x.status)) &&
      (!deptF.length || deptF.includes(x.queue)) &&
      (!needle || [x.id, x.subject, x.summary, x.queue, x.assigned_to, x.requester.name, ...x.tags].join(' ').toLowerCase().includes(needle)))
    const val = (x: Ticket): string | number => sort.k === 'priority' ? PRIO_RANK[x.priority] : (x[sort.k] as string | number)
    return [...out].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir)
  }, [tickets, q, prioF, statusF, deptF, quick, sort, majorIds, slaTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(s => Math.min(s, Math.max(0, rows.length - 1))) }, [rows.length])

  const showPreview = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const above = r.bottom + 150 > window.innerHeight
    setPreview({ id, left: Math.min(r.left + 120, window.innerWidth - 400), top: above ? r.top - 6 : r.bottom + 6, above })
  }

  // Keyboard: ↑/↓ move, Enter opens, / focuses search. Esc (back) is handled in App.
  useEffect(() => {
    if (openId) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
      if (!rows.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = Math.max(0, Math.min(rows.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)))
        setSel(n)
        const el = rowRefs.current.get(rows[n].id)
        if (el) { el.scrollIntoView({ block: 'nearest' }); showPreview(rows[n].id, el) }
      } else if (e.key === 'Enter') { setPreview(null); setOpenId(rows[sel]?.id ?? null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, sel, openId, setOpenId])

  const openTicket = tickets.find(x => x.id === openId)
  if (openTicket) return <TicketDetail ticket={openTicket} onBack={() => setOpenId(null)} onUpdate={onUpdate} replay={replay} />

  const Th = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th className={`sticky top-0 z-10 border-b border-line bg-[#FAFBFC] px-2.5 py-2.5 text-left font-normal ${className}`}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort(s => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.k === k ? (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} className="opacity-30" />}
      </button>
    </th>
  )
  const chips: [Quick, string, string][] = [
    ['all', t('qAll'), 'bg-slate-500'], ['needsMe', t('qNeedsMe'), 'bg-coral'], ['auto', t('qAuto'), 'bg-teal-600'],
    ['major', t('qMajor'), 'bg-red-600'], ['sla', t('qSla'), 'bg-amber-400'],
  ]
  const pv = preview && tickets.find(x => x.id === preview.id)
  const clearAll = () => { setQ(''); setPrioF([]); setStatusF([]); setDeptF([]); setQuick('all') }
  const statusLabel = (s: string) => (lang === 'de' ? STATUS_DE[s] ?? s : s)

  return (
    <div className="space-y-4">
      {banner && (
        <div className="banner-in flex items-center gap-4 rounded-xl bg-coral px-5 py-3.5 text-white shadow-lg shadow-coral/20">
          <span className="pulse-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15"><AlertOctagon size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{t('majorIncident')}: {banner.members[banner.members.length - 1].queue}</div>
            <div className="text-sm text-white/80">{banner.members.length} {t('majorIncidentSub')}</div>
          </div>
          <div className="hidden flex-wrap gap-1.5 lg:flex">
            {banner.members.slice(-4).map(b => (
              <button key={b.id} onClick={() => setOpenId(b.id)} className="rounded-md bg-white/15 px-2 py-1 font-mono text-xs hover:bg-white/25">{b.id}</button>
            ))}
          </div>
          <button onClick={() => setQuick('major')} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-coral hover:bg-red-50">View all</button>
          <button onClick={() => setAck(a => new Set(a).add(banner.key))} className="rounded-md p-1 text-white/80 hover:bg-white/15" aria-label="acknowledge" title="Acknowledge"><X size={16} /></button>
        </div>
      )}

      <PageHeader title={t('organisation')} sub={t('orgSub')} right={
        <button onClick={reload} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink hover:border-slate-400">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{t('refresh')}
        </button>
      } />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label={t('openTickets')} value={loading && !tickets.length ? <Skeleton className="mt-2 h-8 w-16" /> : kpi.open} />
        <MetricCard label={t('escalatedK')} value={kpi.escalated} active={statusF.length === 1 && statusF[0] === 'Escalated'}
          onClick={() => setStatusF(s => (s.length === 1 && s[0] === 'Escalated' ? [] : ['Escalated']))} hint="Filter to escalated" />
        <MetricCard label={t('p1Open')} value={kpi.p1} active={prioF.length === 1 && prioF[0] === 'high'}
          onClick={() => setPrioF(s => (s.length === 1 && s[0] === 'high' ? [] : ['high']))} hint="Filter to P1" />
        <MetricCard label={t('kbK')} value="—" hint={t('notExposed')} />
      </div>

      <div className="grid gap-3 md:grid-cols-[3fr_1fr_1.4fr_2fr]">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder={t('searchInc')}
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-8 text-sm text-ink outline-none placeholder:text-muted hover:border-slate-400 focus:border-coral focus:ring-1 focus:ring-coral/30" />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1 font-mono text-[10px] text-muted">/</kbd>
        </div>
        <MultiSelect placeholder={t('pCol')} options={['high', 'medium', 'low']} value={prioF} onChange={setPrioF}
          render={o => P_CODE[o as Priority]} />
        <MultiSelect placeholder={t('status')} options={STATUSES} value={statusF} onChange={setStatusF} render={statusLabel} />
        <MultiSelect placeholder={t('deptCol')} options={depts} value={deptF} onChange={setDeptF} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map(([k, label, dot]) => (
          <button key={k} onClick={() => setQuick(k)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${quick === k ? 'border-navy bg-navy text-white' : 'border-line bg-white text-ink hover:border-slate-400'}`}>
            <span className={`h-2 w-2 rounded-full ${dot}`} />{label}
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${quick === k ? 'bg-white/20' : 'bg-canvas text-muted'}`}>{counts[k]}</span>
          </button>
        ))}
        <span className="ml-auto hidden text-xs text-muted xl:inline">
          {rows.length} {t('results')} · <kbd className="rounded border border-line bg-white px-1 font-mono">↑</kbd> <kbd className="rounded border border-line bg-white px-1 font-mono">↓</kbd> move · <kbd className="rounded border border-line bg-white px-1 font-mono">Enter</kbd> open · <kbd className="rounded border border-line bg-white px-1 font-mono">Esc</kbd> back
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="max-h-[calc(100vh-330px)] min-h-[330px] overflow-auto" onScroll={() => setPreview(null)}>
          <table className="w-full min-w-[1100px] text-sm text-ink">
            <thead className="text-[13px] text-muted">
              <tr>
                <Th k="id" label={t('incCol')} className="pl-4" />
                <Th k="subject" label={t('summary')} />
                <Th k="priority" label={t('pCol')} />
                <Th k="created_at" label={t('date')} />
                <Th k="sla_due" label={t('slaCol')} />
                <Th k="status" label={t('status')} />
                <Th k="queue" label={t('deptCol')} />
                <Th k="type" label={t('tagType')} />
                <Th k="confidence" label={t('confidence')} className="pr-4" />
              </tr>
            </thead>
            <tbody>
              {loading && tickets.length === 0 && Array.from({ length: 9 }).map((_, i) => (
                <tr key={`sk${i}`} className="border-b border-line">
                  {[70, 220, 70, 90, 60, 80, 150, 110, 70].map((w, k) => (
                    <td key={k} className="px-2.5 py-3.5"><Skeleton className="h-3.5" /><div style={{ width: w }} /></td>
                  ))}
                </tr>
              ))}
              {rows.map((x, i) => {
                const topics = x.tags.filter(tag => !isLangTag(tag)).sort((a, b) => Number(isHot(b)) - Number(isHot(a)))
                return (
                  <tr key={x.id} ref={el => { if (el) rowRefs.current.set(x.id, el); else rowRefs.current.delete(x.id) }}
                    onClick={() => { setPreview(null); setOpenId(x.id) }}
                    onMouseEnter={e => { setSel(i); const el = e.currentTarget; clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => showPreview(x.id, el), 280) }}
                    onMouseLeave={() => { clearTimeout(hoverTimer.current); setPreview(null) }}
                    className={`cursor-pointer border-b border-l-4 border-b-line transition-colors ${PRIO_STYLE[x.priority]?.row} ${PRIO_STYLE[x.priority]?.bar} ${i === sel ? 'outline-2 -outline-offset-2 outline-coral/50' : ''}`}>
                    <td className="whitespace-nowrap px-2.5 py-2.5 pl-4 font-mono text-[12.5px] font-medium">{x.id}</td>
                    <td className="max-w-[230px] px-2.5 py-2.5 min-[1360px]:max-w-[300px]">
                      <div className="truncate">{x.subject}</div>
                      <div className="truncate text-xs text-muted">{x.requester.name} · {x.language.toUpperCase()}</div>
                    </td>
                    <td className="px-2.5 py-2.5"><PriorityBadge p={x.priority} code /></td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-xs text-muted">{fmtDate(x.created_at, lang)}</td>
                    <td className="px-2.5 py-2.5"><SlaPill due={x.sla_due} done={DONE.includes(x.status)} now={now} /></td>
                    <td className="px-2.5 py-2.5"><StatusPill s={x.status} /></td>
                    <td className="max-w-[175px] px-2.5 py-2.5 min-[1360px]:max-w-[210px]" title={`${x.queue} · ${x.assigned_to}`}>
                      <div className="truncate">{x.queue}</div>
                      <div className="truncate text-xs text-muted">{x.assigned_to}</div>
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div className="flex max-w-[150px] items-center gap-1 overflow-hidden" title={x.tags.join(', ')}>
                        <span className="shrink-0 text-[13px]">{x.type}</span>
                        {topics[0] && <span className={`truncate whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${isHot(topics[0]) ? 'bg-coral text-white' : 'bg-canvas text-muted ring-1 ring-line'}`}>{topics[0]}</span>}
                        {topics.length > 1 && <span className="shrink-0 text-[10px] text-muted">+{topics.length - 1}</span>}
                      </div>
                    </td>
                    <td className="px-2.5 py-2.5 pr-4"><ConfidenceBar v={x.confidence} /></td>
                  </tr>
                )
              })}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9}>
                  <div className="flex flex-col items-center gap-2 py-14 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas text-muted"><Inbox size={24} /></span>
                    <div className="font-semibold">{tickets.length ? 'No tickets match these filters' : 'No tickets yet'}</div>
                    <div className="text-sm text-muted">{tickets.length ? 'Try another quick filter or clear the search.' : 'New tickets from the customer portal appear here.'}</div>
                    {tickets.length > 0 && <button onClick={clearAll} className="mt-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium hover:border-slate-400">Clear filters</button>}
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pv && preview && (
        <div className="pointer-events-none fixed z-40 w-[380px] rounded-xl border border-line bg-white p-4 shadow-2xl"
          style={{ left: preview.left, top: preview.top, transform: preview.above ? 'translateY(-100%)' : undefined }}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-coral">{pv.id}</span>
            <PriorityBadge p={pv.priority} code /><StatusPill s={pv.status} />
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-snug text-ink">{pv.summary}</p>
          {pv.triage.escalation_reasons[0] ? (
            <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-[#FCEBEC] px-2.5 py-2 text-xs text-[#7A1020]">
              <ShieldAlert size={14} className="mt-px shrink-0" />
              <span>{pv.triage.escalation_reasons[0]}{pv.triage.escalation_reasons.length > 1 && <b> · +{pv.triage.escalation_reasons.length - 1} more</b>}</span>
            </div>
          ) : <div className="mt-2.5 rounded-lg bg-[#E7F5F2] px-2.5 py-2 text-xs text-[#0B4F4A]">Auto-handled: grounded reply sent with {pv.triage.cited_ticket_ids.length} citation(s)</div>}
          <div className="mt-2 text-[11px] text-muted">Enter or click to open</div>
        </div>
      )}
    </div>
  )
}
