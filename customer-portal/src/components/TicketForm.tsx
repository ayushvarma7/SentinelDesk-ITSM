import { ChevronLeft, ClipboardList, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { MAX_BODY, type NewTicket } from '../api'
import { useT } from '../i18n'
import type { Kind, Urgency } from '../types'

const SUBJECT_MAX = 200

export function TicketForm({ kind, onCancel, onSubmit }: {
  kind: Kind
  onCancel: () => void
  onSubmit: (t: NewTicket) => Promise<void>
}) {
  const t = useT()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const bodyMissing = body.trim().length === 0
  const showError = touched && bodyMissing

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (bodyMissing || busy) return
    setBusy(true)
    try {
      await onSubmit({ kind, subject: subject.trim(), body: body.slice(0, MAX_BODY), urgency })
    } finally {
      setBusy(false)
    }
  }

  const isInc = kind === 'incident'
  return (
    <form onSubmit={submit} noValidate className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 fade-up">
      <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
        <button type="button" onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label={t('back')}>
          <ChevronLeft size={18} />
        </button>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${isInc ? 'bg-coral-soft text-coral' : 'bg-navy/5 text-navy-3'}`}>
          {isInc ? <TriangleAlert size={20} /> : <ClipboardList size={20} />}
        </span>
        <div>
          <h1 className="text-lg font-semibold text-navy">{isInc ? t('formIncident') : t('formRequest')}</h1>
          <p className="text-xs text-slate-500">{isInc ? t('incidentSub') : t('requestSub')}</p>
        </div>
      </div>

      <div className="space-y-5 px-6 py-6">
        <div>
          <label htmlFor="subject" className="mb-1.5 block text-sm font-medium text-slate-700">
            {t('subject')} <span className="font-normal text-slate-400">({t('optional')})</span>
          </label>
          <input
            id="subject"
            value={subject}
            maxLength={SUBJECT_MAX}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('subjectPlaceholder')}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-navy-3 focus:ring-4 focus:ring-navy/10"
          />
        </div>

        <div>
          <label htmlFor="body" className="mb-1.5 block text-sm font-medium text-slate-700">
            {t('description')} <span className="text-coral">*</span>
          </label>
          <textarea
            id="body"
            value={body}
            rows={7}
            maxLength={MAX_BODY}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t('descriptionPlaceholder')}
            aria-invalid={showError}
            aria-describedby="body-help"
            className={`wrap-any max-h-[50vh] w-full resize-y rounded-xl border px-4 py-3 text-sm outline-none focus:ring-4 ${
              showError ? 'border-coral focus:ring-coral/15' : 'border-slate-300 focus:border-navy-3 focus:ring-navy/10'
            }`}
          />
          <div id="body-help" className="mt-1 flex justify-between gap-3 text-xs">
            <span role={showError ? 'alert' : undefined} className="text-coral-dark">{showError ? t('descriptionRequired') : ''}</span>
            <span className={body.length >= MAX_BODY ? 'text-coral-dark' : 'text-slate-400'}>
              {body.length.toLocaleString()} / {MAX_BODY.toLocaleString()} {t('chars')}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="urgency" className="mb-1.5 block text-sm font-medium text-slate-700">
            {t('urgency')} <span className="font-normal text-slate-400">({t('optional')})</span>
          </label>
          <select
            id="urgency"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as Urgency)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-navy-3 focus:ring-4 focus:ring-navy/10 sm:w-80"
          >
            <option value="">{t('urgencyNone')}</option>
            <option value="low">{t('urgencyLow')}</option>
            <option value="normal">{t('urgencyNormal')}</option>
            <option value="high">{t('urgencyHigh')}</option>
            <option value="critical">{t('urgencyCritical')}</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-coral px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-60"
        >
          {busy && <LoaderCircle size={16} className="animate-spin" />}
          {busy ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  )
}
