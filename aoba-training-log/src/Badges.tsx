import { Baseball, Equipment, Laurel } from './BaseballArt'
import { Award, ChevronLeft, Flag, LockKeyhole, Medal, Moon, NotebookPen, Sparkles, Trophy } from 'lucide-react'
import type { managementProgress } from './progress'

export type Badge = ReturnType<typeof managementProgress>['badges'][number]
const badgeStyle = {
  first: { Icon: Sparkles, metal: 'bronze' },
  ten: { Icon: Medal, metal: 'silver' },
  thirty: { Icon: Award, metal: 'gold' },
  goal: { Icon: Flag, metal: 'gold' },
  reflection: { Icon: NotebookPen, metal: 'silver' },
  rest: { Icon: Moon, metal: 'bronze' },
}

export function BadgeMedal({ badge }: { badge: Badge }) {
  const { Icon, metal } = badgeStyle[badge.id]
  return <span className={'medal medal-' + metal + (badge.earnedAt ? '' : ' medal-locked')} aria-hidden="true">
    <Laurel />
    <span className="medal-face">{badge.id === 'first' ? <Baseball size={31} />
      : badge.id === 'ten' ? <Equipment category="打撃" />
      : badge.id === 'thirty' ? <Equipment category="守備" />
      : <Icon size={25} strokeWidth={2} />}</span>
    {!badge.earnedAt && <span className="medal-lock"><LockKeyhole size={10} /></span>}
  </span>
}

export function Badges({ badges, open }: { badges: Badge[]; open: (id: Badge['id']) => void }) {
  const recent = badges.filter(badge => badge.earnedAt).sort((a, b) => b.earnedAt!.localeCompare(a.earnedAt!)).slice(0, 3)
  return <section className="club-panel badge-panel" aria-labelledby="badge-title">
    <h2 id="badge-title"><Trophy size={19} aria-hidden="true" />バッジコレクション</h2>
    <p className="hint">{recent.length ? '最近の獲得 · ' + recent.map(badge => badge.label).join('、') : '獲得済みのバッジはまだありません。'}</p>
    <ul className="medal-grid">{badges.map(badge => <li key={badge.id}>
      <button id={'medal-' + badge.id} type="button" onClick={() => open(badge.id)} aria-label={badge.label + (badge.earnedAt ? '、獲得済み' : '、未獲得')}>
        <BadgeMedal badge={badge} />
        <strong>{badge.label}</strong>
        <small>{badge.earnedAt ? '獲得済み' : '未獲得'}</small>
      </button>
    </li>)}</ul>
  </section>
}

export function BadgeDetail({ badge, back }: { badge: Badge; back: () => void }) {
  return <>
    <section className="screen-title badge-title">
      <button className="action back-button" onClick={back}><ChevronLeft size={16} aria-hidden="true" />バッジ一覧へ</button>
      <BadgeMedal badge={badge} />
      <h1>{badge.label}</h1>
      <p>{badge.earnedAt ? '獲得済み' : '未獲得'}</p>
    </section>
    <section className="card badge-condition">
      <h2>獲得条件</h2>
      <p>{badge.condition}</p>
      {badge.earnedAt && <p className="hint">獲得日 <time dateTime={badge.earnedAt}>{new Date(badge.earnedAt).toLocaleDateString('ja-JP')}</time></p>}
    </section>
  </>
}


