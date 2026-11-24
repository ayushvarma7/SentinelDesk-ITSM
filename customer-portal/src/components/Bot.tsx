import { Bot as BotIcon, Send, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import type { PublicTicket } from '../types'

type Msg = { from: 'bot' | 'me'; text: string; key: string }

export function Bot({ ticket, onFollowUp }: {
  ticket: PublicTicket | null
  onFollowUp: (text: string) => Promise<void>
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const msgs: Msg[] = []
  if (!ticket) {
    msgs.push({ from: 'bot', text: t('botNoTicket'), key: 'hello' })
  } else {
    msgs.push({
      from: 'bot',
      key: 'latest',
      text: `${t('botLatest')} ${ticket.ref}:\n\n${ticket.reply ?? t('botReviewing')}`,
    })
    ticket.timeline
      .filter((e) => e.key === 'followup')
      .forEach((e, i) => {
        msgs.push({ from: 'me', text: e.note || '', key: `me-${i}` })
        msgs.push({ from: 'bot', text: t('botSent'), key: `ack-${i}` })
      })
  }

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [open, msgs.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    const v = text.trim()
    if (!v) return setErr(true)
    if (!ticket || busy) return
    setBusy(true)
    try {
      await onFollowUp(v.slice(0, 2000))
      setText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-40 flex h-[min(520px,calc(100vh-8rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 fade-up sm:right-6">
          <div className="flex items-center gap-2.5 bg-navy px-4 py-3 text-white">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-coral"><BotIcon size={16} /></span>
            <span className="font-semibold">{t('botTitle')}</span>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white" aria-label={t('botClose')}>
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-canvas p-4">
            {msgs.map((m) => (
              <div key={m.key} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`wrap-any max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                    m.from === 'me' ? 'rounded-br-md bg-navy text-white' : 'rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form onSubmit={send} noValidate className="border-t border-slate-200 bg-white p-3">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => { setText(e.target.value); setErr(false) }}
                disabled={!ticket}
                maxLength={2000}
                placeholder={t('botPlaceholder')}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-navy-3 focus:ring-4 focus:ring-navy/10 disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={!ticket || busy}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-coral text-white hover:bg-coral-dark disabled:opacity-50"
                aria-label={t('botSend')}
              >
                <Send size={16} />
              </button>
            </div>
            {err && <p role="alert" className="mt-1.5 text-xs text-coral-dark">{t('botEmpty')}</p>}
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('botOpen')}
        className="fixed bottom-6 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-coral text-white shadow-lg shadow-coral/30 transition hover:scale-105 hover:bg-coral-dark sm:right-6"
      >
        {open ? <X size={24} /> : <BotIcon size={26} />}
      </button>
    </>
  )
}
