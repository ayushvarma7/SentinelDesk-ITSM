import { LifeBuoy, LogOut, UserRound, WifiOff } from 'lucide-react'
import { useLang, useT } from '../i18n'
import type { User } from '../types'

export function LangToggle({ dark = true }: { dark?: boolean }) {
  const { lang, setLang } = useLang()
  const base = dark ? 'bg-white/10 ring-white/15' : 'bg-slate-100 ring-slate-200'
  return (
    <div className={`inline-flex rounded-full p-0.5 ring-1 ${base}`} role="group" aria-label="Language">
      {(['en', 'de'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase transition ${
            lang === l ? 'bg-coral text-white shadow-sm' : dark ? 'text-white/70 hover:text-white' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export function OfflineChip() {
  const t = useT()
  return (
    <span
      title={t('offlineTip')}
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 ring-1 ring-amber-300"
    >
      <WifiOff size={12} /> {t('offline')}
    </span>
  )
}

export function Header({ user, offline, onHome, onSignOut }: {
  user: User
  offline: boolean
  onHome: () => void
  onSignOut: () => void
}) {
  const t = useT()
  return (
    <header className="sticky top-0 z-30 bg-navy text-white shadow-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <button type="button" onClick={onHome} className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-coral shadow-sm">
            <LifeBuoy size={20} />
          </span>
          <span className="hidden sm:inline">{t('brand')}</span>
        </button>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {offline && <OfflineChip />}
          <span className="hidden max-w-[220px] items-center gap-1.5 truncate text-sm text-white/80 md:inline-flex">
            <UserRound size={15} /> <span className="truncate">{user.display}</span>
          </span>
          <LangToggle />
          <button
            type="button"
            onClick={onSignOut}
            title={t('signOut')}
            className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  )
}
