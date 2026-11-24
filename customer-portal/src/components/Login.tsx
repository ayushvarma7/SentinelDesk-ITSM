import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { signIn } from '../api'
import { useLang } from '../i18n'
import type { User } from '../types'

const TXT = {
  en: {
    kicker: 'Northeastern IT Service Portal',
    title: 'IT help for students, faculty and staff',
    text: 'Report an outage, reset a password or request software. Track every ticket in one place.',
    heading: 'Sign in with your Northeastern account',
    email: 'Northeastern email', password: 'Password', button: 'Sign in',
    show: 'Show password', hide: 'Hide password',
    bad: "That email and password don't match a demo account.",
    demo: 'Demo accounts:',
  },
  de: {
    kicker: 'Northeastern IT-Serviceportal',
    title: 'IT-Hilfe für Studierende, Lehrende und Mitarbeitende',
    text: 'Störung melden, Passwort zurücksetzen oder Software anfordern. Alle Tickets an einem Ort verfolgen.',
    heading: 'Mit Ihrem Northeastern-Konto anmelden',
    email: 'Northeastern-E-Mail', password: 'Passwort', button: 'Anmelden',
    show: 'Passwort anzeigen', hide: 'Passwort verbergen',
    bad: 'E-Mail und Passwort passen zu keinem Demo-Konto.',
    demo: 'Demo-Konten:',
  },
}

const DEMOS = [['varma.ay@northeastern.edu', 'ayush'],
  ['demo@northeastern.edu', 'demo']]

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const { lang } = useLang()
  const t = TXT[lang]
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const u = signIn(email, password)
    if (!u) return setError(true)
    onLogin(u)
  }

  const field = 'w-full rounded-md border border-[#BDBDB8] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-coral focus:ring-[3px] focus:ring-coral/15'
  return (
    <div className="grid items-stretch gap-8 fade-up lg:grid-cols-[1.35fr_1fr]">
      <section className="hero flex items-center">
        <div>
          <div className="kicker">{t.kicker}</div>
          <h1>{t.title}</h1>
          <p>{t.text}</p>
        </div>
      </section>
      <div>
        <form onSubmit={submit} noValidate className="edge rounded-lg border border-line bg-white p-6">
          <h2 className="mb-5 text-xl font-black">{t.heading}</h2>
          <label htmlFor="nu-email" className="mb-1.5 block text-sm font-bold">{t.email}</label>
          <input id="nu-email" type="email" autoComplete="username" autoFocus value={email} maxLength={254}
            placeholder="husky@northeastern.edu" aria-invalid={error}
            onChange={(e) => { setEmail(e.target.value); setError(false) }} className={field} />
          <label htmlFor="nu-pw" className="mb-1.5 mt-4 block text-sm font-bold">{t.password}</label>
          <div className="relative">
            <input id="nu-pw" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
              aria-invalid={error} onChange={(e) => { setPassword(e.target.value); setError(false) }}
              className={`${field} pr-11`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t.hide : t.show}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-slate-600 hover:text-black">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm font-bold text-coral-dark">{t.bad}</p>}
          <button type="submit"
            className="mt-5 w-full rounded-md bg-coral px-4 py-2.5 text-sm font-bold text-white transition hover:bg-coral-dark">
            {t.button}
          </button>
        </form>
        <p className="mt-3 text-xs leading-6 text-muted">
          {t.demo}{' '}
          {DEMOS.map(([e, p], i) => (
            <span key={e}>
              <code className="rounded bg-coral-soft px-1 text-coral-dark">{e}</code> /{' '}
              <code className="rounded bg-coral-soft px-1 text-coral-dark">{p}</code>{i < DEMOS.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}
