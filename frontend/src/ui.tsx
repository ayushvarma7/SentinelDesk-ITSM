import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Precedent, Priority } from './api'
import { STATUS_DE, useT, LangContext } from './i18n'
import { useContext } from 'react'

export const PRIO_STYLE: Record<Priority, { row: string; bar: string; badge: string; dot: string }> = {
  high: { row: 'bg-red-50/70 hover:bg-red-100/70', bar: 'border-l-red-500', badge: 'bg-red-100 text-red-800 ring-red-200', dot: 'bg-red-500' },
  medium: { row: 'bg-amber-50/70 hover:bg-amber-100/70', bar: 'border-l-amber-400', badge: 'bg-amber-100 text-amber-900 ring-amber-200', dot: 'bg-amber-400' },
  low: { row: 'bg-emerald-50/60 hover:bg-emerald-100/60', bar: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500' },
}

export const P_CODE: Record<Priority, string> = { high: 'P1', medium: 'P2', low: 'P3' }

/** Priority pill. `code` shows the ServiceNow-style P1/P2/P3 first. */
export function PriorityBadge({ p, code = false }: { p: Priority; code?: boolean }) {
  const t = useT()
  const s = PRIO_STYLE[p] ?? PRIO_STYLE.medium
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${s.badge}`} title={t(p)}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{code ? <><b>{P_CODE[p]}</b><span className="font-medium opacity-80">{t(p)}</span></> : t(p)}
    </span>
  )
}

const STATUS_STYLE: Record<string, string> = {
  New: 'bg-sky-100 text-sky-800',
  'In Progress': 'bg-indigo-100 text-indigo-800',
  'Auto-Resolved': 'bg-teal-100 text-teal-800',
  Escalated: 'bg-coral/15 text-coral-dark',
  Closed: 'bg-slate-200 text-slate-700',
}

export function StatusPill({ s }: { s: string }) {
  const { lang } = useContext(LangContext)
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s] ?? 'bg-slate-100'}`}>
    {lang === 'de' ? STATUS_DE[s] ?? s : s}
  </span>
}

export function ConfidenceBar({ v }: { v: number }) {
  const pct = Math.round(v * 100)
  const color = v >= 0.75 ? 'bg-emerald-500' : v >= 0.6 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2" title={`min head confidence ${v.toFixed(2)}`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs tabular-nums text-slate-600">{pct}%</span>
    </div>
  )
}

export function fmtDate(iso: string, lang: string) {
  const d = new Date(iso)
  return d.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id) }, [ms])
  return now
}

export function slaText(due: string, now: number) {
  const diff = new Date(due).getTime() - now
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3.6e6), m = Math.floor((abs % 3.6e6) / 6e4), s = Math.floor((abs % 6e4) / 1000)
  const txt = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return { breached: diff < 0, txt, urgent: diff >= 0 && diff < 3600e3 }
}

export function SlaCountdown({ due, done }: { due: string; done?: boolean }) {
  const t = useT()
  const now = useNow()
  if (done) return <span className="text-sm text-slate-500">—</span>
  const { breached, txt, urgent } = slaText(due, now)
  return (
    <span className={`font-mono text-sm font-semibold tabular-nums ${breached ? 'text-red-600' : urgent ? 'text-amber-600' : 'text-slate-800'}`}>
      {breached ? `${t('slaBreached')} +${txt}` : `${txt} ${t('slaLeft')}`}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}

export function PrecedentModal({ p, onClose }: { p: Precedent | null; onClose: () => void }) {
  const t = useT()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  if (!p) return null
  return (
    <div data-modal className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="font-mono text-xs font-semibold text-coral">{p.ticket_id}</div>
            <div className="mt-0.5 font-semibold text-navy">{p.subject}</div>
            <div className="mt-1 flex gap-2 text-xs text-slate-500">
              <span>{p.queue}</span><span>·</span><span className="uppercase">{p.language}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="close"><X size={18} /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <div className="mb-1 flex justify-between text-xs font-medium text-slate-500"><span>{t('similarity')}</span><span className="font-mono">{p.score.toFixed(3)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              {/* cosine scores live in ~0.80-0.95; stretch that band so differences are visible */}
              <div className="h-full rounded-full bg-navy" style={{ width: `${Math.max(4, Math.min(100, (p.score - 0.8) / 0.15 * 100))}%` }} />
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm italic text-slate-600">“{p.body_snippet}”</div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('answer')}</div>
            <p className="text-sm leading-relaxed text-slate-800">{p.answer}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Live SLA pill: red under 1h (or breached), amber under 4h. */
export function SlaPill({ due, done, now }: { due: string; done: boolean; now: number }) {
  if (done) return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Met</span>
  const diff = new Date(due).getTime() - now
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3.6e6), m = Math.floor((abs % 3.6e6) / 6e4), s = Math.floor((abs % 6e4) / 1000)
  const txt = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h >= 1 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`
  const cls = diff < 3.6e6 ? 'bg-red-600 text-white' : diff < 4 * 3.6e6 ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : 'bg-slate-100 text-slate-700'
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${cls}`}>{diff < 0 ? `-${txt}` : txt}</span>
}

export function slaMinutesLeft(due: string, now: number) { return (new Date(due).getTime() - now) / 6e4 }

export function Skeleton({ className = '' }: { className?: string }) { return <div className={`skeleton ${className}`} /> }

const PII_RE = /(<(?:email|tel_num|acc_num|ip_address|name)>)/g
/** Text with dataset PII tokens rendered as violet chips. */
export function PiiText({ text }: { text: string }) {
  return <>{text.split(PII_RE).map((part, i) => /^<(?:email|tel_num|acc_num|ip_address|name)>$/.test(part)
    ? <span key={i} title="Masked before any external call" className="mx-0.5 inline-flex items-center rounded bg-violet-100 px-1.5 py-px font-mono text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200">{part.slice(1, -1)}</span>
    : <span key={i}>{part}</span>)}</>
}
