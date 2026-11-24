// Automation rules: the organisation's routing policy (editable) and the escalation gate's policy (read-only,
// with the validation sweep that chose it). API: GET/PUT /rules, POST /rules/reset, POST /rules/test, GET /gate/policy.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { ArrowDown, ArrowUp, FlaskConical, Info, Loader2, Pencil, Plus, RotateCcw, Save, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { api, type GatePolicy, type Priority, type Rule, type RulesState, type RuleTest, type SweepPoint } from '../api'
import { MultiSelect, PageHeader } from '../components/kit'
import { PriorityBadge } from '../ui'
import { useToast } from '../toast'

const TYPES = ['Incident', 'Request', 'Problem', 'Change']
const PRIOS = ['high', 'medium', 'low']
const LANGS = ['en', 'de']
const MODEL_QUEUES = ['Billing and Payments', 'Customer Service', 'General Inquiry', 'Human Resources', 'IT Support',
  'Product Support', 'Returns and Exchanges', 'Sales and Pre-Sales', 'Service Outages and Maintenance', 'Technical Support']
const STATUS_TEXT = { AUTO_DRAFT_READY: 'Auto-draft ready', HUMAN_REVIEW: 'Human review', ESCALATE_ONCALL: 'Escalate to on-call' }
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
const input = 'h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-coral focus:ring-1 focus:ring-coral/30'

function Panel({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Chip({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'coral' | 'navy' }) {
  const cls = { slate: 'bg-canvas text-ink ring-line', coral: 'bg-red-50 text-coral ring-red-200', navy: 'bg-navy text-white ring-navy' }[tone]
  return <span className={`inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-xs ring-1 ${cls}`}><span className="truncate">{children}</span></span>
}

function conditions(r: Rule): ReactNode[] {
  const m = r.match, out: ReactNode[] = []
  if (m.keywords.length) out.push(<Chip key="k">text contains: {m.keywords.slice(0, 4).join(', ')}{m.keywords.length > 4 ? ` +${m.keywords.length - 4}` : ''}</Chip>)
  if (m.queue.length) out.push(<Chip key="q">model queue: {m.queue.join(' or ')}</Chip>)
  if (m.type.length) out.push(<Chip key="t">type: {m.type.join(' or ')}</Chip>)
  if (m.priority.length) out.push(<Chip key="p">priority: {m.priority.join(' or ')}</Chip>)
  if (m.language.length) out.push(<Chip key="l">language: {m.language.map(x => x.toUpperCase()).join(' or ')}</Chip>)
  return out
}

function actions(r: Rule): ReactNode[] {
  const a = r.action, out: ReactNode[] = []
  if (a.group) out.push(<Chip key="g" tone="navy">assign to {a.group}</Chip>)
  if (a.raise_priority) out.push(<Chip key="p" tone="coral">raise priority to {a.raise_priority}</Chip>)
  if (a.assignee) out.push(<Chip key="a" tone="navy">assignee: {a.assignee}</Chip>)
  return out
}

function newRule(n: number): Rule {
  return { id: `rule-${Date.now()}`, name: `New rule ${n}`, enabled: true, note: '',
    match: { keywords: [], queue: [], type: [], priority: [], language: [] },
    action: { group: '', raise_priority: '', assignee: '' } }
}

function RuleEditor({ rule, groups, assignees, onChange, onDone }: {
  rule: Rule; groups: string[]; assignees: string[]; onChange: (r: Rule) => void; onDone: () => void
}) {
  const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch })
  const setM = (k: keyof Rule['match'], v: string[]) => onChange({ ...rule, match: { ...rule.match, [k]: v } })
  const setA = (patch: Partial<Rule['action']>) => onChange({ ...rule, action: { ...rule.action, ...patch } })
  const [kw, setKw] = useState(rule.match.keywords.join(', '))
  const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'
  return (
    <div className="mt-3 grid gap-4 rounded-lg border border-line bg-canvas p-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="text-sm font-semibold text-ink">When a new ticket…</div>
        <div><label className={label}>Rule name</label><input className={input} value={rule.name} maxLength={120} onChange={e => set({ name: e.target.value })} /></div>
        <div>
          <label className={label}>Text contains any of (comma-separated, EN or DE)</label>
          <input className={input} value={kw} placeholder="e.g. eduroam, wifi, wlan"
            onChange={e => { setKw(e.target.value); setM('keywords', e.target.value.split(',').map(x => x.trim()).filter(Boolean)) }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Model predicted queue</label><MultiSelect placeholder="any queue" options={MODEL_QUEUES} value={rule.match.queue} onChange={v => setM('queue', v)} /></div>
          <div><label className={label}>Type</label><MultiSelect placeholder="any type" options={TYPES} value={rule.match.type} onChange={v => setM('type', v)} /></div>
          <div><label className={label}>Priority</label><MultiSelect placeholder="any priority" options={PRIOS} value={rule.match.priority} onChange={v => setM('priority', v)} /></div>
          <div><label className={label}>Language</label><MultiSelect placeholder="any language" options={LANGS} value={rule.match.language} onChange={v => setM('language', v)} render={x => x.toUpperCase()} /></div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="text-sm font-semibold text-ink">…then</div>
        <div>
          <label className={label}>Assign to group (pick one or type your own)</label>
          <input className={input} list="sd-groups" value={rule.action.group} maxLength={80} placeholder="keep the model's queue"
            onChange={e => setA({ group: e.target.value })} />
          <datalist id="sd-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Raise priority to</label>
            <select className={input} value={rule.action.raise_priority} onChange={e => setA({ raise_priority: e.target.value as '' | Priority })}>
              <option value="">don't change</option><option value="medium">medium</option><option value="high">high</option>
            </select>
          </div>
          <div>
            <label className={label}>Assignee</label>
            <input className={input} list="sd-agents" value={rule.action.assignee} maxLength={80} placeholder="none"
              onChange={e => setA({ assignee: e.target.value })} />
            <datalist id="sd-agents">{assignees.map(a => <option key={a} value={a} />)}</datalist>
          </div>
        </div>
        <div><label className={label}>Note for other admins</label><input className={input} value={rule.note} maxLength={300} onChange={e => set({ note: e.target.value })} /></div>
        <div className="flex justify-end"><button onClick={onDone} className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-2">Done</button></div>
      </div>
    </div>
  )
}

function TestBox({ rules }: { rules: Rule[] }) {
  const toast = useToast()
  const [subject, setSubject] = useState('Eduroam keeps disconnecting in Snell Library')
  const [body, setBody] = useState('My laptop drops off the wifi every few minutes on the second floor since this morning.')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<RuleTest | null>(null)
  const run = async () => {
    setBusy(true)
    try { setRes(await api.testRules(subject, body, rules)) }
    catch (e) { toast('warning', 'Test failed', (e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <Panel title="Test a ticket" sub="Runs the real triage on this text (nothing is stored) and applies your current edits, saved or not.">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <input className={input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)" />
          <textarea className={`${input} h-24 py-2`} value={body} onChange={e => setBody(e.target.value)} placeholder="Ticket body" />
          <button onClick={run} disabled={busy || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-coral px-3 py-2 text-sm font-semibold text-white hover:bg-coral-dark disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />}Test routing
          </button>
        </div>
        <div className="rounded-lg border border-line bg-canvas p-4 text-sm">
          {!res ? <p className="text-muted">The result shows the model's prediction, which rule fired, and where the ticket ends up.</p> : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted">Model predicted</dt>
              <dd>{res.predicted.queue} · {res.predicted.type} · <PriorityBadge p={res.predicted.priority} /> · {res.predicted.language.toUpperCase()}</dd>
              <dt className="text-muted">Safety gate</dt><dd className="font-medium">{STATUS_TEXT[res.gate_status] ?? res.gate_status}</dd>
              <dt className="text-muted">Rule fired</dt><dd className="font-medium">{res.rule ? res.rule.name : <span className="text-muted">none: the model's queue is kept</span>}</dd>
              <dt className="text-muted">Assigned to</dt><dd className="text-base font-semibold text-ink">{res.group} <span className="ml-1 align-middle"><PriorityBadge p={res.priority} /></span></dd>
            </dl>
          )}
        </div>
      </div>
    </Panel>
  )
}

function SweepTooltip({ active, payload }: { active?: boolean; payload?: { payload: SweepPoint & { kind?: string } }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      {p.kind && <div className="mb-1 font-semibold text-ink">{p.kind}</div>}
      <div>Auto-drafted: <b>{pct(p.auto_share)}</b></div>
      <div>High-priority Incidents escalated: <b>{pct(p.high_incident_escalated)}</b></div>
      <div>Routing accuracy on auto-drafts: <b>{p.auto_queue_accuracy.toFixed(3)}</b></div>
      <div className="mt-1 text-muted">floors: type {p.type} · queue {p.queue} · priority {p.priority} · critical {p.critical ?? 'off'}</div>
    </div>
  )
}

type ShapeProps = { cx?: number; cy?: number }
function Star({ cx = 0, cy = 0 }: ShapeProps) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 5 : 12, a = -Math.PI / 2 + (i * Math.PI) / 5
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
  }).join(' ')
  return <g><polygon points={pts} fill="#E2A33B" stroke="#0E1A2B" strokeWidth={1.5} />
    <text x={cx + 15} y={cy + 4} fontSize={12} fontWeight={600} fill="#0E1A2B">Live setting</text></g>
}
function Diamond({ cx = 0, cy = 0 }: ShapeProps) {
  return <g><polygon points={`${cx},${cy - 8} ${cx + 8},${cy} ${cx},${cy + 8} ${cx - 8},${cy}`} fill="#0E1A2B" stroke="#fff" strokeWidth={1.5} />
    <text x={cx - 12} y={cy - 12} fontSize={12} fontWeight={600} fill="#0E1A2B" textAnchor="middle">Previous</text></g>
}

function GatePanel({ g }: { g: GatePolicy }) {
  const { live, sweep } = g
  const meets = g.points.filter(p => p.meets_rule), others = g.points.filter(p => !p.meets_rule)
  const chosen = sweep.chosen ? [{ ...sweep.chosen, meets_rule: true, kind: 'Live setting' }] : []
  const prev = sweep.previous ? [{ ...sweep.previous, meets_rule: false, kind: 'Previous setting' }] : []
  const card = (label: string, value: ReactNode, hint: string) => (
    <div className="rounded-lg border border-line px-3 py-2.5" title={hint}>
      <div className="text-xs text-muted">{label}</div><div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-[11px] leading-snug text-muted">{hint}</div>
    </div>
  )
  return (
    <Panel title="Escalation gate policy"
      sub="Read-only here on purpose: these thresholds are safety settings, chosen on a validation slice by a rule fixed before the sweep, and changed in code with a re-run of the evaluation."
      right={<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"><ShieldCheck size={13} />Rules above cannot override it</span>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {card('High priority when', `P(high) ≥ ${live.high_priority_threshold}`, 'Recall-first: a missed outage costs more than a false alarm')}
        {card('Critical incident when', `score ≥ ${live.critical_score_min}`, 'P(high) × P(Incident or Problem) → on-call')}
        {card('Queue confidence floor', live.min_confidence.queue.toFixed(2), 'Below this, a person checks the routing')}
        {card('Best past match floor', live.min_top1_similarity.toFixed(3), 'Below this, no precedent strong enough to draft from')}
        {card('Top-3 match floor', live.min_mean_top3_similarity.toFixed(3), 'Mean similarity of the three best precedents')}
        {card('Major incident', `${live.burst.min_count} in ${live.burst.window_min} min`, `Similar tickets (cosine ≥ ${live.burst.similarity})`)}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-1 text-sm font-semibold text-ink">The tradeoff: how much to automate vs how many outages reach a person</div>
          <div className="mb-3 text-xs text-muted">
            Each dot is one gate setting tested on {sweep.n_val?.toLocaleString() ?? '—'} validation tickets ({sweep.true_high_incidents ?? '—'} of them high-priority Incidents).
            Red dots meet the safety rule. Moving right automates more; moving down lets more outages slip past a person.
          </div>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                <CartesianGrid stroke="#E8ECF1" />
                <XAxis type="number" dataKey="auto_share" domain={[0, 0.7]} tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: '#5A6A7E' }}
                  label={{ value: 'Tickets auto-drafted →', position: 'insideBottom', offset: -18, fontSize: 12, fill: '#1C2735' }} />
                <YAxis type="number" dataKey="high_incident_escalated" domain={[0.8, 1]} tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: '#5A6A7E' }}
                  label={{ value: 'High-priority Incidents escalated', angle: -90, position: 'insideLeft', offset: 4, fontSize: 12, fill: '#1C2735', dy: 110 }} />
                <ZAxis range={[28, 28]} />
                <ReferenceLine y={0.95} stroke="#C8102E" strokeDasharray="5 4" label={{ value: '95% safety bar', position: 'insideTopRight', fontSize: 11, fill: '#C8102E' }} />
                <Tooltip content={<SweepTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Fails the rule" data={others} fill="#B8C2CF" fillOpacity={0.55} isAnimationActive={false} />
                <Scatter name="Meets the rule" data={meets} fill="#C8102E" fillOpacity={0.55} isAnimationActive={false} />
                <Scatter name="Previous setting" data={prev} shape={<Diamond />} isAnimationActive={false} />
                <Scatter name="Live setting" data={chosen} shape={<Star />} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-coral/60" />meets the safety rule</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#B8C2CF]" />fails it</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 bg-navy" />previous setting</span>
            <span className="inline-flex items-center gap-1.5"><span className="text-[13px] leading-none text-[#E2A33B]">★</span>live setting</span>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-line bg-canvas p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Selection rule, fixed before the sweep</div>
            <p className="mt-1 text-ink">Escalate at least 95% of high-priority Incidents and keep routing accuracy on auto-drafts at 0.75 or better; within that, automate as much as possible.</p>
            <p className="mt-2 text-xs text-muted">{sweep.n_meeting_rule ?? '—'} of {sweep.n_combinations?.toLocaleString() ?? '—'} settings passed.</p>
          </div>
          {sweep.chosen && sweep.previous && (
            <table className="w-full text-left text-xs">
              <thead className="text-muted"><tr><th className="py-1"></th><th>Previous</th><th>Live</th></tr></thead>
              <tbody className="divide-y divide-line tabular-nums">
                <tr><td className="py-1.5 text-muted">Auto-drafted</td><td>{pct(sweep.previous.auto_share)}</td><td className="font-semibold">{pct(sweep.chosen.auto_share)}</td></tr>
                <tr><td className="py-1.5 text-muted">High Incidents escalated</td><td>{pct(sweep.previous.high_incident_escalated)}</td><td className="font-semibold">{pct(sweep.chosen.high_incident_escalated)}</td></tr>
                <tr><td className="py-1.5 text-muted">Routing accuracy, auto</td><td>{sweep.previous.auto_queue_accuracy.toFixed(3)}</td><td className="font-semibold">{sweep.chosen.auto_queue_accuracy.toFixed(3)}</td></tr>
              </tbody>
            </table>
          )}
          <p className="flex gap-2 text-xs text-muted"><Info size={14} className="mt-0.5 shrink-0" />An organisation that wants more caution picks a point further up and to the left; one that trusts the model more moves right, as long as it stays above the safety bar.</p>
        </div>
      </div>
    </Panel>
  )
}

export default function Rules() {
  const toast = useToast()
  const [state, setState] = useState<RulesState | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [gate, setGate] = useState<GatePolicy | null>(null)

  const load = (s: RulesState) => { setState(s); setRules(s.rules); setEditing(null) }
  useEffect(() => {
    api.rules().then(load).catch(e => toast('warning', 'Could not load rules', (e as Error).message))
    api.gatePolicy().then(setGate).catch(() => setGate(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = useMemo(() => !!state && JSON.stringify(state.rules) !== JSON.stringify(rules), [state, rules])
  const update = (i: number, r: Rule) => setRules(rs => rs.map((x, j) => (j === i ? r : x)))
  const move = (i: number, d: -1 | 1) => setRules(rs => {
    const j = i + d; if (j < 0 || j >= rs.length) return rs
    const out = [...rs]; [out[i], out[j]] = [out[j], out[i]]; return out
  })
  const save = async () => {
    setSaving(true)
    try { load(await api.saveRules(rules)); toast('info', 'Rules saved', 'New tickets are routed with these rules.') }
    catch (e) { toast('warning', 'Not saved', (e as Error).message) }
    finally { setSaving(false) }
  }
  const reset = async () => {
    if (!confirm('Replace all rules with the defaults?')) return
    try { load(await api.resetRules()); toast('info', 'Defaults restored') }
    catch (e) { toast('warning', 'Reset failed', (e as Error).message) }
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50'
  return (
    <div className="space-y-5">
      <PageHeader title="Automation rules"
        sub="Your organisation's routing policy, applied to every new ticket after the model's prediction. First matching rule wins." />

      <Panel title="Assignment rules"
        sub={<>Rules route tickets and can raise priority. They never lower it and never change the safety gate's decision: an escalated ticket stays with on-call.
          {state && <span className="ml-1">{state.customised ? `Customised${state.updated_at ? ` · saved ${new Date(state.updated_at).toLocaleString()}` : ''}` : 'Showing the default policy.'}</span>}</>}
        right={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { const r = newRule(rules.length + 1); setRules(rs => [...rs, r]); setEditing(r.id) }} className={`${btn} border border-line bg-white text-ink hover:border-slate-400`}><Plus size={15} />Add rule</button>
            <button onClick={reset} className={`${btn} border border-line bg-white text-ink hover:border-slate-400`}><RotateCcw size={15} />Reset to defaults</button>
            <button onClick={() => state && load(state)} disabled={!dirty} className={`${btn} border border-line bg-white text-ink hover:border-slate-400`}><Undo2 size={15} />Discard</button>
            <button onClick={save} disabled={!dirty || saving} className={`${btn} bg-coral text-white hover:bg-coral-dark`}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save changes
            </button>
          </div>}>
        {!state ? <div className="py-8 text-center text-sm text-muted"><Loader2 className="mx-auto animate-spin" /></div> : (
          <ol className="divide-y divide-line">
            {rules.map((r, i) => {
              const hits = state.hits[r.id]
              return (
                <li key={r.id} className={`py-3 ${r.enabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex w-7 shrink-0 flex-col items-center pt-0.5">
                      <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="text-muted hover:text-ink disabled:opacity-30"><ArrowUp size={14} /></button>
                      <span className="text-xs font-semibold tabular-nums text-muted">{i + 1}</span>
                      <button onClick={() => move(i, 1)} disabled={i === rules.length - 1} aria-label="Move down" className="text-muted hover:text-ink disabled:opacity-30"><ArrowDown size={14} /></button>
                    </div>
                    <button role="switch" aria-checked={r.enabled} aria-label={r.enabled ? 'Disable rule' : 'Enable rule'}
                      onClick={() => update(i, { ...r, enabled: !r.enabled })}
                      className={`mt-1 h-5 w-9 shrink-0 rounded-full p-0.5 transition ${r.enabled ? 'bg-coral' : 'bg-slate-300'}`}>
                      <span className={`block h-4 w-4 rounded-full bg-white shadow transition ${r.enabled ? 'translate-x-4' : ''}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{r.name}</span>
                        {!r.enabled && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">off</span>}
                        {hits != null && r.enabled && <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] text-muted ring-1 ring-line">matches {hits} of {state.tickets} tickets now</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted">If</span>{conditions(r).length ? conditions(r) : <Chip tone="coral">no condition yet</Chip>}
                        <span className="ml-1 text-muted">then</span>{actions(r).length ? actions(r) : <Chip tone="coral">no action yet</Chip>}
                      </div>
                      {r.note && <div className="mt-1 text-xs text-muted">{r.note}</div>}
                      {editing === r.id && <RuleEditor rule={r} groups={state.groups} assignees={state.assignees} onChange={x => update(i, x)} onDone={() => setEditing(null)} />}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => setEditing(editing === r.id ? null : r.id)} aria-label="Edit rule" className="rounded p-1.5 text-muted hover:bg-canvas hover:text-ink"><Pencil size={15} /></button>
                      <button onClick={() => { setRules(rs => rs.filter((_, j) => j !== i)); if (editing === r.id) setEditing(null) }} aria-label="Delete rule" className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-coral"><Trash2 size={15} /></button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {dirty && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">Unsaved changes. Test them below, then save to apply them to new tickets.</div>}
      </Panel>

      <TestBox rules={rules} />
      {gate ? <GatePanel g={gate} /> : <div className="rounded-xl border border-line bg-white p-5 text-sm text-muted">Gate policy unavailable: run <code>./run.sh eval</code> to create reports/escalation_sweep.csv.</div>}
    </div>
  )
}
