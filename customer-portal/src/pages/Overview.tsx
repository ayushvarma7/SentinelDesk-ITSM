import { ArrowRight, Route as RouteIcon, Search, ShieldCheck, Sparkles, Table2, UserRound, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ADMIN_URL, listAllTickets, overview, type Overview as OverviewData } from '../api'
import { useLang } from '../i18n'

const TXT = {
  en: {
    kicker: 'AI service management for Northeastern ITS',
    title: 'Every ticket triaged in seconds. Every reply backed by evidence.',
    text: 'SentinelDesk reads incoming tickets in English and German, routes them to the right team, escalates real outages immediately, and drafts replies grounded only in how past tickets were solved.',
    stats: ['resolved tickets in the knowledge base', 'support teams routed automatically',
      'languages understood and answered', 'of tickets escalated straight to on-call'],
    cards: [
      ['Live triage', 'Paste any ticket and see type, queue, priority, confidence, latency, the gate\'s decision, cited past tickets and the draft.', 'Open triage'],
      ['Customer portal', 'Students and staff sign in, report incidents or request help, and track every ticket.', 'Open portal'],
      ['Admin portal', 'The IT queue: priority, assignment group, SLA timers, and the agent run and safety gate behind every ticket. Approve, edit or reassign.', 'Open admin console'],
    ],
    how: 'How a ticket moves through SentinelDesk',
    step: 'Step',
    steps: [
      ['Understand', 'Detect the language and mask personal data before anything else runs.'],
      ['Classify and route', 'Predict type, team and priority, each with a confidence score.'],
      ['Safety gate', 'Send outages, low-confidence and unsupported requests to a human.'],
      ['Grounded draft', 'Reply in the customer\'s language using only cited past resolutions.'],
    ],
    live: (n: number) => `${n} tickets in the service desk right now.`,
    down: 'Ticket service not running: start everything with ./run.sh app',
  },
  de: {
    kicker: 'KI-Servicemanagement für Northeastern ITS',
    title: 'Jedes Ticket in Sekunden eingeordnet. Jede Antwort belegt.',
    text: 'SentinelDesk liest eingehende Tickets auf Deutsch und Englisch, leitet sie an das richtige Team weiter, eskaliert echte Störungen sofort und entwirft Antworten nur auf Basis gelöster Fälle.',
    stats: ['gelöste Tickets in der Wissensdatenbank', 'Support-Teams automatisch zugewiesen',
      'Sprachen verstanden und beantwortet', 'der Tickets direkt an die Bereitschaft'],
    cards: [
      ['Live-Triage', 'Beliebiges Ticket einfügen: Typ, Team, Priorität, Konfidenz, Latenz, Entscheidung des Gates, zitierte Fälle und Entwurf.', 'Triage öffnen'],
      ['Kundenportal', 'Studierende und Mitarbeitende melden sich an, melden Störungen oder stellen Anfragen und verfolgen ihre Tickets.', 'Portal öffnen'],
      ['Admin-Portal', 'Die IT-Warteschlange: Priorität, Zuweisungsgruppe, SLA-Timer und der Agentenlauf mit Safety Gate hinter jedem Ticket.', 'Admin-Konsole öffnen'],
    ],
    how: 'Wie ein Ticket durch SentinelDesk läuft',
    step: 'Schritt',
    steps: [
      ['Verstehen', 'Sprache erkennen und personenbezogene Daten maskieren, bevor irgendetwas anderes läuft.'],
      ['Einordnen und zuweisen', 'Typ, Team und Priorität vorhersagen, jeweils mit Konfidenz.'],
      ['Safety Gate', 'Störungen, unsichere und nicht belegbare Anfragen an einen Menschen geben.'],
      ['Belegter Entwurf', 'In der Sprache des Kunden antworten, nur mit zitierten früheren Lösungen.'],
    ],
    live: (n: number) => `${n} Tickets aktuell im Service Desk.`,
    down: 'Ticketdienst läuft nicht: alles mit ./run.sh app starten',
  },
}

const CARD_ICONS = [<Zap size={22} />, <UserRound size={22} />, <Table2 size={22} />]
const CARD_LINKS = ['#/triage', '#/portal', ADMIN_URL]
const STEP_ICONS = [<Search size={22} />, <RouteIcon size={22} />, <ShieldCheck size={22} />, <Sparkles size={22} />]

function IconBox({ children }: { children: ReactNode }) {
  return <div className="mb-3 grid h-[42px] w-[42px] place-items-center rounded-md bg-coral text-white">{children}</div>
}

export function Overview() {
  const { lang } = useLang()
  const t = TXT[lang]
  const [kb, setKb] = useState<OverviewData | null>(null)
  const [live, setLive] = useState<number | null | undefined>(undefined)

  useEffect(() => {
    overview().then(setKb).catch(() => setKb(null))
    listAllTickets().then((x) => setLive(x.length)).catch(() => setLive(null))
  }, [])

  const stats: [number | null | undefined, string][] = [
    [kb?.kb_tickets, ''], [kb?.queues, ''], [kb?.languages, ''], [kb?.high_incident_pct, '%'],
  ]
  const card = 'rounded-lg border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-coral hover:shadow-[0_8px_22px_rgba(0,0,0,.08)]'

  return (
    <div className="fade-up">
      <section className="hero">
        <div className="kicker">{t.kicker}</div>
        <h1>{t.title}</h1>
        <p>{t.text}</p>
      </section>

      <section className="my-5 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-white lg:grid-cols-4">
        {stats.map(([n, suf], i) => (
          <div key={i} className="edge border-line px-5 py-4 [&:not(:first-child)]:border-l">
            <div className="text-[2.1rem] font-black leading-tight">{n == null ? '—' : `${n.toLocaleString('en-US')}${suf}`}</div>
            <div className="mt-1 text-sm text-muted">{t.stats[i]}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {t.cards.map(([title, desc, label], i) => {
          const external = CARD_LINKS[i].startsWith('http')
          return (
            <div key={title} className={`${card} flex flex-col`}>
              <IconBox>{CARD_ICONS[i]}</IconBox>
              <div className="mb-1 text-lg font-black">{title}</div>
              <div className="flex-1 text-[15px] leading-relaxed text-muted">{desc}</div>
              <a href={CARD_LINKS[i]} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}
                className="mt-4 inline-flex items-center gap-1.5 self-start rounded-md bg-coral px-4 py-2 text-sm font-bold text-white hover:bg-coral-dark">
                {label} <ArrowRight size={15} />
              </a>
            </div>
          )
        })}
      </section>

      <h2 className="mb-4 mt-8 text-[1.8rem] font-black leading-tight">{t.how}</h2>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {t.steps.map(([title, desc], i) => (
          <div key={title} className={card}>
            <IconBox>{STEP_ICONS[i]}</IconBox>
            <div className="text-xs font-black uppercase tracking-widest text-coral">{t.step} {i + 1}</div>
            <div className="mb-1 text-lg font-black">{title}</div>
            <div className="text-[15px] leading-relaxed text-muted">{desc}</div>
          </div>
        ))}
      </section>
      {live !== undefined && <p className="mt-5 text-sm text-muted">{live === null ? t.down : t.live(live)}</p>}
    </div>
  )
}
