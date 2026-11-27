import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CalendarDays, ChartNoAxesColumnIncreasing, ClipboardList, House, Settings2, Trophy, X } from 'lucide-react'
import { BadgeDetail, type Badge } from './Badges'
import { Baseball } from './BaseballArt'
import { BattingStatsView } from './BattingStatsView'
import { BackupError } from './backup'
import { dailyStats, managementProgress } from './progress'
import { CloudAccount } from './CloudAccount'
import { DataManagement } from './DataManagement'
import { Calendar } from './Calendar'
import { localDate } from './dates'
import { Home } from './Home'
import { canDeleteMenusLocally } from './menuDeletionAccess'
import { canEditMatches } from './matches'
import type { LocalDate, TrainingData, TrainingKind } from './model'
import { Records, type Commit } from './Records'
import { battingGames, recordHistory } from './recordHistory'
import { Reflections } from './Reflections'
import { RestoreRecovery } from './RestoreRecovery'
import { Settings } from './Settings'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './cloud'
import type { Change } from './storage'
import type { LocalRestoreSettings } from './localMatchStorage'
import { useTrainingStorage } from './useTrainingStorage'

const Growth = lazy(() => import('./Growth'))
const PlanManagement = lazy(() => import('./PlanManagement'))

const navigation = [
  { label: 'ホーム', icon: House },
  { label: '記録', icon: ClipboardList },
  { label: 'カレンダー', icon: CalendarDays },
  { label: '成長', icon: ChartNoAxesColumnIncreasing },
  { label: '設定', icon: Settings2 },
] as const

type Tab = typeof navigation[number]['label']
type Page = Tab | '振り返り' | 'バッジ' | 'データ管理' | 'クラウド' | '練習計画' | 'ホーム打撃成績'

interface Milestone { level?: number; badges: string[]; id: number }

export function App() {
  const [page, setPage] = useState<Page>('ホーム')
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => setSession(current))
    return () => subscription.unsubscribe()
  }, [])
  if (session === undefined) return <main className="shell content"><p role="status">ログイン状態を確認しています。</p></main>
  return <TrainingApp key={session?.user.id ?? 'guest'} session={session} page={page} setPage={setPage} />
}

function TrainingApp({ session, page, setPage }: { session: Session | null; page: Page; setPage: (page: Page) => void }) {
  const storage = useTrainingStorage(session)
  const { data, load, loadFailed } = storage
  const [recordStart, setRecordStart] = useState<{ date?: LocalDate; kind?: TrainingKind; id?: string }>()
  const [calendarDate, setCalendarDate] = useState(() => localDate(new Date()))
  const [reflectionDate, setReflectionDate] = useState(() => localDate(new Date()))
  const [badgeId, setBadgeId] = useState<Badge['id']>()
  const [milestone, setMilestone] = useState<Milestone>()
  const milestoneId = useRef(0)
  const pendingGauge = useRef(false)
  const nav = useRef<HTMLElement>(null)
  const [previous, setPrevious] = useState<Tab>('ホーム')

  useEffect(() => {
    const bar = nav.current
    if (!bar) return
    const root = document.documentElement
    const measure = () => root.style.setProperty('--bottom-nav-height', Math.ceil(bar.getBoundingClientRect().height) + 'px')
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar, { box: 'border-box' })
    return () => {
      observer.disconnect()
      root.style.removeProperty('--bottom-nav-height')
    }
  }, [])

  useEffect(() => {
    if (!milestone) return
    const timer = window.setTimeout(() => setMilestone(undefined), 6500)
    return () => window.clearTimeout(timer)
  }, [milestone])

  const commit: Commit = async change => {
    const now = new Date()
    const date = localDate(now)
    let notice: Omit<Milestone, 'id'> | undefined
    let gaugeChanged = false
    await storage.update(before => {
      const after = change(before)
      const earlier = managementProgress(before, now)
      const latest = managementProgress(after, now)
      const earned = new Set(earlier.badges.filter(badge => badge.earnedAt).map(badge => badge.id))
      const badges = latest.badges.filter(badge => badge.earnedAt && !earned.has(badge.id)).map(badge => badge.label)
      const level = latest.level > earlier.level ? latest.level : undefined
      if (level || badges.length) notice = { level, badges }
      gaugeChanged = dailyStats(before, date).rate !== dailyStats(after, date).rate
      return after
    })
    if (gaugeChanged) pendingGauge.current = true
    if (notice) setMilestone({ ...notice, id: ++milestoneId.current })
  }

  async function restore(change: Change, settings?: LocalRestoreSettings) {
    await storage.update(current => {
      const restored = change(current)
      const existing = new Set(current.deletedMenus?.map(item => item.id))
      if (!canDeleteMenusLocally() && restored.deletedMenus?.some(item => !existing.has(item.id))) {
        throw new BackupError('このバックアップには、復元先にない削除済みメニューがあります。完全削除に対応した検証環境で確認してください。')
      }
      return restored
    }, settings)
    pendingGauge.current = false
    setMilestone(undefined)
  }

  function navigate(nextPage: Page) {
    setPage(nextPage)
    window.scrollTo(0, 0)
  }

  function record(date: LocalDate, kind?: TrainingKind, id?: string) {
    setRecordStart({ date, kind, id })
    setCalendarDate(date)
    navigate('記録')
  }

  function reflect(date: LocalDate, from: Tab) {
    setReflectionDate(date)
    setPrevious(from)
    setCalendarDate(date)
    navigate('振り返り')
  }

  const badge = data && page === 'バッジ' ? managementProgress(data, new Date()).badges.find(item => item.id === badgeId) : undefined
  const homeBatting = data && (page === 'ホーム' || page === 'ホーム打撃成績') && canEditMatches()
    ? battingGames(recordHistory(data)) : undefined

  return <>
    <header className="masthead"><div className="shell"><span className="brand-mark"><Baseball size={27} /></span>AOBA TRAINING LOG</div></header>
    <main className="shell content" data-screen={page}>
      {__MATCH_TEST_BUILD__ && <p className="card entry-note"><strong>試合記録の検証環境</strong> · {__MATCH_TEST_BUILD__.build}<br />端末内のみ保存 · テストデータ専用</p>}
      {storage.matchUpgradeBlocked ? <p role="status">ほかのタブが試合データを使用しています。開いている旧タブやホーム画面のアプリを閉じると、更新を続けます。</p>
        : storage.matchVersionError ? <><p className="error" role="alert">{storage.matchVersionError}</p>
          <button className="action" onClick={load}>もう一度読み込む</button></>
        : storage.restoreConflict ? <RestoreRecovery owner={session ? session.user.email ?? session.user.id : 'ゲスト'}
        inspect={storage.reviewRecovery} resume={storage.keepCurrent} reload={load}
        logout={session && supabase ? async () => {
          const result = await supabase!.auth.signOut({ scope: 'local' })
          if (result.error) throw result.error
        } : undefined} /> : data ? <>
        {storage.sync?.decision && page !== 'クラウド' && <section className="card section-toolbar">
          <p>{storage.sync.decision.kind === 'initial' ? '初回同期の確認が必要です。' : '同期するデータの選択が必要です。'}</p>
          <button className="action" onClick={() => navigate('クラウド')}>同期内容を確認</button>
        </section>}
        {page === 'ホーム' && <Home data={data}
          commit={commit}
          onPlan={() => { setCalendarDate(localDate(new Date())); navigate('カレンダー') }}
          onReflection={() => reflect(localDate(new Date()), 'ホーム')}
          pendingGauge={pendingGauge}
          batting={homeBatting && { games: homeBatting, onOpen: () => navigate('ホーム打撃成績') }}
          onBadge={id => { setBadgeId(id); navigate('バッジ') }} />}
        {page === 'ホーム打撃成績' && homeBatting && <BattingStatsView games={homeBatting} backLabel="ホームへ戻る"
          onClose={() => {
            navigate('ホーム')
            requestAnimationFrame(() => {
              const trigger = document.getElementById('home-batting-open')
              trigger?.scrollIntoView({ block: 'center' })
              trigger?.focus({ preventScroll: true })
            })
          }} />}
        {badge && <BadgeDetail badge={badge} back={() => {
          navigate('ホーム')
          requestAnimationFrame(() => {
            const item = document.getElementById('medal-' + badge.id)
            item?.scrollIntoView({ block: 'center' })
            item?.focus({ preventScroll: true })
          })
        }} />}
        {page === '記録' && <Records data={data} commit={commit} start={recordStart} />}
        {page === '設定' && <Settings data={data} commit={commit} onDataManagement={() => navigate('データ管理')} onCloudAccount={() => navigate('クラウド')} onPlanManagement={() => navigate('練習計画')} />}
        {page === '練習計画' && <Suspense fallback={<p role="status">練習計画を読み込んでいます。</p>}>
          <PlanManagement data={data} commit={commit} back={() => navigate('設定')} read={storage.read} />
        </Suspense>}
        {page === 'クラウド' && <CloudAccount back={() => navigate('設定')} session={session} sync={storage.sync} />}
        {page === 'データ管理' && <DataManagement back={() => navigate('設定')} restore={restore} read={storage.read}
          owner={session ? session.user.email ?? 'アカウント ' + session.user.id : 'ゲスト'} preserveLocalDetails={storage.separatesMatches}
          readGuestMatches={storage.readGuestMatches} copyGuestMatches={storage.copyGuestMatches} />}
        {page === 'カレンダー' && <Calendar data={data} commit={commit} initialDate={calendarDate} onRecord={record}
          onReflection={date => reflect(date, 'カレンダー')} />}
        {page === '振り返り' && <Reflections data={data} commit={commit} initialDate={reflectionDate} back={() => navigate(previous)} />}
        {page === '成長' && <Suspense fallback={<p role="status">グラフを読み込んでいます。</p>}><Growth data={data} /></Suspense>}
      </> : <section className="card">
        {loadFailed ? <>
          <p className="error" role="alert">データを読み込めませんでした。</p>
          <button className="action" onClick={load}>もう一度読み込む</button>
        </> : <p role="status">データを読み込んでいます。</p>}
      </section>}
    </main>
    <aside className="milestone-region shell" aria-live="polite" aria-atomic="true">
      {milestone && <div className="milestone" key={milestone.id}>
        <span className="milestone-icon"><Trophy size={20} aria-hidden="true" /></span>
        <div>
          {milestone.level && <p><strong>レベルアップ！ Lv. {milestone.level}</strong></p>}
          {milestone.badges.length > 0 && <p><strong>バッジ獲得</strong> · {milestone.badges.join('、')}</p>}
        </div>
        <button onClick={() => setMilestone(undefined)} aria-label="お知らせを閉じる"><X size={18} aria-hidden="true" /></button>
      </div>}
    </aside>
    <nav ref={nav} className="bottom-nav" aria-label="メインナビゲーション">
      <div className="shell grid grid-cols-5">
        {navigation.map(({ label, icon: Icon }) => (
          <button key={label} type="button" disabled={!data || storage.restoreConflict}
            aria-current={label === (page === '振り返り' ? previous : (page === 'バッジ' || page === 'ホーム打撃成績') ? 'ホーム' : (page === 'データ管理' || page === 'クラウド' || page === '練習計画') ? '設定' : page) ? 'page' : undefined}
            onClick={() => { setRecordStart(undefined); navigate(label) }}>
            <Icon size={22} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  </>
}










