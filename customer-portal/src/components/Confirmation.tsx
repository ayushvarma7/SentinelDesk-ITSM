import { Check, CircleCheck, Copy } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../i18n'
import type { PublicTicket } from '../types'

export function Confirmation({ ticket, notice, onView, onHome }: {
  ticket: PublicTicket
  notice: string | null
  onView: () => void
  onHome: () => void
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(ticket.ref)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200 fade-up sm:p-12">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
        <CircleCheck size={34} />
      </span>
      <h1 className="mt-5 text-xl font-semibold text-navy sm:text-2xl">{t('confirmTitle')}</h1>
      <p className="mt-6 text-xs font-medium uppercase tracking-wider text-slate-500">{t('confirmRef')}</p>
      <div className="mt-2 inline-flex items-center gap-3 rounded-2xl bg-navy px-6 py-3 text-white">
        <span data-testid="ticket-ref" className="font-mono text-2xl font-semibold tracking-wider">{ticket.ref}</span>
        <button type="button" onClick={copy} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Copy">
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <p className="mx-auto mt-5 max-w-md text-sm text-slate-500">{t('confirmSub')}</p>
      {notice && <p className="mx-auto mt-3 max-w-md rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onView} className="rounded-xl bg-coral px-5 py-2.5 text-sm font-semibold text-white hover:bg-coral-dark">
          {t('viewTicket')}
        </button>
        <button type="button" onClick={onHome} className="rounded-xl px-5 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
          {t('backHome')}
        </button>
      </div>
    </div>
  )
}
