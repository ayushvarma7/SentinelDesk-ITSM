// Building blocks mirroring Poornima's Streamlit components (.ph header, st.metric, .stats strip, multiselect).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

/** .ph — page title + muted subtitle, optional right-hand slot. */
export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {sub && <div className="mt-0.5 text-[0.98rem] text-muted">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

/** st.metric — white card, small label, big value. */
export function MetricCard({ label, value, hint, onClick, active }: { label: string; value: ReactNode; hint?: string; onClick?: () => void; active?: boolean }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} title={hint}
      className={`rounded-[10px] border bg-white px-4 py-3 text-left transition ${active ? 'border-coral ring-1 ring-coral' : 'border-line'} ${onClick ? 'hover:border-slate-400' : ''}`}>
      <div className="text-sm text-ink">{label}</div>
      <div className="mt-1 text-[2rem] font-normal leading-tight tabular-nums text-ink">{value}</div>
    </Tag>
  )
}

export function useCountUp(target: number, ms = 1600) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!Number.isFinite(target)) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function StatCell({ n, suffix, label }: { n: number | null; suffix: string; label: string }) {
  const v = useCountUp(n ?? 0)
  return (
    <div className="border-line px-6 py-5 [&:not(:first-child)]:border-l max-md:[&:nth-child(3)]:border-l-0">
      <div className="text-[2rem] font-bold leading-tight tabular-nums text-navy">{n == null ? '—' : <>{v.toLocaleString()}{suffix}</>}</div>
      <div className="mt-1 text-[0.9rem] text-muted">{label}</div>
    </div>
  )
}

/** .stats — one card split into 4 cells, numbers count up on load. */
export function StatStrip({ items }: { items: { n: number | null; suffix?: string; label: string }[] }) {
  return (
    <div className="rise grid grid-cols-2 rounded-xl border border-line bg-white md:grid-cols-4">
      {items.map(i => <StatCell key={i.label} n={i.n} suffix={i.suffix ?? ''} label={i.label} />)}
    </div>
  )
}

/** st.multiselect look-alike: closed field shows chips, popover lists options with checkboxes. */
export function MultiSelect({ placeholder, options, value, onChange, render }: {
  placeholder: string; options: string[]; value: string[]; onChange: (v: string[]) => void; render?: (o: string) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true) }
  }, [open])
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o])
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={`flex h-10 w-full items-center gap-1.5 rounded-lg border bg-white pl-3 pr-2 text-left text-sm ${open ? 'border-coral ring-1 ring-coral/30' : 'border-line hover:border-slate-400'}`}>
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {value.length === 0 ? <span className="truncate text-muted">{placeholder}</span> : value.map(v => (
            <span key={v} className="inline-flex shrink-0 items-center gap-1 rounded bg-coral px-1.5 py-0.5 text-xs font-medium text-white">
              {render ? render(v) : v}
              <X size={11} onClick={e => { e.stopPropagation(); toggle(v) }} />
            </span>
          ))}
        </span>
        {value.length > 0 && <X size={14} className="shrink-0 text-muted hover:text-ink" onClick={e => { e.stopPropagation(); onChange([]) }} />}
        <ChevronDown size={16} className="shrink-0 text-ink" />
      </button>
      {open && (
        <ul className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 min-w-[200px] overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
          {options.map(o => (
            <li key={o}>
              <button type="button" onClick={() => toggle(o)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-canvas">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${value.includes(o) ? 'border-coral bg-coral text-white' : 'border-slate-300'}`}>
                  {value.includes(o) && <Check size={11} strokeWidth={3} />}
                </span>
                {render ? render(o) : o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
