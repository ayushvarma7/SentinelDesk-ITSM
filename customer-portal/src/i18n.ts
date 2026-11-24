import { createContext, useContext } from 'react'

export type Lang = 'en' | 'de'

const en = {
  brand: 'SentinelDesk Support',
  offline: 'Offline demo mode',
  offlineTip: 'The support server is not reachable. Tickets are stored in this browser for the demo.',
  signOut: 'Sign out',
  // login







  // home
  hello: 'How can we help you today?',
  helloSub: 'Report a problem or ask for something. We reply in the language you write in.',
  searchPlaceholder: 'Search your tickets by number, subject or text…',
  searchResults: 'Search results',
  searchNone: 'No tickets match your search.',
  incidentTitle: 'Report an Incident',
  incidentSub: 'Something is broken or not working as expected.',
  requestTitle: 'Make a Request',
  requestSub: 'You need access, software, information or a change.',
  // form
  formIncident: 'Report an Incident',
  formRequest: 'Make a Request',
  subject: 'Subject',
  optional: 'optional',
  subjectPlaceholder: 'A short summary, e.g. "VPN disconnects every few minutes"',
  description: 'Description',
  descriptionPlaceholder: 'What happened? What did you expect? English or German is fine.',
  descriptionRequired: 'Please describe your issue so we can help.',
  urgency: 'How urgent is it?',
  urgencyNone: 'Not sure',
  urgencyLow: 'Low – no rush',
  urgencyNormal: 'Normal',
  urgencyHigh: 'High – it blocks my work',
  urgencyCritical: 'Critical – many people are affected',
  submit: 'Submit',
  submitting: 'Submitting…',
  cancel: 'Cancel',
  chars: 'characters',
  submitError: 'We could not reach the server, so your ticket was saved in demo mode.',
  // confirmation
  confirmTitle: 'Thank you – we received your ticket',
  confirmRef: 'Your ticket number',
  confirmSub: 'Keep this number for reference. You can follow the progress in My History.',
  viewTicket: 'View ticket',
  backHome: 'Back to home',
  // statuses
  st_new: 'New',
  st_in_progress: 'In Progress',
  st_resolved: 'Resolved',
  st_escalated: 'Escalated',
  // history + status panel
  myHistory: 'My History',
  noTickets: 'You have no tickets yet.',
  statusPanel: 'Status',
  selectTicket: 'Select a ticket to see its status.',
  lastUpdate: 'Last update',
  // detail
  back: 'Back',
  yourMessage: 'Your message',
  timeline: 'Progress',
  reply: 'Our reply',
  reviewing: 'An engineer is reviewing your ticket.',
  reviewingSub: 'We will update this page as soon as there is an answer.',
  showMore: 'Show more',
  showLess: 'Show less',
  noSubject: '(no subject)',
  incident: 'Incident',
  request: 'Request',
  // timeline events
  tl_submitted: 'Ticket submitted',
  tl_analysed: 'Checked by our support assistant',
  tl_reviewing: 'Passed to our support team',
  tl_escalated: 'Escalated to a specialist engineer',
  tl_assigned: 'An engineer is working on it',
  tl_resolvedAuto: 'Answer sent',
  tl_resolvedAgent: 'Answer sent by our support team',
  tl_followup: 'You sent a follow-up',
  // bot
  botTitle: 'Support Assistant',
  botOpen: 'Open support assistant',
  botClose: 'Close',
  botNoTicket: 'Hi! Select a ticket in My History and I will show you the latest update.',
  botLatest: 'Latest update for',
  botReviewing: 'An engineer is reviewing your ticket. I will show the answer here as soon as it is ready.',
  botPlaceholder: 'Ask a follow-up question…',
  botSend: 'Send',
  botSent: 'Follow-up sent to support.',
  botEmpty: 'Please type a message first.',
}

export type Key = keyof typeof en

const de: Record<Key, string> = {
  brand: 'SentinelDesk Support',
  offline: 'Offline-Demomodus',
  offlineTip: 'Der Support-Server ist nicht erreichbar. Tickets werden für die Demo in diesem Browser gespeichert.',
  signOut: 'Abmelden',







  hello: 'Wie können wir Ihnen heute helfen?',
  helloSub: 'Melden Sie ein Problem oder stellen Sie eine Anfrage. Wir antworten in Ihrer Sprache.',
  searchPlaceholder: 'Tickets nach Nummer, Betreff oder Text durchsuchen…',
  searchResults: 'Suchergebnisse',
  searchNone: 'Keine Tickets gefunden.',
  incidentTitle: 'Störung melden',
  incidentSub: 'Etwas ist defekt oder funktioniert nicht wie erwartet.',
  requestTitle: 'Anfrage stellen',
  requestSub: 'Sie benötigen Zugang, Software, Informationen oder eine Änderung.',
  formIncident: 'Störung melden',
  formRequest: 'Anfrage stellen',
  subject: 'Betreff',
  optional: 'optional',
  subjectPlaceholder: 'Kurze Zusammenfassung, z. B. „VPN bricht ständig ab“',
  description: 'Beschreibung',
  descriptionPlaceholder: 'Was ist passiert? Was haben Sie erwartet? Deutsch oder Englisch.',
  descriptionRequired: 'Bitte beschreiben Sie Ihr Anliegen, damit wir helfen können.',
  urgency: 'Wie dringend ist es?',
  urgencyNone: 'Weiß nicht',
  urgencyLow: 'Niedrig – keine Eile',
  urgencyNormal: 'Normal',
  urgencyHigh: 'Hoch – blockiert meine Arbeit',
  urgencyCritical: 'Kritisch – viele Personen betroffen',
  submit: 'Absenden',
  submitting: 'Wird gesendet…',
  cancel: 'Abbrechen',
  chars: 'Zeichen',
  submitError: 'Der Server war nicht erreichbar. Ihr Ticket wurde im Demomodus gespeichert.',
  confirmTitle: 'Vielen Dank – wir haben Ihr Ticket erhalten',
  confirmRef: 'Ihre Ticketnummer',
  confirmSub: 'Bitte notieren Sie diese Nummer. Den Fortschritt sehen Sie unter „Mein Verlauf“.',
  viewTicket: 'Ticket ansehen',
  backHome: 'Zur Startseite',
  st_new: 'Neu',
  st_in_progress: 'In Bearbeitung',
  st_resolved: 'Gelöst',
  st_escalated: 'Eskaliert',
  myHistory: 'Mein Verlauf',
  noTickets: 'Sie haben noch keine Tickets.',
  statusPanel: 'Status',
  selectTicket: 'Wählen Sie ein Ticket, um den Status zu sehen.',
  lastUpdate: 'Letzte Aktualisierung',
  back: 'Zurück',
  yourMessage: 'Ihre Nachricht',
  timeline: 'Fortschritt',
  reply: 'Unsere Antwort',
  reviewing: 'Ein Techniker prüft Ihr Ticket.',
  reviewingSub: 'Wir aktualisieren diese Seite, sobald eine Antwort vorliegt.',
  showMore: 'Mehr anzeigen',
  showLess: 'Weniger anzeigen',
  noSubject: '(kein Betreff)',
  incident: 'Störung',
  request: 'Anfrage',
  tl_submitted: 'Ticket eingereicht',
  tl_analysed: 'Von unserem Support-Assistenten geprüft',
  tl_reviewing: 'An unser Support-Team übergeben',
  tl_escalated: 'An einen Fachexperten eskaliert',
  tl_assigned: 'Ein Techniker bearbeitet Ihr Ticket',
  tl_resolvedAuto: 'Antwort gesendet',
  tl_resolvedAgent: 'Antwort von unserem Support-Team gesendet',
  tl_followup: 'Sie haben eine Rückfrage gesendet',
  botTitle: 'Support-Assistent',
  botOpen: 'Support-Assistent öffnen',
  botClose: 'Schließen',
  botNoTicket: 'Hallo! Wählen Sie ein Ticket in „Mein Verlauf“, dann zeige ich Ihnen den aktuellen Stand.',
  botLatest: 'Aktueller Stand für',
  botReviewing: 'Ein Techniker prüft Ihr Ticket. Die Antwort erscheint hier, sobald sie vorliegt.',
  botPlaceholder: 'Rückfrage stellen…',
  botSend: 'Senden',
  botSent: 'Rückfrage an den Support gesendet.',
  botEmpty: 'Bitte geben Sie zuerst eine Nachricht ein.',
}

export const DICT: Record<Lang, Record<Key, string>> = { en, de }

export const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'en',
  setLang: () => {},
})

export function useT() {
  const { lang } = useContext(LangCtx)
  return (k: Key) => DICT[lang][k] ?? DICT.en[k] ?? k
}

export function useLang() {
  return useContext(LangCtx)
}

export function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
