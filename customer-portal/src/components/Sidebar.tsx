import { Inbox } from 'lucide-react'
import { fmtDate, useLang, useT } from '../i18n'
import type { PublicTicket } from '../types'
import { StatusPill } from './StatusPill'
import { Timeline } from './Timeline'

export function Sidebar({ tickets, selected, onSelect, onOpen }: {
  tickets: PublicTicket[]
  selected: PublicTicket | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}) {
  const t = useT()
  const { lang } = useLang()
  const last = selected?.timeline[selected.timeline.length - 1]

  return (
    <aside className="space-y-5">
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <h2 className="flex items-center justify-between border-b border-slate-100 px-5 py-4 text-sm font-semibold text-navy">
          {t('myHistory')}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{tickets.length}</span>
        </h2>
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-slate-500">
            <Inbox size={28} className="text-slate-300" />
            {t('noTickets')}
          </div>
        ) : (
          <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
            {tickets.map((tk) => {
              const active = selected?.id === tk.id
              return (
                <li key={tk.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(tk.id)}
                    onDoubleClick={() => onOpen(tk.id)}
                    className={`block w-full px-5 py-3 text-left transition ${active ? 'bg-coral-soft/60' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-navy-3">{tk.ref}</span>
                      <StatusPill status={tk.status} />
                    </div>
                    <div className="wrap-any mt-1 line-clamp-1 text-sm text-slate-800">{tk.subject || tk.body || t('noSubject')}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{fmtDate(tk.createdAt, lang)}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-navy">{t('statusPanel')}</h2>
        {!selected ? (
          <p className="text-sm text-slate-500">{t('selectTicket')}</p>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-navy-3">{selected.ref}</span>
              <StatusPill status={selected.status} />
            </div>
            {last && (
              <p className="mt-1 text-xs text-slate-400">{t('lastUpdate')}: {fmtDate(last.at, lang)}</p>
            )}
            <div className="mt-4">
              <Timeline events={selected.timeline} compact />
            </div>
            <button
              type="button"
              onClick={() => onOpen(selected.id)}
              className="mt-4 w-full rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-2"
            >
              {t('viewTicket')}
            </button>
          </div>
        )}
      </section>
    </aside>
  )
}
