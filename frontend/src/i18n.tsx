import { createContext, useContext } from 'react'

export type Lang = 'en' | 'de'

const DICT = {
  en: {
    tickets: 'Tickets', organisation: 'Organisation', portal: 'Customer Portal', dashboard: 'Dashboard',
    id: 'ID', summary: 'Summary', priority: 'Priority', type: 'Type', queue: 'Queue', date: 'Date',
    status: 'Status', assigned: 'Assigned To', tags: 'Tags', confidence: 'Confidence',

    high: 'High', medium: 'Medium', low: 'Low', refresh: 'Refresh', results: 'tickets',
    majorIncident: 'Major incident detected', majorIncidentSub: 'similar tickets within 30 minutes — on-call paged',
    back: 'Back to tickets', needsYou: 'High priority — needs you', needsReview: 'Escalated — needs your review',
    raisedBy: 'Raised by', language: 'Language', sla: 'SLA', slaLeft: 'left', slaBreached: 'SLA breached',
    escalationReasons: 'Why it was escalated', recommended: 'Recommended resolution',
    approve: 'Approve & Send', edit: 'Edit draft', assignMe: 'Assign to me', reject: 'Reject', save: 'Done editing',
    piiMasked: 'PII masked', unverified: 'Unverified claim', handledByAgent: 'Handled by agent',
    finalReply: 'Reply sent to customer', draftReply: 'Drafted reply',
    precedents: 'Precedents', override: 'Override', similarity: 'Similarity', answer: 'Resolution',
    ticketBody: 'Customer message', details: 'Details', incId: 'INC ID', name: 'Name', state: 'State',
    created: 'Created', channel: 'Channel', history: 'Activity', noDraft: 'No suggestion available — write a reply manually.',




    subject: 'Subject', body: 'Describe the issue',




    total: 'Total tickets',

    autoResolved: 'Auto-resolved', escalated: 'Escalated',
    holdout: 'holdout, predicted high + Incident',
    mock: 'MOCK', live: 'LIVE', apiDown: 'API not reachable at',
    qAll: 'All', qNeedsMe: 'Needs me', qAuto: 'Auto-handled', qMajor: 'Major incident', qSla: 'SLA < 1h',
    replay: 'Replay agent', simulate: 'Simulate outage',
    orgSub: 'Northeastern ITS service desk', openTickets: 'Open tickets', escalatedK: 'Escalated', p1Open: 'P1 open', kbK: 'Knowledge base',
    searchInc: 'Search INC or summary', pCol: 'P', incCol: 'INC', deptCol: 'Assigned to (Dept)', tagType: 'Tag / Type', slaCol: 'SLA',
    dashTitle: 'Operations dashboard', dashSub: 'Ticket volume, urgency and routing patterns, plus how well the models perform',
    dTickets: 'tickets', dHigh: 'high priority', dHighInc: 'high-priority incidents, escalated to on-call', dGerman: 'German tickets',
    workGoes: 'Where the work goes', volTeam: 'Volume by team and priority', typePrio: 'Type by priority (share of all tickets)',
    typeLang: 'Ticket types by language', topTags: 'Most common issue tags', modelPerf: 'Model performance on the 20% holdout',
    liveOps: 'Live portal tickets', escOnCall: 'Escalated to on-call', medLat: 'Median latency', p95Lat: 'p95 latency',
    latP95: 'Latency p95', hpRecall: 'High-priority incident recall', share: 'Share', ticketsAxis: 'Tickets', priorityL: 'Priority',
    noConfusion: 'No confusion matrix yet. GET /metrics does not expose it; the scores appear here when it does.',
    kbHint: 'Resolved tickets available as precedents',
  },
  de: {
    tickets: 'Tickets', organisation: 'Organisation', portal: 'Kundenportal', dashboard: 'Dashboard',
    id: 'ID', summary: 'Zusammenfassung', priority: 'Priorität', type: 'Typ', queue: 'Warteschlange', date: 'Datum',
    status: 'Status', assigned: 'Zugewiesen an', tags: 'Tags', confidence: 'Konfidenz',

    high: 'Hoch', medium: 'Mittel', low: 'Niedrig', refresh: 'Aktualisieren', results: 'Tickets',
    majorIncident: 'Größere Störung erkannt', majorIncidentSub: 'ähnliche Tickets in 30 Minuten — Bereitschaft alarmiert',
    back: 'Zurück zu Tickets', needsYou: 'Hohe Priorität — Sie werden gebraucht', needsReview: 'Eskaliert — bitte prüfen',
    raisedBy: 'Gemeldet von', language: 'Sprache', sla: 'SLA', slaLeft: 'übrig', slaBreached: 'SLA verletzt',
    escalationReasons: 'Grund der Eskalation', recommended: 'Empfohlene Lösung',
    approve: 'Freigeben & senden', edit: 'Entwurf bearbeiten', assignMe: 'Mir zuweisen', reject: 'Ablehnen', save: 'Fertig',
    piiMasked: 'PII maskiert', unverified: 'Nicht belegte Aussage', handledByAgent: 'Vom Agenten bearbeitet',
    finalReply: 'An Kunden gesendete Antwort', draftReply: 'Antwortentwurf',
    precedents: 'Präzedenzfälle', override: 'Übersteuern', similarity: 'Ähnlichkeit', answer: 'Lösung',
    ticketBody: 'Kundennachricht', details: 'Details', incId: 'INC-ID', name: 'Name', state: 'Status',
    created: 'Erstellt', channel: 'Kanal', history: 'Aktivität', noDraft: 'Kein Vorschlag — bitte manuell antworten.',




    subject: 'Betreff', body: 'Beschreiben Sie das Problem',




    total: 'Tickets gesamt',

    autoResolved: 'Automatisch gelöst', escalated: 'Eskaliert',
    holdout: 'Holdout, hoch + Incident vorhergesagt',
    mock: 'MOCK', live: 'LIVE', apiDown: 'API nicht erreichbar unter',
    qAll: 'Alle', qNeedsMe: 'Braucht mich', qAuto: 'Automatisch', qMajor: 'Größere Störung', qSla: 'SLA < 1 Std.',
    replay: 'Agent abspielen', simulate: 'Ausfall simulieren',
    orgSub: 'Northeastern ITS Service Desk', openTickets: 'Offene Tickets', escalatedK: 'Eskaliert', p1Open: 'P1 offen', kbK: 'Wissensbasis',
    searchInc: 'INC oder Zusammenfassung suchen', pCol: 'P', incCol: 'INC', deptCol: 'Zugewiesen an (Abt.)', tagType: 'Tag / Typ', slaCol: 'SLA',
    dashTitle: 'Betriebs-Dashboard', dashSub: 'Ticketvolumen, Dringlichkeit und Routing sowie die Qualität der Modelle',
    dTickets: 'Tickets', dHigh: 'hohe Priorität', dHighInc: 'kritische Störungen, an Bereitschaft eskaliert', dGerman: 'deutsche Tickets',
    workGoes: 'Wohin die Arbeit geht', volTeam: 'Volumen nach Team und Priorität', typePrio: 'Typ nach Priorität (Anteil aller Tickets)',
    typeLang: 'Tickettypen nach Sprache', topTags: 'Häufigste Themen-Tags', modelPerf: 'Modellqualität auf dem 20%-Holdout',
    liveOps: 'Live-Portaltickets', escOnCall: 'An Bereitschaft eskaliert', medLat: 'Median-Latenz', p95Lat: 'p95-Latenz',
    latP95: 'Latenz p95', hpRecall: 'Recall kritischer Störungen', share: 'Anteil', ticketsAxis: 'Tickets', priorityL: 'Priorität',
    noConfusion: 'Noch keine Konfusionsmatrix. GET /metrics liefert sie nicht; die Werte erscheinen hier, sobald verfügbar.',
    kbHint: 'Gelöste Tickets, die als Präzedenzfälle dienen',
  },
} as const

export type Key = keyof typeof DICT.en
export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} })

export function useT() {
  const { lang } = useContext(LangContext)
  return (k: Key) => DICT[lang][k] ?? DICT.en[k]
}

export const STATUS_DE: Record<string, string> = {
  New: 'Neu', 'In Progress': 'In Bearbeitung', 'Auto-Resolved': 'Automatisch gelöst', Escalated: 'Eskaliert', Closed: 'Geschlossen',
}
