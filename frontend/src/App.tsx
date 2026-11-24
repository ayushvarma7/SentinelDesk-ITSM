import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Database, LayoutList, Loader2, RotateCcw, SlidersHorizontal, WifiOff, Zap } from 'lucide-react'
import { API_BASE, api, type Metrics, type Ticket } from './api'
import { LangContext, useT, type Lang } from './i18n'
import { ToastProvider, useToast } from './toast'
import { Logo } from './components/Logo'
import Tickets from './screens/Tickets'
import Dashboard from './screens/Dashboard'
import Problems from './screens/Problems'
import Rules from './screens/Rules'

type Screen = 'tickets' | 'dashboard' | 'problems' | 'rules'

// Three near-identical VPN tickets (EN, EN, DE) inside the burst window -> the detector fires on the third.
const OUTAGE = [
  { subject: 'VPN down at Riverside clinic', body: 'The VPN keeps dropping for all staff at Riverside clinic and remote access fails. Urgent, patients are waiting.', name: 'Dr. Amir Haddad', email: 'a.haddad@riverside-health.org' },
  { subject: 'Remote access tunnel timing out', body: 'Remote access over VPN times out for the whole night shift since 10 minutes. The tunnel never comes up. Critical.', name: 'Nina Park', email: 'n.park@riverside-health.org' },
  { subject: 'VPN-Fernzugriff ausgefallen', body: 'Seit 15 Minuten ist der Fernzugriff über VPN für alle Mitarbeiter ausgefallen. Bitte dringend prüfen.', name: 'Jonas Albrecht', email: 'j.albrecht@klinikum-nord.de' },
]

function Shell() {
  const t = useT()
  const toast = useToast()
  const [screen, setScreen] = useState<Screen>('tickets')
  const [problemId, setProblemId] = useState<number | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [mode, setMode] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [down, setDown] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [replay, setReplay] = useState(0)
  const [simulating, setSimulating] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [ts, m, h] = await Promise.all([api.tickets(), api.metrics(), api.health()])
      setTickets(ts); setMetrics(m); setMode(h.mode); setDown(false)
    } catch { setDown(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { reload() }, [reload, screen])

  // Esc goes back from a ticket, unless a modal is open or the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !openId) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('[data-modal]')) return
      setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  const onUpdate = (tk: Ticket) => {
    setTickets(ts => ts.map(x => (x.id === tk.id ? tk : x)))
    api.metrics().then(setMetrics).catch(() => {})
  }

  const replayAgent = () => {
    setScreen('tickets')
    if (!openId) {
      const pick = tickets.find(x => x.status === 'Auto-Resolved') ?? tickets[0]
      if (!pick) return toast('warning', 'No tickets to replay')
      setOpenId(pick.id)
      toast('info', `Replaying agent on ${pick.id}`, pick.subject)
    } else toast('info', `Replaying agent on ${openId}`)
    setReplay(r => r + 1)
  }

  const simulateOutage = async () => {
    setSimulating(true); setScreen('tickets'); setOpenId(null)
    try {
      for (const o of OUTAGE) {
        const tk = await api.create({ ...o, kind: 'incident' })
        toast(tk.triage.burst?.active ? 'warning' : 'info', `${tk.id} created`, tk.triage.burst?.active ? 'Burst detected: major incident raised' : o.subject)
        await new Promise(r => setTimeout(r, 450))
      }
      await reload()
    } catch (e) { toast('warning', 'Simulation failed', (e as Error).message) }
    finally { setSimulating(false) }
  }

  const nav: [Screen, string, typeof LayoutList][] = [
    ['tickets', t('organisation'), LayoutList],
    ['dashboard', t('dashboard'), BarChart3],
    ['problems', 'Problems', Database],
    ['rules', 'Rules', SlidersHorizontal],
  ]

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-navy text-white shadow-lg shadow-navy/20">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-5 px-6">
          <Logo />
          <nav className="ml-2 flex h-full gap-1">
            {nav.map(([k, label, Icon]) => (
              <button key={k} onClick={() => { setScreen(k); setOpenId(null) }}
                className={`relative inline-flex h-full items-center gap-1.5 px-3 text-sm font-medium transition ${screen === k ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                <Icon size={15} />{label}
                {screen === k && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-coral" />}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1 ring-1 ring-white/10">
              <span className="hidden px-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 xl:inline">Demo</span>
              <button onClick={replayAgent} title={t('replay')} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">
                <RotateCcw size={13} /><span className="hidden xl:inline">{t('replay')}</span>
              </button>
              <button onClick={simulateOutage} disabled={simulating} title={t('simulate')} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-coral px-2.5 py-1 text-xs font-semibold text-white hover:bg-coral-dark disabled:opacity-60">
                {simulating ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}<span className="hidden xl:inline">{t('simulate')}</span>
              </button>
            </div>
            {mode && <span title={mode === 'mock' ? 'SD_MOCK=1 or artifacts missing: realistic mock data' : 'Real sentineldesk pipeline'}
              className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wider ${mode === 'mock' ? 'bg-amber-400 text-navy' : 'bg-emerald-500 text-white'}`}>
              {mode === 'mock' ? t('mock') : t('live')}</span>}
            <LangToggle />
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-3 text-[11px] font-semibold ring-2 ring-white/10">IT</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-6">
        {down && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <WifiOff size={16} />{t('apiDown')} <code className="font-mono">{API_BASE}</code> — run <code className="font-mono">./run.sh app</code>
          </div>
        )}
        {screen === 'tickets' && <Tickets kb={metrics?.kb_tickets ?? null} tickets={tickets} reload={reload} onUpdate={onUpdate} loading={loading}
          openId={openId} setOpenId={setOpenId} replay={replay} />}
        {screen === 'dashboard' && <Dashboard m={metrics} tickets={tickets} />}
        {screen === 'problems' && <Problems openId={problemId} setOpenId={setProblemId} onOpenTicket={id => { setScreen('tickets'); setOpenId(id) }} />}
        {screen === 'rules' && <Rules />}
      </main>
    </div>
  )
}

function LangToggle() {
  return (
    <LangContext.Consumer>
      {({ lang, setLang }) => (
        <div className="flex overflow-hidden rounded-md ring-1 ring-white/20">
          {(['en', 'de'] as Lang[]).map(l => (
            <button key={l} onClick={() => setLang(l)}
              className={`px-2.5 py-1 text-xs font-semibold uppercase ${lang === l ? 'bg-white text-navy' : 'text-slate-300 hover:bg-white/10'}`}>{l}</button>
          ))}
        </div>
      )}
    </LangContext.Consumer>
  )
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => { try { return (localStorage.getItem('sd_lang') as Lang) || 'en' } catch { return 'en' } })
  const set = (l: Lang) => { setLang(l); try { localStorage.setItem('sd_lang', l) } catch { /* ignore */ } }
  return (
    <LangContext.Provider value={{ lang, setLang: set }}>
      <ToastProvider><Shell /></ToastProvider>
    </LangContext.Provider>
  )
}
