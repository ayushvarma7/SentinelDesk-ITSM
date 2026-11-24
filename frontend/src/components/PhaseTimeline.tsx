import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2, Minus, ShieldAlert, X } from 'lucide-react'
import type { Phase } from '../api'

const SHORT: Record<string, string> = {
  'PII Mask': 'PII', Triage: 'Triage', 'Safety Gate': 'Gate', 'Retrieve Precedents': 'Retrieve',
  'Grade Evidence': 'Grade', 'Draft Reply': 'Draft', 'Verify Citations': 'Verify', 'Resolve/Escalate': 'Resolve',
}

const NODE = {
  done: { cls: 'bg-teal-600 text-white', icon: <Check size={16} strokeWidth={3} /> },
  warning: { cls: 'bg-amber-400 text-navy', icon: <AlertTriangle size={15} /> },
  skipped: { cls: 'bg-slate-200 text-slate-500', icon: <Minus size={15} /> },
  escalated: { cls: 'bg-coral text-white', icon: <ShieldAlert size={15} /> },
  failed: { cls: 'bg-red-600 text-white', icon: <X size={15} /> },
}

const STEP_MS = 420

/** Horizontal agent timeline with a vertical log panel. Re-animates whenever `replay` changes. */
export default function PhaseTimeline({ phases, replay, escalated }: { phases: Phase[]; replay: number; escalated: boolean }) {
  const [shown, setShown] = useState(0)
  const [sel, setSel] = useState<number | null>(null)
  const logRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    setShown(0); setSel(null)
    let n = 0
    const id = setInterval(() => {
      n++; setShown(n)
      if (n >= phases.length) {
        clearInterval(id)
        // land on the most interesting phase: first escalation, else first warning, else the last
        const pick = phases.findIndex(p => p.status === 'escalated')
        const warn = phases.findIndex(p => p.status === 'warning')
        setSel(pick >= 0 ? pick : warn >= 0 ? warn : phases.length - 1)
      }
    }, STEP_MS)
    return () => clearInterval(id)
  }, [phases, replay])

  const running = shown < phases.length
  const total = phases.reduce((s, p) => s + p.duration_ms, 0)
  const pick = (i: number) => {
    setSel(s => (s === i ? null : i))
    logRefs.current[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="text-sm font-semibold text-navy">Agent run</div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {running ? <><Loader2 size={13} className="animate-spin text-navy" />Running {SHORT[phases[shown]?.phase] ?? ''}…</>
            : <><span className={`h-2 w-2 rounded-full ${escalated ? 'bg-coral' : 'bg-teal-500'}`} />{escalated ? 'Escalated to a human' : 'Resolved by agent'} · <span className="font-mono">{total.toFixed(0)} ms</span></>}
        </div>
      </div>

      <ol className="relative mx-5 mb-2 mt-4 grid" style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }}>
        <span className="absolute left-[6.25%] right-[6.25%] top-[17px] h-0.5 bg-slate-200" aria-hidden />
        <span className="absolute left-[6.25%] top-[17px] h-0.5 bg-navy transition-all duration-300" aria-hidden
          style={{ width: `${Math.max(0, Math.min(shown, phases.length) - 1) / Math.max(1, phases.length - 1) * 87.5}%` }} />
        {phases.map((p, i) => {
          const done = i < shown
          const active = i === shown && running
          const label = p.phase === 'Resolve/Escalate' ? (escalated ? 'Escalate' : 'Resolve') : SHORT[p.phase] ?? p.phase
          return (
            <li key={p.phase} className="relative z-10 flex flex-col items-center">
              <button type="button" onClick={() => done && pick(i)} disabled={!done} aria-label={p.phase}
                className={`flex h-9 w-9 items-center justify-center rounded-full ring-4 ring-white transition
                  ${done ? `${NODE[p.status]?.cls ?? NODE.done.cls} node-pop cursor-pointer hover:scale-110` : active ? 'bg-white text-navy ring-navy/20' : 'bg-slate-100 text-slate-300'}
                  ${sel === i ? 'outline-2 outline-offset-2 outline-navy' : ''}`}>
                {done ? NODE[p.status]?.icon ?? NODE.done.icon : active ? <Loader2 size={16} className="animate-spin" /> : <span className="h-2 w-2 rounded-full bg-slate-300" />}
              </button>
              <span className={`mt-2 text-xs font-semibold ${done ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
              <span className="font-mono text-[10px] text-slate-400">{done ? `${p.duration_ms.toFixed(1)} ms` : ' '}</span>
            </li>
          )
        })}
      </ol>

      <ul className="m-3 mt-1 max-h-[200px] overflow-y-auto rounded-lg bg-navy p-1.5 font-mono text-[12px]">
        {phases.slice(0, shown).map((p, i) => (
          <li key={p.phase} ref={el => { logRefs.current[i] = el }} className="step-in">
            <button onClick={() => pick(i)} className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-white/5 ${sel === i ? 'bg-white/10' : ''}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${p.status === 'done' ? 'bg-teal-400' : p.status === 'warning' ? 'bg-amber-400' : p.status === 'escalated' ? 'bg-coral' : 'bg-slate-500'}`} />
              <span className="font-semibold text-slate-100">{p.phase}</span>
              <span className="truncate text-slate-400">{p.logs[0]}</span>
              <ChevronDown size={13} className={`ml-auto shrink-0 text-slate-500 transition-transform ${sel === i ? 'rotate-180' : ''}`} />
            </button>
            {sel === i && (
              <div className="px-7 pb-2 pt-0.5 leading-relaxed text-slate-300">
                {p.logs.map((l, k) => <div key={k}><span className="text-slate-500">›</span> {l}</div>)}
              </div>
            )}
          </li>
        ))}
        {running && <li className="px-2.5 py-1.5 text-slate-500">▍</li>}
      </ul>
    </div>
  )
}
