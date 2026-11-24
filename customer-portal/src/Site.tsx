import { ExternalLink, LayoutGrid, LogOut, ShieldCheck, Ticket, Zap } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ADMIN_URL } from './api'
import { OfflineChip, LangToggle } from './components/Header'
import { LangCtx, type Lang } from './i18n'
import { Overview } from './pages/Overview'
import { Portal } from './pages/Portal'
import { Triage } from './pages/Triage'
import type { User } from './types'


export type Route = 'overview' | 'triage' | 'portal'
const ROUTES: Record<string, Route> = { '': 'overview', '#/': 'overview', '#/triage': 'triage', '#/portal': 'portal' }
const routeFromHash = (): Route => ROUTES[window.location.hash] ?? 'overview'

const NAV_TXT = {
  en: { overview: 'Overview', triage: 'Live triage', portal: 'Customer portal', admin: 'Admin portal', signOut: 'Sign out' },
  de: { overview: 'Übersicht', triage: 'Live-Triage', portal: 'Kundenportal', admin: 'Admin-Portal', signOut: 'Abmelden' },
}

function initialLang(): Lang {
  try {
    const v = localStorage.getItem('sd-portal-lang')
    if (v === 'en' || v === 'de') return v
  } catch { /* ignore */ }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export default function Site() {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [user, setUser] = useState<User | null>(null) // demo sign-in: React state only, gone on reload
  const [offline, setOffline] = useState(false)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem('sd-portal-lang', l) } catch { /* ignore */ }
  }, [])

  useEffect(() => { document.documentElement.lang = lang }, [lang])
  useEffect(() => {
    const on = () => { setRoute(routeFromHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const n = NAV_TXT[lang]
  const nav: [Route, string, ReactNode][] = [
    ['overview', n.overview, <LayoutGrid size={18} />],
    ['triage', n.triage, <Zap size={18} />],
    ['portal', n.portal, <Ticket size={18} />],
  ]
  const item = 'flex items-center gap-3 rounded border-l-4 px-3 py-2 text-[15px] transition'
  const initials = user ? user.display.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() : ''

  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="bg-navy text-[#E8E8E6] lg:sticky lg:top-0 lg:h-screen lg:border-r-4 lg:border-coral max-lg:border-b-4 max-lg:border-coral">
          <div className="flex items-center gap-4 px-4 py-4 lg:block lg:px-5 lg:py-6">
            <a href="#/" aria-label="SentinelDesk home" className="shrink-0">
              <img src="/logo.svg" alt="SentinelDesk" className="h-8 w-auto lg:h-9" />
            </a>
            <nav className="flex gap-1 overflow-x-auto lg:mt-8 lg:flex-col" aria-label="Main">
              {nav.map(([r, label, icon]) => {
                const on = route === r
                return (
                  <a key={r} href={r === 'overview' ? '#/' : `#/${r}`} aria-current={on ? 'page' : undefined}
                    className={`${item} whitespace-nowrap ${on ? 'border-coral bg-coral/20 font-bold text-white' : 'border-transparent hover:bg-white/5'}`}>
                    <span className={on ? 'text-white' : 'text-coral'}>{icon}</span>{label}
                  </a>
                )
              })}
              <a href={ADMIN_URL} target="_blank" rel="noreferrer"
                className={`${item} whitespace-nowrap border-transparent hover:bg-white/5`}>
                <span className="text-coral"><ShieldCheck size={18} /></span>{n.admin}
                <ExternalLink size={13} className="ml-auto opacity-60" />
              </a>
            </nav>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mx-auto max-w-[1360px] px-4 pb-16 pt-5 sm:px-8">
            <div className="mb-5 flex items-center justify-end gap-3">
              {offline && route === 'portal' && <OfflineChip />}
              <LangToggle dark={false} />
              {user && (
                <>
                  <button type="button" onClick={() => setUser(null)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-black bg-white px-3 py-1.5 text-sm font-bold hover:border-coral hover:text-coral">
                    <LogOut size={15} />{n.signOut}
                  </button>
                  <span title={user.display}
                    className="grid h-10 w-10 place-items-center rounded-full border-2 border-black bg-coral text-sm font-black text-white">
                    {initials}
                  </span>
                </>
              )}
            </div>
            {route === 'overview' && <Overview />}
            {route === 'triage' && <Triage />}
            {route === 'portal' && <Portal user={user} onLogin={setUser} onOffline={setOffline} />}
          </div>
        </div>
      </div>
    </LangCtx.Provider>
  )
}
