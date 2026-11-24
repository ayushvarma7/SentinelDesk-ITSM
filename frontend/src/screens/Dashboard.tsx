// Operations dashboard.
// Totals/recall come from GET /metrics; everything else is computed client-side from GET /tickets.
import { useMemo, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Info } from 'lucide-react'
import type { Metrics, Ticket } from '../api'
import { useT } from '../i18n'
import { Skeleton } from '../ui'
import { MetricCard, PageHeader, StatStrip } from '../components/kit'

// Colour scales: priority = NU red / amber / slate grey; type = a four-colour categorical set.
const PRI = ['high', 'medium', 'low'] as const
const PRI_COLOR: Record<string, string> = { high: '#C8102E', medium: '#E2A33B', low: '#9AA6B5' }
const TYPES = ['Change', 'Incident', 'Problem', 'Request'] as const
const TYPE_COLOR: Record<string, string> = { Change: '#0068C9', Incident: '#83C9FF', Problem: '#FF2B2B', Request: '#FFABAB' }
const AXIS = { fontSize: 11, fill: '#5A6A7E' }
const GRID = '#E8ECF1'

const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`)
const ms = (v: number | null) => (v == null ? '—' : `${Math.round(v).toLocaleString()} ms`)
function quantile(xs: number[], q: number) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}
/** "reds" sequential: light → deep NU red, by share of the max cell. */
function reds(t: number) {
  const a = [254, 229, 217], b = [165, 15, 21]
  const k = Math.max(0, Math.min(1, t))
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`
}

const f1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3))
const holdoutHint = (m: Metrics | null) =>
  m?.model?.n_holdout ? `Holdout, ${m.model.n_holdout.toLocaleString()} unseen tickets (scripts/evaluate.py)` : 'Run scripts/evaluate.py'

/** Model numbers from GET /metrics: language, gate tiers, retrieval, English vs German, problem database. */
function ModelExtras({ m }: { m: Metrics }) {
  const g = m.model?.gate ?? {}
  const sh = g.status_share
  const per = m.model?.per_language ?? {}
  const db = m.problem_db
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Language Macro-F1" value={f1(m.model?.macro_f1.language)} hint="Detected from the raw text" />
        <MetricCard label="Urgent incidents flagged high" value={pct(m.model?.high_incident_recall_classifier)} hint="Classifier only, holdout" />
        <MetricCard label="Urgent incidents kept from auto-draft" value={pct(g.high_incident_escalated_by_gate)} hint="Full gate, holdout sample" />
        <MetricCard label="Median latency, drafted" value={ms(g.latency_ms_p50_drafted ?? null)} />
      </div>
      {sh && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="Auto-draft ready" value={pct(sh.AUTO_DRAFT_READY, 0)} />
          <MetricCard label="Human review" value={pct(sh.HUMAN_REVIEW, 0)} />
          <MetricCard label="Escalate to on-call" value={pct(sh.ESCALATE_ONCALL, 0)} />
          <MetricCard label="Operator gets a draft" value={pct(g.draft_share, 0)} hint="Auto-draft + review tickets with only soft reasons" />
        </div>)}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <MetricCard label="Top precedent, same team" value={pct(g.top1_same_queue, 0)} />
        <MetricCard label="Median top-1 cosine" value={g.median_top1_similarity?.toFixed(3) ?? '—'} />
        <MetricCard label="Other-language precedent (unaided)" value={pct(g.cross_lingual_share_unaided, 0)} />
      </div>
      {Object.keys(per).length > 0 && (
        <Panel>
          <ChartTitle>English vs German (Macro-F1, holdout)</ChartTitle>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th>Language</th><th>Tickets</th><th>Type</th><th>Queue</th><th>Priority</th></tr></thead>
            <tbody>{Object.entries(per).map(([lg, v]) => (
              <tr key={lg} className="border-t border-slate-100"><td>{lg === 'de' ? 'German' : 'English'}</td><td>{v.n.toLocaleString()}</td>
                <td>{v.type.toFixed(3)}</td><td>{v.queue.toFixed(3)}</td><td>{v.priority.toFixed(3)}</td></tr>))}</tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">German labels are less consistent: a German ticket's nearest German neighbour shares its queue label only 56% of the time (English 77%).</p>
        </Panel>)}
      {db && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <MetricCard label="Tickets logged" value={db.tickets_logged} />
          <MetricCard label="Distinct problems" value={db.problems} />
          <MetricCard label="Recurring problems" value={db.recurring_problems} />
          <MetricCard label="Open problems" value={db.open_problems} />
          <MetricCard label="Resolved problems" value={db.resolved_problems} />
        </div>)}
    </div>
  )
}

function ChartTitle({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[13px] font-semibold text-ink">{children}</div>
}
function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-white p-5">{children}</div>
}
function TipBox({ active, payload, label, total }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; total?: boolean }) {
  if (!active || !payload?.length) return null
  const sum = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 text-ink">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}
          <span className="ml-auto pl-4 font-medium tabular-nums">{p.value}{total && sum ? ` (${Math.round(p.value / sum * 100)}%)` : ''}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard({ m, tickets }: { m: Metrics | null; tickets: Ticket[] }) {
  const t = useT()

  const d = useMemo(() => {
    const n = tickets.length
    const high = tickets.filter(x => x.priority === 'high').length
    const hiInc = tickets.filter(x => x.priority === 'high' && x.type === 'Incident').length
    const de = tickets.filter(x => x.language === 'de').length

    const qMap = new Map<string, Record<string, number>>()
    for (const x of tickets) {
      const r = qMap.get(x.queue) ?? { high: 0, medium: 0, low: 0 }
      r[x.priority] = (r[x.priority] ?? 0) + 1
      qMap.set(x.queue, r)
    }
    const volTeam = [...qMap].map(([queue, r]) => ({ queue, ...r, total: r.high + r.medium + r.low })).sort((a, b) => b.total - a.total)

    const cells = TYPES.flatMap(ty => PRI.map(p => ({ ty, p, n: tickets.filter(x => x.type === ty && x.priority === p).length })))
    const maxCell = Math.max(1, ...cells.map(c => c.n))

    const typeLang = (['de', 'en'] as const).map(l => ({
      language: l, ...Object.fromEntries(TYPES.map(ty => [ty, tickets.filter(x => x.language === l && x.type === ty).length])),
    }))

    const tagCount = new Map<string, number>()
    for (const x of tickets) for (const tag of x.tags) if (tag !== 'en' && tag !== 'de') tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
    const topTags = [...tagCount].map(([tag, c]) => ({ tag, tickets: c })).sort((a, b) => b.tickets - a.tickets).slice(0, 15)

    const lat = tickets.map(x => x.triage.latency_ms?.total).filter((v): v is number => typeof v === 'number')
    return {
      n, high: n ? high / n : null, hiInc: n ? hiInc / n : null, de: n ? de / n : null,
      volTeam, cells, maxCell, typeLang, topTags,
      p50: quantile(lat, 0.5), p95: quantile(lat, 0.95),
    }
  }, [tickets])

  if (!m && !tickets.length) return (
    <div className="space-y-5">
      <Skeleton className="h-9 w-72" /><Skeleton className="h-5 w-[28rem]" />
      <Skeleton className="h-[106px]" />
      <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map(i => <div key={i} className="rounded-xl border border-line bg-white p-5"><Skeleton className="h-[320px]" /></div>)}</div>
    </div>
  )

  const total = m?.total ?? d.n
  return (
    <div className="space-y-6">
      <PageHeader title={t('dashTitle')} sub={t('dashSub')} />

      <StatStrip items={[
        { n: total, label: t('dTickets') },
        { n: d.high == null ? null : Math.round(d.high * 100), suffix: '%', label: t('dHigh') },
        { n: d.hiInc == null ? null : Math.round(d.hiInc * 100), suffix: '%', label: t('dHighInc') },
        { n: d.de == null ? null : Math.round(d.de * 100), suffix: '%', label: t('dGerman') },
      ]} />

      <h2 className="text-[1.6rem] font-semibold tracking-[-0.01em] text-ink">{t('workGoes')}</h2>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <ChartTitle>{t('volTeam')}</ChartTitle>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={d.volTeam} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 4 }} barCategoryGap={4}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false}
                label={{ value: t('ticketsAxis'), position: 'insideBottom', offset: -2, fill: '#5A6A7E', fontSize: 11 }} />
              <YAxis type="category" dataKey="queue" width={150} interval={0} tick={AXIS} axisLine={false} tickLine={false}
                tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 19) + '…' : v)} />
              <Tooltip cursor={{ fill: '#F3F5F8' }} content={<TipBox total />} />
              <Legend layout="vertical" align="right" verticalAlign="top" iconType="square" iconSize={10}
                wrapperStyle={{ fontSize: 12, paddingLeft: 12 }} itemSorter={i => PRI.indexOf(String(i.value) as typeof PRI[number])}
                formatter={(v: string) => <span className="text-ink">{v}</span>} />
              {PRI.map((p, i) => (
                <Bar key={p} dataKey={p} name={p} stackId="q" fill={PRI_COLOR[p]} stroke="#fff" strokeWidth={1}
                  radius={i === PRI.length - 1 ? [0, 4, 4, 0] : 0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel>
          <ChartTitle>{t('typePrio')}</ChartTitle>
          <div className="grid h-[340px] grid-cols-[80px_repeat(3,minmax(0,1fr))] grid-rows-[repeat(4,minmax(0,1fr))_28px] gap-0.5">
            {TYPES.map(ty => (
              <div key={ty} className="contents">
                <div className="flex items-center justify-end pr-3 text-[11px] text-muted">{ty}</div>
                {PRI.map(p => {
                  const c = d.cells.find(x => x.ty === ty && x.p === p)!
                  const share = d.n ? c.n / d.n : 0
                  const k = c.n / d.maxCell
                  return (
                    <div key={p} title={`${ty} · ${p}: ${c.n} tickets (${(share * 100).toFixed(1)}%)`}
                      className="flex items-center justify-center text-[13px] tabular-nums transition hover:ring-2 hover:ring-navy/40"
                      style={{ background: reds(k), color: k > 0.55 ? '#fff' : '#1C2735' }}>
                      {Math.round(share * 100)}%
                    </div>
                  )
                })}
              </div>
            ))}
            <div />
            {PRI.map(p => <div key={p} className="flex items-center justify-center text-[11px] text-muted">{p}</div>)}
          </div>
          <div className="mt-1 text-center text-[11px] text-muted">{t('priorityL')}</div>
        </Panel>

        <Panel>
          <ChartTitle>{t('typeLang')}</ChartTitle>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d.typeLang} stackOffset="expand" margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="language" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44}
                label={{ value: t('share'), angle: -90, position: 'insideLeft', fill: '#5A6A7E', fontSize: 11 }} />
              <Tooltip cursor={{ fill: '#F3F5F8' }} content={<TipBox total />} />
              <Legend layout="vertical" align="right" verticalAlign="top" iconType="square" iconSize={10}
                wrapperStyle={{ fontSize: 12, paddingLeft: 12 }} itemSorter={i => TYPES.indexOf(String(i.value) as typeof TYPES[number])}
                formatter={(v: string) => <span className="text-ink">{v}</span>} />
              {TYPES.map(ty => <Bar key={ty} dataKey={ty} stackId="l" fill={TYPE_COLOR[ty]} stroke="#fff" strokeWidth={1} />)}
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel>
          <ChartTitle>{t('topTags')}</ChartTitle>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={d.topTags} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 4 }} barCategoryGap={3}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="tag" width={130} interval={0} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#F3F5F8' }} content={<TipBox />} />
              <Bar dataKey="tickets" name={t('ticketsAxis')} fill="#C8102E" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <h2 className="text-[1.6rem] font-semibold tracking-[-0.01em] text-ink">{t('modelPerf')}</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Type Macro-F1" value={f1(m?.model?.macro_f1.type)} hint={holdoutHint(m)} />
        <MetricCard label="Queue Macro-F1" value={f1(m?.model?.macro_f1.queue)} hint={holdoutHint(m)} />
        <MetricCard label="Priority Macro-F1" value={f1(m?.model?.macro_f1.priority)} hint={holdoutHint(m)} />
        <MetricCard label={t('hpRecall')} value={pct(m?.kpi.high_priority_incident_recall)}
          hint="Of the truly urgent incidents, how many we flagged (holdout, predicted high + Incident). From GET /metrics." />
        <MetricCard label={t('latP95')} value={ms(d.p95)} hint="Computed from the tickets' latency_ms.total" />
      </div>
      {m?.model ? <ModelExtras m={m} /> : (
        <div className="flex items-start gap-2 rounded-lg bg-[#E8F0FE] px-4 py-3 text-sm text-[#1D4ED8]">
          <Info size={16} className="mt-0.5 shrink-0" />{t('noConfusion')}
        </div>)}

      <h2 className="text-[1.6rem] font-semibold tracking-[-0.01em] text-ink">{t('liveOps')}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label={t('escOnCall')} value={pct(m?.escalation_rate ?? null, 0)} />
        <MetricCard label={t('medLat')} value={ms(d.p50)} />
        <MetricCard label={t('p95Lat')} value={ms(d.p95)} />
        <MetricCard label={t('autoResolved')} value={m ? `${m.auto_resolved} / ${m.total}` : '—'} />
      </div>
    </div>
  )
}
