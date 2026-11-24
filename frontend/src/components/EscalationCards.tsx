import type { ReactNode } from 'react'
import { Banknote, FileQuestion, Gauge, Scale, SearchX, ShieldAlert, Siren } from 'lucide-react'

type Cat = { key: string; title: string; icon: ReactNode; tone: string; iconTone: string; test: RegExp }

// Order = severity order on screen.
const CATS: Cat[] = [
  { key: 'security', title: 'Security risk', icon: <ShieldAlert size={22} />, tone: 'border-red-200 bg-red-50', iconTone: 'bg-red-600 text-white', test: /injection|credential|destructive|^Security/i },
  { key: 'legal', title: 'Legal', icon: <Scale size={22} />, tone: 'border-red-200 bg-red-50', iconTone: 'bg-red-600 text-white', test: /legal/i },
  { key: 'critical', title: 'Critical incident', icon: <Siren size={22} />, tone: 'border-coral/40 bg-coral/5', iconTone: 'bg-coral text-white', test: /critical incident|major incident/i },
  { key: 'commitment', title: 'Unsupported commitment', icon: <Banknote size={22} />, tone: 'border-amber-200 bg-amber-50', iconTone: 'bg-amber-400 text-navy', test: /refund|compensation|commitment/i },
  { key: 'confidence', title: 'Low confidence', icon: <Gauge size={22} />, tone: 'border-amber-200 bg-amber-50', iconTone: 'bg-amber-400 text-navy', test: /confidence/i },
  { key: 'precedent', title: 'No precedent', icon: <SearchX size={22} />, tone: 'border-slate-200 bg-slate-50', iconTone: 'bg-slate-600 text-white', test: /precedent|grounded/i },
  { key: 'text', title: 'Unreadable ticket', icon: <FileQuestion size={22} />, tone: 'border-slate-200 bg-slate-50', iconTone: 'bg-slate-600 text-white', test: /too little text/i },
]
const OTHER: Cat = { key: 'other', title: 'Needs review', icon: <ShieldAlert size={22} />, tone: 'border-slate-200 bg-slate-50', iconTone: 'bg-slate-600 text-white', test: /.*/ }

export default function EscalationCards({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null
  const groups = new Map<Cat, string[]>()
  for (const r of reasons) {
    const c = CATS.find(c => c.test.test(r)) ?? OTHER
    groups.set(c, [...(groups.get(c) ?? []), r])
  }
  const ordered = [...CATS, OTHER].filter(c => groups.has(c))
  return (
    <div className={`grid gap-3 ${ordered.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {ordered.map(c => (
        <div key={c.key} className={`flex gap-3 rounded-xl border p-4 ${c.tone}`}>
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.iconTone}`}>{c.icon}</span>
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-navy">{c.title}</div>
            <ul className="mt-1 space-y-0.5 text-[13px] leading-snug text-slate-700">
              {groups.get(c)!.map(r => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}
