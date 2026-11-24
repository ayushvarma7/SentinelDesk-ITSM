/** SentinelDesk mark: red shield with a pulse line. Same artwork as public/favicon.svg. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <path d="M22 4 L37 9.5 V21 C37 30.5 30.5 37 22 40.5 C13.5 37 7 30.5 7 21 V9.5 Z" fill="#C8102E" />
      <polyline points="12.5,22 17.5,22 20,15.5 23.5,28.5 26,22 31.5,22" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Wordmark for the dark header (mark + white "SentinelDesk"). */
export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <LogoMark />
      <span className="text-[19px] font-semibold tracking-[0.01em] text-white">SentinelDesk</span>
    </div>
  )
}
