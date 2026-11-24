import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, FileText, Link2, Lock, Plus, ShieldOff, X } from 'lucide-react'
import type { Precedent } from '../api'
import { analyze, applyFix, type Issue, type IssueKind } from './draftAnalysis'

const KIND_STYLE: Record<IssueKind, { icon: ReactNode; ring: string; label: string }> = {
  unverified: { icon: <AlertTriangle size={15} className="text-amber-500" />, ring: 'border-l-amber-400', label: 'Unverified figure' },
  invalid: { icon: <ShieldOff size={15} className="text-red-600" />, ring: 'border-l-red-500', label: 'Bad citation' },
  missing: { icon: <Link2 size={15} className="text-sky-600" />, ring: 'border-l-sky-500', label: 'Missing citation' },
  pii: { icon: <Lock size={15} className="text-violet-600" />, ring: 'border-l-violet-500', label: 'Masked PII' },
}

/** Hover card that sits above an inline mark. */
function Hover({ children, card }: { children: ReactNode; card: ReactNode }) {
  return (
    <span className="group relative">
      {children}
      <span className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-72 group-hover:block">
        <span className="block rounded-lg bg-navy p-3 text-left text-xs font-normal leading-relaxed text-slate-200 shadow-xl ring-1 ring-white/10">{card}</span>
      </span>
    </span>
  )
}

export function ScoreBar({ grounding, citations, issues }: { grounding: number; citations: number; issues: number }) {
  const color = grounding >= 85 ? 'bg-teal-500' : grounding >= 60 ? 'bg-amber-400' : 'bg-red-500'
  const text = grounding >= 85 ? 'text-teal-700' : grounding >= 60 ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5"
      title="Grounding = share of factual sentences that cite a retrieved precedent, minus 15 per unverified figure and 25 per bad citation.">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Grounding</span>
        <span className={`text-lg font-bold tabular-nums ${text}`}>{grounding}%</span>
      </div>
      <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${grounding}%` }} />
      </div>
      <span className="text-sm text-slate-600"><b className="font-semibold text-slate-900">{citations}</b> citation{citations === 1 ? '' : 's'}</span>
      <span className="text-slate-300">·</span>
      <span className={`text-sm ${issues ? 'font-semibold text-amber-700' : 'text-teal-700'}`}>
        {issues ? `${issues} issue${issues === 1 ? '' : 's'}` : 'No issues'}
      </span>
    </div>
  )
}

export default function DraftEditor({
  text, onChange, precedents, unverified, lang, editing = false, readOnly = false, openPrec, onBlocking, resetKey,
}: {
  text: string
  onChange?: (t: string) => void
  precedents: Precedent[]
  unverified: string[]
  lang: string
  editing?: boolean
  readOnly?: boolean
  openPrec: (p: Precedent) => void
  onBlocking?: (n: number) => void
  resetKey?: string
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => { setDismissed(new Set()) }, [resetKey])

  const a = useMemo(() => analyze(text, precedents, unverified, dismissed), [text, precedents, unverified, dismissed])
  const blocking = a.issues.filter(i => i.blocking).length
  useEffect(() => { onBlocking?.(blocking) }, [blocking, onBlocking])

  const accept = (i: Issue) => onChange?.(applyFix(text, i, precedents, lang))
  const dismiss = (i: Issue) => setDismissed(d => new Set(d).add(i.key))

  return (
    <div className="space-y-3">
      <ScoreBar grounding={a.grounding} citations={a.citations.filter(c => c.valid).length} issues={a.issues.length} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {editing && !readOnly ? (
            <textarea value={text} onChange={e => onChange?.(e.target.value)} rows={8} autoFocus
              className="h-full min-h-[180px] w-full rounded-lg border border-navy/30 bg-white p-4 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-navy/15" />
          ) : (
            <div className="min-h-[120px] rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-[14px] leading-7 text-slate-800">
              <Marked text={text} a={a} precedents={precedents} focus={focus} openPrec={openPrec} onInsert={readOnly ? undefined : accept} />
            </div>
          )}
        </div>
        <Rail issues={a.issues} readOnly={readOnly} onAccept={accept} onDismiss={dismiss} onFocus={setFocus} />
      </div>
    </div>
  )
}

function Marked({ text, a, precedents, focus, openPrec, onInsert }: {
  text: string; a: ReturnType<typeof analyze>; precedents: Precedent[]; focus: string | null
  openPrec: (p: Precedent) => void; onInsert?: (i: Issue) => void
}) {
  type M = { start: number; end: number; node: (s: string) => ReactNode; insert?: boolean }
  const marks: M[] = []
  for (const c of a.citations) {
    const p = precedents.find(x => x.ticket_id === c.id)
    marks.push({
      start: c.start, end: c.end,
      node: s => p ? (
        <Hover card={<>
          <span className="block font-mono font-semibold text-coral">{p.ticket_id} · similarity {p.score.toFixed(3)}</span>
          <span className="mt-1 block font-semibold text-white">{p.subject}</span>
          <span className="mt-1 block italic text-slate-300">“{p.body_snippet}”</span>
          <span className="mt-1.5 block text-slate-400">Click to open the full resolution</span>
        </>}>
          <button type="button" onClick={() => openPrec(p)} className="mark-cite whitespace-nowrap font-mono text-[12.5px] font-semibold text-navy hover:bg-navy/5">{s}</button>
        </Hover>
      ) : <span className="whitespace-nowrap font-mono text-[12.5px] text-red-600 line-through decoration-2">{s}</span>,
    })
  }
  for (const p of a.pii) {
    marks.push({ start: p.start, end: p.end, node: s => (
      <span title="Masked PII token" className="mx-0.5 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-px align-baseline font-mono text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200"><Lock size={10} />{s.slice(1, -1)}</span>
    ) })
  }
  for (const i of a.issues) {
    if (i.kind === 'unverified') {
      marks.push({ start: i.start, end: i.end, node: s => (
        <Hover card={<>
          <span className="flex items-center gap-1.5 font-semibold text-amber-300"><AlertTriangle size={13} />Unverified claim</span>
          <span className="mt-1 block">Not found in any precedent — remove or verify.</span>
        </>}>
          <span className={`mark-unverified ${focus === i.key ? 'mark-focus' : ''}`}>{s}</span>
        </Hover>
      ) })
    }
    if (i.kind === 'missing') {
      marks.push({ start: i.start, end: i.start, insert: true, node: () => (
        <button type="button" disabled={!onInsert} onClick={() => onInsert?.(i)} title="Claim without a citation: click to cite the top precedent"
          className={`mx-0.5 inline-flex items-center gap-0.5 rounded border border-dashed border-sky-400 bg-sky-50 px-1 align-baseline text-[11px] font-semibold text-sky-700 hover:bg-sky-100 ${focus === i.key ? 'ring-2 ring-sky-300' : ''}`}>
          <Plus size={10} />cite
        </button>
      ) })
    }
  }
  marks.sort((x, y) => x.start - y.start || Number(!!y.insert) - Number(!!x.insert))

  const out: ReactNode[] = []
  let cur = 0
  marks.forEach((m, k) => {
    if (m.start < cur) return                       // overlapping mark: first one wins
    if (m.start > cur) out.push(<span key={`t${k}`}>{text.slice(cur, m.start)}</span>)
    out.push(<span key={`m${k}`}>{m.node(text.slice(m.start, m.end))}</span>)
    cur = m.end
  })
  out.push(<span key="tail">{text.slice(cur)}</span>)
  return <p className="whitespace-pre-wrap break-words">{out}</p>
}

function Rail({ issues, readOnly, onAccept, onDismiss, onFocus }: {
  issues: Issue[]; readOnly: boolean; onAccept: (i: Issue) => void; onDismiss: (i: Issue) => void; onFocus: (k: string | null) => void
}) {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggestions</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${issues.length ? 'bg-amber-100 text-amber-800' : 'bg-teal-100 text-teal-800'}`}>{issues.length}</span>
      </div>
      {issues.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
          <CheckCircle2 size={26} className="text-teal-500" />
          <div className="text-sm font-semibold text-slate-800">Looks grounded</div>
          <div className="text-xs text-slate-500">Every claim cites a retrieved precedent.</div>
        </div>
      ) : (
        <ul className="max-h-[320px] divide-y divide-slate-100 overflow-y-auto">
          {issues.map(i => (
            <li key={i.key} onMouseEnter={() => onFocus(i.key)} onMouseLeave={() => onFocus(null)}
              className={`border-l-[3px] px-3 py-2.5 ${KIND_STYLE[i.kind].ring} hover:bg-slate-50`}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {KIND_STYLE[i.kind].icon}{KIND_STYLE[i.kind].label}{i.blocking && <span className="ml-auto rounded bg-amber-100 px-1 text-[9px] text-amber-800">BLOCKS SEND</span>}
              </div>
              <div className="mt-1 text-[13px] font-medium text-slate-900">{i.title}</div>
              <div className="mt-0.5 text-xs leading-snug text-slate-500">{i.detail}</div>
              {!readOnly && (
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => onAccept(i)} className="inline-flex items-center gap-1 rounded-md bg-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-3"><Check size={12} />Accept</button>
                  <button onClick={() => onDismiss(i)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"><X size={12} />Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly && issues.length > 0 && (
        <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500"><FileText size={12} />Sent automatically. Use Override to edit.</div>
      )}
    </aside>
  )
}
