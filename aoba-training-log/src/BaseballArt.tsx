import { CircleHelp, Dumbbell, NotebookPen, PersonStanding } from 'lucide-react'
import type { Category } from './model'

export function Baseball({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="12" fill="#fffdf1" stroke="currentColor" strokeWidth="1.4" />
    <path d="M9 6c8 6 8 14 0 20M23 6c-8 6-8 14 0 20M11 10l5-2m-3 6 5-1m-5 5 5 1m-7 3 5 2m5-14-3-2m2 6-3-1m3 5-3 1m4 3-3 2"
      stroke="#a94e41" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
}

export function Equipment({ category }: { category: Category }) {
  if (category === '打撃') return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="m5 20 3-3m-4 1 2 2m1-4 8-10c2-3 5-3 6-2s1 4-2 6L9 18Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx="5" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
  if (category === '守備') return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M8 21c-3-1-5-4-6-7-1-2 1-3 3-1l2 2-1-9c0-2 2-2 3 0l1 5V4c0-2 3-2 3 0v6l1-6c0-2 3-2 3 0l-1 7 2-4c1-2 3-1 3 1l-2 8c-1 4-3 6-7 6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M9 16c2 2 5 2 7-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
  const Icon = category === '走塁' ? PersonStanding : category === '体づくり' ? Dumbbell : category === 'その他' ? NotebookPen : CircleHelp
  return <Icon size={22} aria-hidden="true" />
}

export function FieldLines() {
  return <svg className="field-lines" viewBox="0 0 330 230" fill="none" aria-hidden="true">
    <path d="M-30 133Q154-100 360 133M-30 147Q154-86 360 147M78 129l87-87 87 87-87 87ZM99 129l66-66 66 66-66 66Z" stroke="currentColor" />
    <path d="M165 225 0 60m165 165L330 60" stroke="currentColor" strokeDasharray="5 5" />
    <circle cx="165" cy="129" r="19" stroke="currentColor" /><path d="m159 204 12 0 0 6-6 5-6-5Z" fill="currentColor" />
  </svg>
}

export function StadiumLights() {
  return <svg className="stadium-art" viewBox="0 0 420 224" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <radialGradient id="arena-sky">
        <stop stopColor="#14659a" /><stop offset="1" stopColor="#03142b" />
      </radialGradient>
      <radialGradient id="arena-light">
        <stop stopColor="#fff" /><stop offset=".13" stopColor="#c3f7ff" />
        <stop offset=".4" stopColor="#4ad5ff" stopOpacity=".68" /><stop offset="1" stopColor="#46b6ff" stopOpacity="0" />
      </radialGradient>
      <pattern id="arena-crowd" width="11" height="7" patternUnits="userSpaceOnUse">
        <path d="M2 2h1m4 2h1m2-3h1" stroke="#76bbf5" />
        <path d="M5 6h1" stroke="#efd199" />
      </pattern>
      <linearGradient id="arena-grass" x2="0" y2="1">
        <stop stopColor="#318744" /><stop offset="1" stopColor="#062c21" />
      </linearGradient>
    </defs>
    <path fill="url(#arena-sky)" d="M0 0h420v224H0z" />
    <path fill="#030e20" d="M0 80Q210 154 420 80v80Q210 200 0 160Z" />
    <path fill="url(#arena-crowd)" opacity=".65" d="M0 84Q210 155 420 84v73Q210 191 0 157Z" />
    <path stroke="#3d8ec8" strokeWidth="2" fill="none" d="M0 100Q210 168 420 100M0 120Q210 181 420 120M0 141Q210 193 420 141" />
    <path fill="url(#arena-grass)" d="M0 157Q210 194 420 157v67H0Z" />
    <path fill="#83be4b" opacity=".31" d="M210 175 88 224H0l170-53zm0 0 122 49h88l-170-53z" />
    <path fill="#9e683c" d="m210 183 77 27-77 27-77-27Z" />
    <path fill="none" stroke="#e4f7d0" opacity=".68" d="m40 167 170 58 170-58m-170 56-56-19 56-18 56 18Z" />
    <path stroke="#4883b1" d="M29 64v66m362-66v66" />
    <ellipse cx="27" cy="63" rx="74" ry="54" fill="url(#arena-light)" />
    <ellipse cx="393" cy="63" rx="74" ry="54" fill="url(#arena-light)" />
    {[27, 393].map(x => <g key={x} transform={`translate(${x} 63)`}>
      <path stroke="#ddfaff" opacity=".8" d="M-27 0h54M0-21v42M-17-13l34 26m0-26-34 26" />
      <path stroke="#eaffff" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 5" d="M-16-4h34m-34 8h34" />
    </g>)}
  </svg>
}

export function Laurel() {
  return <svg className="laurel" viewBox="0 0 102 80" aria-hidden="true">
    {[false, true].map(mirror => <g key={String(mirror)} transform={mirror ? 'translate(102 0) scale(-1 1)' : undefined}>
      <path fill="none" stroke="currentColor" d="M30 75C13 68 5 53 8 29" />
      {[0, 1, 2, 3, 4].map(i => <path key={i} fill="currentColor"
        transform={`translate(${7 + i * i * .64} ${31 + i * 9}) rotate(${i * -12})`}
        d="M0 8C-8 6-7 1-6-3 0-1 2 3 0 8ZM2 10c-2-6 1-9 6-11 1 6-1 9-6 11Z" />)}
    </g>)}
  </svg>
}
