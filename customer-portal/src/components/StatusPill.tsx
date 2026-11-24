import { useT } from '../i18n'
import type { Status } from '../types'

const STYLE: Record<Status, string> = {
  new: 'bg-sky-50 text-sky-700 ring-sky-200',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-200',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  escalated: 'bg-coral-soft text-coral-dark ring-coral/30',
}
const DOT: Record<Status, string> = {
  new: 'bg-sky-500', in_progress: 'bg-amber-500', resolved: 'bg-emerald-500', escalated: 'bg-coral',
}

export function StatusPill({ status }: { status: Status }) {
  const t = useT()
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      {t(`st_${status}`)}
    </span>
  )
}
