export type Kind = 'incident' | 'request'
export type Status = 'new' | 'in_progress' | 'resolved' | 'escalated'
export type Urgency = '' | 'low' | 'normal' | 'high' | 'critical'

export type TimelineKey =
  | 'submitted' | 'analysed' | 'reviewing' | 'escalated' | 'assigned'
  | 'resolvedAuto' | 'resolvedAgent' | 'followup'

export interface TimelineEvent {
  at: string
  key: TimelineKey
  note?: string
}

/** Customer-safe projection. Nothing internal (confidence, precedents, reasons, PII info, queue) lives here. */
export interface PublicTicket {
  id: string          // server id, used for API calls (e.g. INC-10042)
  ref: string         // display reference (e.g. INC10042 / REQ0003)
  kind: Kind
  subject: string
  body: string
  status: Status
  createdAt: string
  reply: string | null   // only when auto-resolved or approved by an agent
  timeline: TimelineEvent[]
  source: 'api' | 'local'
}

export interface User {
  id: string        // what we send as requester email (phone -> synthetic address)
  display: string   // what the user typed
}
