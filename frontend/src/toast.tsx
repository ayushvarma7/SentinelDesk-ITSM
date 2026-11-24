import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

type Kind = 'success' | 'info' | 'warning'
interface Toast { id: number; kind: Kind; title: string; body?: string }

const Ctx = createContext<(kind: Kind, title: string, body?: string) => void>(() => {})
export const useToast = () => useContext(Ctx)

const ICON = {
  success: <CheckCircle2 size={18} className="text-teal-400" />,
  info: <Info size={18} className="text-sky-300" />,
  warning: <AlertTriangle size={18} className="text-amber-400" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t.slice(-3), { id, kind, title, body }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[340px] flex-col gap-2" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className="toast-in pointer-events-auto flex items-start gap-3 rounded-xl bg-navy px-4 py-3 text-white shadow-2xl ring-1 ring-white/10">
            <span className="mt-0.5">{ICON[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-slate-300">{t.body}</div>}
            </div>
            <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} className="text-slate-400 hover:text-white" aria-label="dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
