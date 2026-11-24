// Where a ticket sits in the problem database (src/sentineldesk/store.py, served by api/main.py).
// New problem -> added to the database; known problem -> how often it was reported, its status and
// earlier resolution; plus the most related problems already stored.
import { Database, History } from 'lucide-react'
import type { Ticket } from '../api'
import { Card } from '../ui'

export default function ProblemCard({ ticket, onOpenProblem }: { ticket: Ticket; onOpenProblem?: (id: number) => void }) {
  const p = ticket.problem ?? ticket.triage.problem
  if (!p) return null
  const tone = p.is_new
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : p.status === 'resolved'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : p.occurrences >= 3 ? 'border-red-200 bg-red-50 text-red-900' : 'border-sky-200 bg-sky-50 text-sky-900'
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <Database size={12} />Problem database
      </div>
      <div className={`rounded-lg border px-4 py-3 text-sm ${tone}`}>
        {p.is_new ? (
          <>New problem: added to the problem database as <b>#{p.problem_id}</b>.</>
        ) : (
          <>Known problem <b>#{p.problem_id}</b> ({p.status === 'resolved' ? 'resolved' : 'still open'}),
            reported <b>{p.occurrences}×</b>. Closest match {p.similarity.toFixed(2)}.</>
        )}
        {onOpenProblem && (
          <button onClick={() => onOpenProblem(p.problem_id)} className="ml-2 font-semibold underline">Open</button>
        )}
      </div>
      {p.resolution && (
        <p className="mt-3 flex gap-2 text-sm text-slate-700">
          <History size={14} className="mt-0.5 shrink-0 text-slate-400" />
          <span><span className="font-medium">Earlier resolution:</span> {p.resolution}</span>
        </p>
      )}
      {p.related.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-slate-500">Most related problems already in the database</div>
          <ul className="space-y-1 text-sm">
            {p.related.map(r => (
              <li key={r.problem_id} className="flex items-center justify-between gap-3 rounded border border-slate-100 px-3 py-1.5">
                <span className="truncate">#{r.problem_id} {r.title}</span>
                <span className="shrink-0 font-mono text-xs text-slate-500">{r.similarity.toFixed(2)} · {r.occurrences}× · {r.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
