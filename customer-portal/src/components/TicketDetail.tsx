import { ChevronLeft, Clock, MessageSquare, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { fmtDate, useLang, useT } from '../i18n'
import type { PublicTicket } from '../types'
import { StatusPill } from './StatusPill'
import { Timeline } from './Timeline'

const LONG = 700

export function TicketDetail({ ticket, onBack }: { ticket: PublicTicket; onBack: () => void }) {
  const t = useT()
  const { lang } = useLang()
  const [expanded, setExpanded] = useState(false)
  const long = ticket.body.length > LONG
  const body = long && !expanded ? ticket.body.slice(0, LONG).trimEnd() + '…' : ticket.body

  return (
    <div className="space-y-5 fade-up">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-navy">
          <ChevronLeft size={16} /> {t('back')}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-navy-3">{ticket.ref}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {ticket.kind === 'incident' ? t('incident') : t('request')}
          </span>
          <StatusPill status={ticket.status} />
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400">
            <Clock size={12} /> {fmtDate(ticket.createdAt, lang)}
          </span>
        </div>
        <h1 className="wrap-any mt-3 text-xl font-semibold text-navy">{ticket.subject || t('noSubject')}</h1>

        <h2 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('yourMessage')}</h2>
        <div className="wrap-any mt-2 max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          {body || '—'}
        </div>
        {long && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-sm font-medium text-coral hover:text-coral-dark">
            {expanded ? t('showLess') : t('showMore')}
          </button>
        )}
      </div>

      {ticket.reply ? (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-emerald-200">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <MessageSquare size={16} /> {t('reply')}
          </h2>
          <p className="wrap-any mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{ticket.reply}</p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl bg-navy/[0.03] p-6 ring-1 ring-navy/10">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-navy-3 shadow-sm">
            <ShieldCheck size={20} />
          </span>
          <div>
            <p className="font-medium text-navy">{t('reviewing')}</p>
            <p className="mt-0.5 text-sm text-slate-500">{t('reviewingSub')}</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">{t('timeline')}</h2>
        <Timeline events={ticket.timeline} />
      </div>
    </div>
  )
}
