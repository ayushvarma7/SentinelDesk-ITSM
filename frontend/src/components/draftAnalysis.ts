// Client-side "grammar check" for grounded replies. Pure functions, no React.
import type { Precedent } from '../api'

export type IssueKind = 'unverified' | 'missing' | 'invalid' | 'pii'
export interface Issue {
  key: string
  kind: IssueKind
  title: string
  detail: string
  start: number        // range in the text (start === end for an insertion point)
  end: number
  blocking: boolean    // amber/red issues block Approve & Send until accepted or dismissed
  phrase?: string
  token?: string
}

export interface Analysis {
  issues: Issue[]          // open issues (dismissed ones removed)
  citations: { id: string; start: number; end: number; valid: boolean }[]
  pii: { token: string; start: number; end: number }[]
  factual: number
  cited: number
  grounding: number        // 0-100
}

// Fresh global regex per matchAll (matchAll inherits lastIndex); HAS_CITE is non-global for .test().
const citeRe = () => /\[((?:TKT|LIVE)-\d{5})\]/g
const HAS_CITE = /\[(?:TKT|LIVE)-\d{5}\]/
const PII_RE = /<(email|tel_num|acc_num|ip_address|name)>/g
const COURTESY = /^(thank|thanks|sorry|we apologi[sz]e|vielen dank|danke|es tut uns leid|wir entschuldigen)/i
const NON_CLAIM_START = /^(we are|we will|we'll|we can|please|if|bitte|falls|wir prüfen|wir planen|wir stellen|wir melden)/i
const CLAIM = /\b(was|were|caused|resolved|replaced|rotated|fixed|fixes|identified|restored|voided|returned|corrupted|expired|held|whitelisted|unlocked|issued|scheduled|wurde|wurden|war|ersetzt|behoben|storniert|gutgeschrieben|ursache|entsperrt|abgelaufen)\b/i
const MONEY = /\b(credit\w*|refund\w*|compensat\w*|erstatt\w*|gutschrift\w*|entschädig\w*)/i

export interface Sentence { start: number; end: number; text: string }

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if ('.!?'.includes(c) && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      out.push({ start, end: i + 1, text: text.slice(start, i + 1) })
      start = i + 1
    }
  }
  if (text.slice(start).trim()) out.push({ start, end: text.length, text: text.slice(start) })
  // trim leading whitespace into the range so highlights line up
  return out.map(s => {
    const lead = s.text.length - s.text.trimStart().length
    return { start: s.start + lead, end: s.end, text: s.text.trim() }
  }).filter(s => s.text)
}

/** A sentence states a fact or a money commitment, so it should carry a citation. */
export function isFactual(s: string): boolean {
  const t = s.trim()
  if (MONEY.test(t)) return true
  if (COURTESY.test(t) || NON_CLAIM_START.test(t)) return false
  return CLAIM.test(t)
}

export const PII_FRIENDLY: Record<string, { en: string; de: string }> = {
  email: { en: 'your email address', de: 'Ihre E-Mail-Adresse' },
  tel_num: { en: 'your phone number', de: 'Ihre Telefonnummer' },
  acc_num: { en: 'your account', de: 'Ihr Konto' },
  ip_address: { en: 'the affected IP address', de: 'die betroffene IP-Adresse' },
  name: { en: 'there', de: '' },
}

export function analyze(text: string, precedents: Precedent[], unverified: string[], dismissed: Set<string>): Analysis {
  const ids = new Set(precedents.map(p => p.ticket_id))
  const citations = [...text.matchAll(citeRe())].map(m => ({ id: m[1], start: m.index!, end: m.index! + m[0].length, valid: ids.has(m[1]) }))
  const pii = [...text.matchAll(PII_RE)].map(m => ({ token: m[0], start: m.index!, end: m.index! + m[0].length }))
  const issues: Issue[] = []

  for (const phrase of [...new Set(unverified)]) {
    let idx = text.indexOf(phrase)
    if (idx < 0) idx = text.toLowerCase().indexOf(phrase.toLowerCase())
    if (idx < 0) continue
    issues.push({
      key: `unv:${phrase}`, kind: 'unverified', blocking: true, phrase,
      title: `“${phrase}” is not in any precedent`,
      detail: 'Not found in any precedent — remove or verify. Accept removes it.',
      start: idx, end: idx + phrase.length,
    })
  }
  for (const c of citations.filter(c => !c.valid)) {
    issues.push({
      key: `bad:${c.id}`, kind: 'invalid', blocking: true, title: `${c.id} was not retrieved`,
      detail: 'Citation is not in the retrieved precedent set. Accept removes it.', start: c.start, end: c.end,
    })
  }

  const sentences = splitSentences(text)
  let factual = 0, cited = 0
  for (const s of sentences) {
    if (!isFactual(s.text)) continue
    factual++
    if (HAS_CITE.test(s.text)) { cited++; continue }
    let at = s.end
    while (at > s.start && /\s/.test(text[at - 1])) at--
    if ('.!?'.includes(text[at - 1])) at--
    issues.push({
      key: `cite:${s.text.slice(0, 48)}`, kind: 'missing', blocking: false,
      title: 'Claim without a citation',
      detail: `“${s.text.length > 70 ? s.text.slice(0, 70) + '…' : s.text}” Accept cites the top precedent.`,
      start: at, end: at,
    })
  }

  const seenPii = new Set<string>()
  for (const p of pii) {
    if (seenPii.has(p.token)) continue
    seenPii.add(p.token)
    issues.push({
      key: `pii:${p.token}`, kind: 'pii', blocking: false, token: p.token,
      title: `Masked token ${p.token} in reply`,
      detail: 'The customer would see the placeholder. Accept rewrites it in plain words.', start: p.start, end: p.end,
    })
  }

  const open = issues.filter(i => !dismissed.has(i.key))
  const openUnverified = open.filter(i => i.kind === 'unverified').length
  const openInvalid = open.filter(i => i.kind === 'invalid').length
  const coverage = factual ? cited / factual : citations.some(c => c.valid) ? 1 : 0
  const grounding = Math.max(0, Math.min(100, Math.round(coverage * 100 - 15 * openUnverified - 25 * openInvalid)))
  return { issues: open, citations, pii, factual, cited, grounding }
}

function tidy(s: string) {
  return s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n').trimEnd()
}

/** Accept on an unverified figure: drop the whole sentence if it cites nothing, else just the phrase. */
export function removeClaim(text: string, phrase: string): string {
  let idx = text.indexOf(phrase)
  if (idx < 0) idx = text.toLowerCase().indexOf(phrase.toLowerCase())
  if (idx < 0) return text
  const s = splitSentences(text).find(x => idx >= x.start && idx < x.end)
  if (s && !HAS_CITE.test(s.text)) return tidy(text.slice(0, s.start) + text.slice(s.end))
  const before = text.slice(0, idx)
  const prep = before.match(/\s*\b(within|in|about|around|up to|of|for|by|innerhalb von|binnen|von|um)\s*$/i)
  const from = prep ? idx - prep[0].length : idx
  return tidy(text.slice(0, from) + ' ' + text.slice(idx + phrase.length))
}

export function applyFix(text: string, issue: Issue, precedents: Precedent[], lang: string): string {
  switch (issue.kind) {
    case 'unverified': return removeClaim(text, issue.phrase!)
    case 'invalid': return tidy(text.slice(0, issue.start) + text.slice(issue.end))
    case 'missing': {
      const top = [...precedents].sort((a, b) => b.score - a.score)[0]
      if (!top) return text
      return text.slice(0, issue.start) + ` [${top.ticket_id}]` + text.slice(issue.start)
    }
    case 'pii': {
      const kind = issue.token!.slice(1, -1)
      const word = PII_FRIENDLY[kind]?.[lang === 'de' ? 'de' : 'en'] ?? ''
      return tidy(text.split(issue.token!).join(word))
    }
  }
}
