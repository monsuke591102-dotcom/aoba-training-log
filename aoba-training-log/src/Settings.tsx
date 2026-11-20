import { ChevronDown, Target } from 'lucide-react'
import { Equipment } from './BaseballArt'
import { ScreenTitle } from './ScreenTitle'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { localDate } from './dates'
import { categories, units } from './initialData'
import { canDeleteMenusLocally } from './menuDeletionAccess'
import type { Category, Goal, Menu, TrainingData } from './model'
import { errorMessage, rejectInvalidNumber, type Commit } from './Records'
import { currentGoal, deleteMenu, menuStats, saveGoals, saveMenu, setMenuEnabled, weekDates } from './training'

const unclassified = '未分類'
const menuCategory = (menu: Menu) => categories.includes(menu.category) ? menu.category : unclassified

function MenuEditor({ menu, data, commit, close, onSaved, create = false }: {
  menu: Menu; data: TrainingData; commit: Commit; close: () => void; onSaved: (menu: Menu) => void; create?: boolean
}) {
  const [draft, setDraft] = useState(menu)
  const savedDaily = currentGoal(data.goals, 'daily-menu', localDate(new Date()), menu.id)
  const initialDaily = String(savedDaily?.unit === menu.unit ? savedDaily.amount ?? '' : '')
  const [daily, setDaily] = useState(initialDaily)
  const [target, setTarget] = useState(String(menuStats(data, menu, new Date()).target ?? ''))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      rejectInvalidNumber(event.currentTarget)
      await commit(data => saveMenu(data, draft, target, new Date(), daily, create))
      onSaved(draft)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="editor" noValidate onSubmit={submit}>
      <fieldset className="fields" disabled={busy}>
        <label>メニュー名<input required autoFocus={create} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>カテゴリ<select value={categories.includes(draft.category) ? draft.category : ''} onChange={event => setDraft({
          ...draft, category: event.target.value ? event.target.value as Menu['category'] : menu.category,
        })}>
          {menuCategory(menu) === unclassified && <option value="">{unclassified}</option>}
          {categories.map(category => <option key={category}>{category}</option>)}
        </select></label>
        <label>記録単位<select value={draft.unit} onChange={event => {
          const unit = event.target.value as Menu['unit']
          setDraft({ ...draft, unit })
          setDaily(unit === menu.unit ? initialDaily : '')
          setTarget(unit === menu.unit ? String(menuStats(data, menu, new Date()).target ?? '') : '')
        }}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label>
        <label>週間目標値（{draft.unit}・任意）<input type="number" value={target} onChange={event => setTarget(event.target.value)} /></label>
        <label>日次目標値（{draft.unit}・任意）<input type="number" placeholder="未設定" value={daily} onChange={event => setDaily(event.target.value)} /></label>
        <label className="checkbox"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />新しい記録で使う</label>
        <div className="form-actions"><button className="action filled" type="submit">メニューを保存</button><button className="action" type="button" onClick={close}>キャンセル</button></div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}

function goalLabel(goal: Goal) {
  switch (goal.kind) {
    case 'weekly': return '週間練習日数 ' + (goal.days === null ? '未設定' : goal.days + '日')
    case 'menu': return goal.menuName + 'の週間目標 ' + (goal.amount === null ? '未設定' : goal.amount + goal.unit)
    case 'daily-menu': return goal.menuName + 'の日次目標 ' + (goal.amount === null ? '未設定' : goal.amount + goal.unit)
    case 'skill': return '技術目標 ' + (goal.text || '未設定')
  }
}

export function Settings({ data, commit, onDataManagement, onCloudAccount, onPlanManagement }: { data: TrainingData; commit: Commit; onDataManagement: () => void; onCloudAccount: () => void; onPlanManagement: () => void }) {
  const today = new Date()
  const date = localDate(today)
  const [start, end] = weekDates(today)
  const [days, setDays] = useState(String(currentGoal(data.goals, 'weekly', date)?.days ?? ''))
  const [skill, setSkill] = useState(currentGoal(data.goals, 'skill', date)?.text ?? '')
  const [menuId, selectMenu] = useState<string | null>(null)
  const menuGroups = useRef<HTMLDivElement>(null)
  const groupNames: (Category | typeof unclassified)[] =
    data.menus.some(menu => menuCategory(menu) === unclassified) ? [...categories, unclassified] : categories

  function openAllMenuGroups(open: boolean) {
    menuGroups.current?.querySelectorAll<HTMLDetailsElement>('details[data-menu-category]').forEach(group => { group.open = open })
  }

  function closeAllMenuGroups(button: HTMLButtonElement) {
    if (menuGroups.current?.querySelector('details[open]:focus-within')) button.focus()
    openAllMenuGroups(false)
  }

  function showSavedMenu(menu: Menu) {
    const group = menuGroups.current?.querySelector<HTMLDetailsElement>(`details[data-menu-category="${menuCategory(menu)}"]`)
    if (group) {
      group.open = true
      group.querySelector('summary')?.focus()
    }
    selectMenu(null)
    setNewMenu(undefined)
  }
  const [newMenu, setNewMenu] = useState<Menu>()
  const [changingMenu, setChangingMenu] = useState<string>()
  const [deletingMenu, setDeletingMenu] = useState<Menu>()
  const [visibilityError, setVisibilityError] = useState('')
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const allowDeletion = canDeleteMenusLocally()
  const affectedPlans = deletingMenu ? data.plans.filter(plan =>
    plan.date >= date && plan.kind !== '休養日' && plan.menuIds.includes(deletingMenu.id)).length : 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setFeedback(undefined)
    try {
      rejectInvalidNumber(event.currentTarget)
      await commit(data => saveGoals(data, days, skill))
      setFeedback({ error: false, text: '目標を保存しました。' })
    } catch (error) {
      setFeedback({ error: true, text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function changeVisibility(menu: Menu) {
    setChangingMenu(menu.id)
    setVisibilityError('')
    try {
      await commit(latest => setMenuEnabled(latest, menu.id, !menu.enabled))
    } catch (error) {
      setVisibilityError(errorMessage(error))
    } finally {
      setChangingMenu(undefined)
    }
  }

  async function confirmDeletion() {
    if (!deletingMenu || changingMenu || !canDeleteMenusLocally()) return
    setChangingMenu(deletingMenu.id)
    setVisibilityError('')
    try {
      await commit(latest => deleteMenu(latest, deletingMenu))
      setDeletingMenu(undefined)
    } catch (error) {
      setVisibilityError(errorMessage(error))
    } finally {
      setChangingMenu(undefined)
    }
  }

  return (
    <>
      <ScreenTitle title="目標・メニュー設定" icon={Target} />
      <section className="card section-toolbar"><h2>曜日・月次計画</h2><button className="action" onClick={onPlanManagement}>練習計画の管理</button></section>
      <section className="card section-toolbar"><h2>データ管理</h2><button className="action" onClick={onDataManagement}>バックアップ・復元</button></section>
      <section className="card section-toolbar"><h2>クラウド</h2><button className="action" onClick={onCloudAccount}>クラウドアカウント</button></section>
      <section className="card">
        <h2 className="section-heading">練習の目標</h2>
        <p className="hint">今週 {start} 〜 {end}（月〜日）</p>
        <form className="editor" noValidate onSubmit={submit}>
          <fieldset disabled={busy} className="fields">
            <label>週間練習日数（任意）<input type="number" inputMode="numeric" placeholder="未設定" value={days} onChange={event => setDays(event.target.value)} /></label>
            <label>技術目標（任意）<textarea rows={2} placeholder="未設定" value={skill} onChange={event => setSkill(event.target.value)} /></label>
            <button className="action filled" type="submit">目標を保存</button>
          </fieldset>
          {feedback && <p className={feedback.error ? 'error' : 'hint'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        </form>
      </section>
      <section className="card">
        <h2>練習メニュー</h2>
        <p className="hint">週間目標は月〜日。同じ単位の記録で集計します。</p>
        {visibilityError && <p className="error" role="alert">{visibilityError}</p>}
        <div className="form-actions">
          <button type="button" className="action" onClick={() => openAllMenuGroups(true)}>すべて開く</button>
          <button type="button" className="action" onClick={event => closeAllMenuGroups(event.currentTarget)}>すべて閉じる</button>
        </div>
        <div ref={menuGroups}>{groupNames.map(category => {
          const menus = data.menus.filter(menu => menuCategory(menu) === category)
          return <details className="menu-group" key={category} data-menu-category={category}>
            <summary onClick={({ currentTarget: summary }) => {
              const group = summary.closest('details')
              const focused = summary.ownerDocument.activeElement
              if (group?.open && group.contains(focused) && !summary.contains(focused)) summary.focus()
            }}>
              <span className="settings-menu-category">
                {category !== unclassified && <span className="settings-menu-category-icon" aria-hidden="true">
                  {category === '走塁' ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9h4m-6 4h4m1 5h15a2 2 0 0 0 2-2v-1l-7-2-4-6-4 3-2 5zm3 0v2m4-2v2m5-2v2m-6-10 2-1m0 4 2-1" />
                  </svg> : <Equipment category={category} />}
                </span>}
                {category}
              </span>
              <span>{menus.length}種目</span><ChevronDown size={18} aria-hidden="true" />
            </summary>
            <ul className="entries">
              {menus.map(menu => {
                const stats = menuStats(data, menu, today)
                const daily = currentGoal(data.goals, 'daily-menu', date, menu.id)
                return (
                  <li key={menu.id}>
                    <p className="entry-title">{menu.name} <span>{menu.enabled ? '表示中' : '非表示'}</span></p>
                    <p className="hint">今週 {stats.amount}{menu.unit} · 目標 {stats.target === null ? '未設定' : stats.target + menu.unit + '（' + stats.rate + '%）'}</p>
                    <p className="hint">日次目標 {daily?.amount != null && daily.unit === menu.unit ? daily.amount + menu.unit : '未設定'}</p>
                    {deletingMenu?.id === menu.id ? <div className="confirmation" role="group" aria-label="メニューの完全削除を確認">
                      <p><strong>{deletingMenu.name}</strong>を登録メニューから完全削除します。</p>
                      <p>当日以降の予定{affectedPlans}件からこの種目だけを外し、曜日別計画でも当日以降は適用しません。</p>
                      <p>過去の実施記録と計画履歴は残ります。設定からの再表示はできなくなります。</p>
                      <div className="form-actions">
                        <button type="button" className="action danger" disabled={changingMenu !== undefined}
                          onClick={() => void confirmDeletion()}>完全削除する</button>
                        <button type="button" className="action" disabled={changingMenu !== undefined}
                          onClick={() => setDeletingMenu(undefined)}>キャンセル</button>
                      </div>
                    </div> : menuId === menu.id
                      ? <MenuEditor menu={menu} data={data} commit={commit} close={() => selectMenu(null)} onSaved={showSavedMenu} />
                      : <div className="form-actions">
                        <button className="action" disabled={changingMenu === menu.id} aria-label={menu.name + 'を編集'} onClick={() => { setNewMenu(undefined); selectMenu(menu.id) }}>編集</button>
                        <button className="action" disabled={changingMenu !== undefined}
                          aria-label={menu.name + 'を' + (menu.enabled ? '非表示' : '再表示')}
                          onClick={() => void changeVisibility(menu)}>{menu.enabled ? '非表示' : '再表示'}</button>
                        {allowDeletion && <button type="button" className="action" disabled={changingMenu !== undefined || !!deletingMenu}
                          aria-label={menu.name + 'を完全削除'} onClick={() => { setVisibilityError(''); setDeletingMenu(menu) }}>完全削除</button>}
                      </div>}
                  </li>
                )
              })}
            </ul>
            {newMenu?.category === category
              ? <MenuEditor key={newMenu.id} menu={newMenu} data={data} commit={commit} create close={() => showSavedMenu(newMenu)} onSaved={showSavedMenu} />
              : category !== unclassified && <button type="button" className="action settings-menu-add"
                aria-label={category + 'にメニュー追加'} disabled={!!newMenu} onClick={() => {
                  selectMenu(null)
                  setNewMenu({ id: crypto.randomUUID(), name: '', category, unit: '回', enabled: true })
                }}>＋メニュー追加</button>}
          </details>
        })}</div>
      </section>
      <section className="card">
        <h2>目標変更履歴</h2>
        {data.goals.length === 0 && <p className="hint">変更履歴はありません。</p>}
        <ul className="entries">
          {[...data.goals].reverse().map(goal => (
            <li key={goal.id}>
              <p className="hint"><time dateTime={goal.changedAt}>{new Date(goal.changedAt).toLocaleString('ja-JP')}</time></p>
              <p className="entry-note">{goalLabel(goal)}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}







