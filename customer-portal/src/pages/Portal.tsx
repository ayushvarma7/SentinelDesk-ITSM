import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createApiTicket, ensureMockSeed, health, listAllTickets, listApiTickets, mockCreate, mockList, sendFollowUp,
  serviceOutage, type NewTicket,
} from '../api'
import { Bot } from '../components/Bot'
import { Confirmation } from '../components/Confirmation'
import { Home } from '../components/Home'
import { Login } from '../components/Login'
import { Sidebar } from '../components/Sidebar'
import { TicketDetail } from '../components/TicketDetail'
import { TicketForm } from '../components/TicketForm'
import { DICT, useLang } from '../i18n'
import type { Kind, PublicTicket, User } from '../types'

type View =
  | { name: 'home' }
  | { name: 'form'; kind: Kind }
  | { name: 'confirm'; id: string; notice: string | null }
  | { name: 'detail'; id: string }

const POLL_MS = 5000

/** Customer portal: Northeastern sign-in, then report an incident, make a request, follow your tickets.
 *  Tickets go to the same API the admin console (:5173) reads. */
export function Portal({ user, onLogin, onOffline }: {
  user: User | null
  onLogin: (u: User) => void
  onOffline: (off: boolean) => void
}) {
  const { lang } = useLang()
  const [offline, setOffline] = useState(false)
  const [outage, setOutage] = useState(false)
  const [tickets, setTickets] = useState<PublicTicket[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ name: 'home' })
  const [query, setQuery] = useState('')
  // Fallback copy of the ticket just created, in case an in-flight poll returns a list without it.
  const [lastCreated, setLastCreated] = useState<PublicTicket | null>(null)

  const refresh = useCallback(async (u: User): Promise<PublicTicket[]> => {
    let fromApi: PublicTicket[] = []
    let off = !(await health())
    if (!off) {
      try {
        fromApi = await listApiTickets(u)
        setOutage(serviceOutage(await listAllTickets()))
      } catch {
        off = true
      }
    }
    if (off) ensureMockSeed(u)
    const all = [...fromApi, ...mockList(u, off)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    setOffline(off)
    onOffline(off)
    setTickets(all)
    return all
  }, [onOffline])

  useEffect(() => {
    if (!user) return
    let alive = true
    const tick = () => { if (alive) void refresh(user) }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [user, refresh])

  // Signing out (user -> null) resets the portal.
  useEffect(() => {
    if (user) return
    setTickets([]); setSelectedId(null); setLastCreated(null); setQuery(''); setView({ name: 'home' })
  }, [user])

  const find = useCallback(
    (id: string | null) => (id ? tickets.find((x) => x.id === id) ?? (lastCreated?.id === id ? lastCreated : null) : null),
    [tickets, lastCreated],
  )
  const selected = useMemo(() => find(selectedId), [find, selectedId])
  const viewTicket = useMemo(
    () => (view.name === 'detail' || view.name === 'confirm' ? find(view.id) : null),
    [find, view],
  )

  if (!user) return <Login onLogin={onLogin} />

  async function submit(nt: NewTicket) {
    if (!user) return
    let created: PublicTicket
    let notice: string | null = null
    if (offline) {
      created = mockCreate(user, nt)
    } else {
      try {
        created = await createApiTicket(user, nt)
      } catch {
        created = mockCreate(user, nt)
        notice = DICT[lang].submitError
      }
    }
    setLastCreated(created)
    await refresh(user)
    setSelectedId(created.id)
    setView({ name: 'confirm', id: created.id, notice })
  }

  async function followUp(text: string) {
    if (!user || !selected) return
    await sendFollowUp(selected, user, text)
    await refresh(user)
  }

  function open(id: string) {
    setSelectedId(id)
    setView({ name: 'detail', id })
  }

  let main
  if (view.name === 'form') {
    main = <TicketForm key={view.kind} kind={view.kind} onCancel={() => setView({ name: 'home' })} onSubmit={submit} />
  } else if ((view.name === 'confirm' || view.name === 'detail') && viewTicket) {
    main = view.name === 'confirm'
      ? <Confirmation ticket={viewTicket} notice={view.notice} onView={() => open(viewTicket.id)} onHome={() => setView({ name: 'home' })} />
      : <TicketDetail key={viewTicket.id} ticket={viewTicket} onBack={() => setView({ name: 'home' })} />
  } else {
    main = (
      <Home
        name={user.display}
        outage={outage}
        query={query}
        setQuery={setQuery}
        tickets={tickets}
        onNew={(kind) => setView({ name: 'form', kind })}
        onOpen={open}
      />
    )
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">{main}</div>
        <Sidebar tickets={tickets} selected={selected} onSelect={setSelectedId} onOpen={open} />
      </div>
      <Bot ticket={selected} onFollowUp={followUp} />
    </>
  )
}
