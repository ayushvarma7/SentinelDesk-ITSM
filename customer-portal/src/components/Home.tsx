import { ArrowRight, ClipboardList, Search, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { fmtDate, useLang, useT } from '../i18n'
import type { Kind, PublicTicket } from '../types'
import { StatusPill } from './StatusPill'

export function matches(tk: PublicTicket, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  const flat = s.replace(/[\s-]/g, '')
  return (
    tk.ref.toLowerCase().includes(flat) ||
    tk.id.toLowerCase().replace(/-/g, '').includes(flat) ||
    tk.subject.toLowerCase().includes(s) ||
    tk.body.toLowerCase().includes(s)
  )
}

const HERO = {
  en: {
    kicker: 'Northeastern University Information Technology Services',
    hi: (n: string) => `Hi ${n}, how can we help today?`,
    ok: 'All services operating normally',
    bad: 'Possible outage: several urgent incidents reported in the last hour',
  },
  de: {
    kicker: 'Northeastern University IT-Services',
    hi: (n: string) => `Hallo ${n}, wie können wir helfen?`,
    ok: 'Alle Dienste laufen normal',
    bad: 'Mögliche Störung: mehrere dringende Vorfälle in der letzten Stunde',
  },
}

export function Home({ name, outage, query, setQuery, tickets, onNew, onOpen }: {
  name: string
  outage: boolean
  query: string
  setQuery: (q: string) => void
  tickets: PublicTicket[]
  onNew: (k: Kind) => void
  onOpen: (id: string) => void
}) {
  const t = useT()
  const { lang } = useLang()
  const results = query.trim() ? tickets.filter((x) => matches(x, query)) : []

  return (
    <div className="space-y-6 fade-up">
      <section className="hero">
        <div className="kicker">{HERO[lang].kicker}</div>
        <h1>{HERO[lang].hi(name.split(' ')[0])}</h1>
        <p>{t('helloSub')}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm" role="status">
          <span className={`h-2.5 w-2.5 rounded-full ${outage ? 'bg-red-400' : 'bg-emerald-400'}`} />
          {outage ? HERO[lang].bad : HERO[lang].ok}
        </div>
        <div className="relative mt-6">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            maxLength={200}
            className="w-full rounded-xl border-0 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-900 shadow-lg outline-none ring-coral/40 placeholder:text-slate-400 focus:ring-4"
          />
        </div>
      </section>

      {query.trim() && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('searchResults')} · {results.length}</h2>
          {results.length === 0 ? (
            <p className="text-sm text-slate-500">{t('searchNone')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50">
                    <span className="w-20 shrink-0 font-mono text-xs font-semibold text-navy-3">{r.ref}</span>
                    <span className="wrap-any line-clamp-1 flex-1 text-sm text-slate-800">{r.subject || r.body || t('noSubject')}</span>
                    <span className="hidden text-xs text-slate-400 sm:inline">{fmtDate(r.createdAt, lang)}</span>
                    <StatusPill status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="grid gap-5 sm:grid-cols-2">
        <BigCard
          icon={<TriangleAlert size={26} />}
          tone="coral"
          title={t('incidentTitle')}
          sub={t('incidentSub')}
          onClick={() => onNew('incident')}
        />
        <BigCard
          icon={<ClipboardList size={26} />}
          tone="navy"
          title={t('requestTitle')}
          sub={t('requestSub')}
          onClick={() => onNew('request')}
        />
      </section>
    </div>
  )
}

function BigCard({ icon, tone, title, sub, onClick }: {
  icon: ReactNode
  tone: 'coral' | 'navy'
  title: string
  sub: string
  onClick: () => void
}) {
  const chip = tone === 'coral' ? 'bg-coral-soft text-coral' : 'bg-navy/5 text-navy-3'
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[190px] flex-col rounded-2xl bg-white p-6 text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-coral/40 focus:outline-none focus-visible:ring-4 focus-visible:ring-coral/30"
    >
      <span className={`grid h-14 w-14 place-items-center rounded-2xl ${chip}`}>{icon}</span>
      <span className="mt-5 text-lg font-semibold text-navy">{title}</span>
      <span className="mt-1 text-sm text-slate-500">{sub}</span>
      <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-coral">
        <ArrowRight size={16} className="transition group-hover:translate-x-1" />
      </span>
    </button>
  )
}
