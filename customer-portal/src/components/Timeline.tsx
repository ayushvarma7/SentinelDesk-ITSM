import { fmtDate, useLang, useT } from '../i18n'
import type { TimelineEvent } from '../types'

const DOT: Record<string, string> = {
  resolvedAuto: 'bg-emerald-500', resolvedAgent: 'bg-emerald-500',
  escalated: 'bg-coral', followup: 'bg-navy-3',
}

export function Timeline({ events, compact = false }: { events: TimelineEvent[]; compact?: boolean }) {
  const t = useT()
  const { lang } = useLang()
  const list = compact ? events.slice(-3) : events
  return (
    <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
      {list.map((e, i) => (
        <li key={`${e.at}-${e.key}-${i}`} className="relative">
          <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${DOT[e.key] ?? 'bg-slate-400'}`} />
          <div className="text-sm font-medium text-slate-800">{t(`tl_${e.key}`)}</div>
          <div className="text-xs text-slate-500">{fmtDate(e.at, lang)}</div>
          {e.note && !compact && (
            <p className="wrap-any mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{e.note}</p>
          )}
        </li>
      ))}
    </ol>
  )
}
