// Types mirror src/sentineldesk/schema.py (TriageResult) and api/main.py (ticket record).

export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type Priority = 'high' | 'medium' | 'low'
export type Status = 'New' | 'In Progress' | 'Auto-Resolved' | 'Escalated' | 'Closed'

export interface Prediction { label: string; confidence: number; all_probs: Record<string, number> }

export interface Precedent {
  ticket_id: string; score: number; subject: string; body_snippet: string
  answer: string; language: string; queue: string
}

export interface TriageResult {
  language: string
  type: Prediction; queue: Prediction; priority: Prediction
  escalate: boolean; escalation_reasons: string[]
  precedents: Precedent[]
  draft_reply: string | null; cited_ticket_ids: string[]; unverified_claims: string[]
  masked_pii: Record<string, number>; latency_ms: Record<string, number>
  risks: string[]
  burst: { active?: boolean; related?: string[]; live_id?: string | null; max_sim?: number }
  engine: string | null
  overall_confidence: number
  status?: GateStatus
  problem?: ProblemMatch | null
}

/** Three-tier gate outcome (src/sentineldesk/gate.py decide()). */
export type GateStatus = 'AUTO_DRAFT_READY' | 'HUMAN_REVIEW' | 'ESCALATE_ONCALL'

/** This ticket's entry in the problem database (src/sentineldesk/store.py). */
export interface ProblemMatch {
  problem_id: number; is_new: boolean; title: string; occurrences: number
  status: 'open' | 'resolved'; resolution: string | null; similarity: number
  related: { problem_id: number; title: string; similarity: number; occurrences: number; status: string }[]
  log_id: number | null
}

export interface ProblemRow {
  problem_id: number; title: string; language: string; type: string; queue: string; priority: string
  occurrences: number; status: 'open' | 'resolved'; first_seen: string; last_seen: string
  resolved_by: string | null; precedent_id: string | null
}
/** A queue ticket filed under a problem (from the in-memory ticket store). */
export interface ProblemTicket {
  id: string; subject: string; status: Status; priority: Priority; created_at: string
  requester: string; email: string; assigned_to: string; queue: string
}
export interface ProblemListRow extends ProblemRow {
  queue_tickets: ProblemTicket[]; queue_ticket_count: number; people: number
}
export interface ProblemDetail extends ProblemRow {
  queue_tickets: ProblemTicket[]
  text: string; resolution: string | null; resolved_at: string | null
  tickets: { log_id: number; ts: string; similarity: number; subject: string; body: string; language: string
             status: string; priority: string; engine: string | null }[]
}
export interface DbStats { tickets_logged: number; problems: number; open_problems: number
                           resolved_problems: number; recurring_problems: number }
export interface LogRow { log_id: number; ts: string; problem_id: number | null; is_new_problem: number | null
  subject: string; language: string; type: string; queue: string; priority: string; status: string
  top1_similarity: number | null; engine: string | null; drafted: number; latency_ms: number }

export type PhaseStatus = 'done' | 'warning' | 'skipped' | 'escalated' | 'failed'
export interface Phase { phase: string; status: PhaseStatus; duration_ms: number; logs: string[] }

export interface Ticket {
  id: string; subject: string; body: string; summary: string
  requester: { name: string; email: string }
  channel: string; created_at: string; sla_due: string
  status: Status; assigned_to: string; tags: string[]
  routing?: { predicted_queue: string; rule_id: string | null; rule_name: string | null }
  priority: Priority; type: string; queue: string; language: string
  confidence: number; escalated: boolean; engine_mode: string
  gate_status?: GateStatus
  problem?: ProblemMatch | null
  triage: TriageResult; agent_trace: Phase[]
  copilot: { text: string | null; cited_ids: string[]; unverified: string[]; source: string }
  final_reply: string | null
  history: { at: string; actor: string; action: string }[]
}

export interface Metrics {
  mode: string; total: number; auto_resolved: number; escalated: number
  escalation_rate: number; avg_latency_ms: number
  by_priority: Record<string, number>; by_queue: Record<string, number>; by_status: Record<string, number>
  kpi: { high_priority_incident_recall: number | null }
  kb_tickets: number | null
  major_incident: { active: boolean; ticket_ids: string[] }
  model?: {
    n_holdout: number | null
    macro_f1: Record<'type' | 'queue' | 'priority' | 'language', number | null>
    ece: Record<'type' | 'queue' | 'priority' | 'language', number | null>
    per_language: Record<string, { n: number; type: number; queue: number; priority: number }>
    high_incident_recall_classifier: number | null
    gate: { status_share?: Record<GateStatus, number>; draft_share?: number; high_incident_escalated_by_gate?: number
            top1_same_queue?: number; median_top1_similarity?: number; cross_lingual_share_unaided?: number
            latency_ms_p50_drafted?: number }
  }
  problem_db?: DbStats | null
}

// ---------------------------------------------------------------- automation rules (api/assignment_rules.py)
export interface RuleMatch { keywords: string[]; queue: string[]; type: string[]; priority: string[]; language: string[] }
export interface RuleAction { group: string; raise_priority: '' | Priority; assignee: string }
export interface Rule { id: string; name: string; enabled: boolean; note: string; match: RuleMatch; action: RuleAction }
export interface RulesState {
  rules: Rule[]; updated_at: string | null; customised: boolean
  hits: Record<string, number>; tickets: number; groups: string[]; assignees: string[]
}
export interface RuleTest {
  predicted: { queue: string; type: string; priority: Priority; language: string }
  gate_status: GateStatus; rule: Rule | null; group: string; priority: Priority
}
export interface SweepPoint {
  critical: number | null; type: number; queue: number; priority: number
  auto_share: number; high_incident_escalated: number; auto_queue_accuracy: number; meets_rule: boolean
}
type SweepSetting = Omit<SweepPoint, 'meets_rule'>
export interface GatePolicy {
  live: { critical_score_min: number; min_confidence: Record<'type' | 'queue' | 'priority', number>
          min_top1_similarity: number; min_mean_top3_similarity: number; high_priority_threshold: number
          burst: { similarity: number; min_count: number; window_min: number } }
  sweep: { n_val: number | null; true_high_incidents: number | null; rule: string | null; n_combinations: number | null
           n_meeting_rule: number | null; chosen: SweepSetting | null; previous: SweepSetting | null }
  points: SweepPoint[]
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); if (j?.detail) msg = String(j.detail) } catch { /* not json */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => req<{ ok: boolean; mode: string; reason: string; tickets: number }>('/health'),
  tickets: (requester?: string) =>
    req<Ticket[]>('/tickets' + (requester ? `?email=${encodeURIComponent(requester)}` : '')),
  ticket: (id: string) => req<Ticket>(`/tickets/${encodeURIComponent(id)}`),
  create: (b: { subject: string; body: string; name: string; email: string; kind: string }) =>
    req<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(b) }),
  approve: (id: string, reply?: string) =>
    req<Ticket>(`/tickets/${id}/approve`, { method: 'POST', body: JSON.stringify({ agent: 'You', reply: reply ?? null }) }),
  reject: (id: string, reason?: string) =>
    req<Ticket>(`/tickets/${id}/reject`, { method: 'POST', body: JSON.stringify({ agent: 'You', reason: reason ?? null }) }),
  assign: (id: string) =>
    req<Ticket>(`/tickets/${id}/assign`, { method: 'POST', body: JSON.stringify({ agent: 'You' }) }),
  metrics: () => req<Metrics>('/metrics'),
  problems: (status?: 'open' | 'resolved') =>
    req<{ stats: DbStats; problems: ProblemListRow[] }>('/problems' + (status ? `?status=${status}` : '')),
  problem: (id: number) => req<ProblemDetail>(`/problems/${id}`),
  searchProblems: (q: string) =>
    req<{ problems: (ProblemRow & { similarity: number; same_problem: boolean; resolution: string | null })[]
          precedents: { ticket_id: string; score: number; language: string; subject: string; answer: string }[] }>(
      `/problems/search?q=${encodeURIComponent(q)}`),
  resolveProblem: (id: number, resolution: string) =>
    req<ProblemDetail>(`/problems/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution, agent: 'You' }) }),
  reopenProblem: (id: number) => req<ProblemDetail>(`/problems/${id}/reopen`, { method: 'POST', body: '{}' }),
  logs: (limit = 200) => req<LogRow[]>(`/logs?limit=${limit}`),
  rules: () => req<RulesState>('/rules'),
  saveRules: (rules: Rule[]) => req<RulesState>('/rules', { method: 'PUT', body: JSON.stringify({ rules }) }),
  resetRules: () => req<RulesState>('/rules/reset', { method: 'POST', body: '{}' }),
  testRules: (subject: string, body: string, rules: Rule[]) =>
    req<RuleTest>('/rules/test', { method: 'POST', body: JSON.stringify({ subject, body, rules }) }),
  gatePolicy: () => req<GatePolicy>('/gate/policy'),
  triage: (subject: string, body: string) =>
    req<TriageResult & { mode: string }>('/triage', { method: 'POST', body: JSON.stringify({ subject, body }) }),
}
