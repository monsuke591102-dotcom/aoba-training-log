import { ChevronDown, Target } from 'lucide-react'
import { MenuCategoryLabel } from './BaseballArt'
import { CategoryManagement } from './CategoryManagement'
import { ScreenTitle } from './ScreenTitle'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { localDate } from './dates'
import { units } from './initialData'
import { assignMenuCategory, browserCategorySettings, categoryIdForMenu, groupedMenus, legacyCategory,
  readCategorySettings, unclassified, writeCategorySettings, type CategorySettings } from './menuCategories'
import { canDeleteMenusLocally } from './menuDeletionAccess'
import type { Goal, Menu, TrainingData } from './model'
import { errorMessage, rejectInvalidNumber, type Commit } from './Records'
import { currentGoal, deleteMenu, menuStats, saveGoals, saveMenu, setMenuEnabled, weekDates } from './training'

function MenuEditor({ menu, data, commit, close, onSaved, settings, initialCategory, create = false }: {
  menu: Menu; data: TrainingData; commit: Commit; close: () => void;
  onSaved: (id: string, settings: CategorySettings) => void; settings: CategorySettings; initialCategory: string; create?: boolean
}) {
  const [draft, setDraft] = useState(menu)
  const [categoryId, setCategoryId] = useState(initialCategory)
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
      const previous = readCategorySettings(window.localStorage)
      const saved = create ? { ...draft, category: legacyCategory(categoryId) ?? 'その他' } : draft
      const next = assignMenuCategory(previous, saved, categoryId)
      if (next !== previous) writeCategorySettings(window.localStorage, next)
      try {
        await commit(data => saveMenu(data, saved, target, new Date(), daily, create))
      } catch (failure) {
        if (next !== previous && JSON.stringify(readCategorySettings(window.localStorage)) === JSON.stringify(next)) {
          writeCategorySettings(window.localStorage, previous)
        }
        throw failure
      }
      onSaved(categoryId, next)
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
        <label>分類<select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
          {!initialCategory && <option value="">{unclassified.name}</option>}
          {settings.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
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
  const [settings, setSettings] = useState(browserCategorySettings)
  const [categoryFeedback, setCategoryFeedback] = useState<{ error: boolean; text: string }>()
  const groups = groupedMenus(settings, data.menus)

  function openAllMenuGroups(open: boolean) {
    menuGroups.current?.querySelectorAll<HTMLDetailsElement>('details[data-menu-category]').forEach(group => { group.open = open })
  }

  function closeAllMenuGroups(button: HTMLButtonElement) {
    if (menuGroups.current?.querySelector('details[open]:focus-within')) button.focus()
    openAllMenuGroups(false)
  }

  function showSavedMenu(id: string, next: CategorySettings) {
    setSettings(next)
    const group = [...(menuGroups.current?.querySelectorAll<HTMLDetailsElement>('details[data-category-id]') ?? [])]
      .find(group => group.dataset.categoryId === id)
    if (group) {
      group.open = true
      group.querySelector('summary')?.focus()
    }
    selectMenu(null)
    setNewMenu(undefined)
  }
  const [newMenu, setNewMenu] = useState<{ menu: Menu; categoryId: string }>()
  const [changingMenu, setChangingMenu] = useState<string>()
  const [deletingMenu, setDeletingMenu] = useState<Menu>()
  const [visibilityError, setVisibilityError] = useState('')
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const allowDeletion = canDeleteMenusLocally()
  const affectedPlans = deletingMenu ? data.plans.filter(plan =>
    plan.date >= date && plan.kind !== '休養日' && plan.menuIds.includes(deletingMenu.id)).length : 0

  function changeCategories(edit: (latest: CategorySettings) => CategorySettings) {
    try {
      const latest = readCategorySettings(window.localStorage)
      const next = edit(latest)
      if (next === latest) return true
      writeCategorySettings(window.localStorage, next)
      setSettings(next)
      setCategoryFeedback({ error: false, text: '分類設定を保存しました。' })
      return true
    } catch (failure) {
      setCategoryFeedback({ error: true, text: errorMessage(failure) })
      return false
    }
  }

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
        <CategoryManagement settings={settings} change={changeCategories} />
        {categoryFeedback && <p className={categoryFeedback.error ? 'error' : 'hint'}
          role={categoryFeedback.error ? 'alert' : 'status'}>{categoryFeedback.text}</p>}
        {visibilityError && <p className="error" role="alert">{visibilityError}</p>}
        <div className="form-actions">
          <button type="button" className="action" onClick={() => openAllMenuGroups(true)}>すべて開く</button>
          <button type="button" className="action" onClick={event => closeAllMenuGroups(event.currentTarget)}>すべて閉じる</button>
        </div>
        <div ref={menuGroups}>{groups.map(({ id, name, menus }) => {
          return <details className="menu-group" key={id} data-menu-category={name} data-category-id={id}>
            <summary onClick={({ currentTarget: summary }) => {
              const group = summary.closest('details')
              const focused = summary.ownerDocument.activeElement
              if (group?.open && group.contains(focused) && !summary.contains(focused)) summary.focus()
            }}>
              <MenuCategoryLabel category={id ? legacyCategory(id) ?? 'custom' : '未分類'} name={name} />
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
                      ? <MenuEditor menu={menu} data={data} commit={commit} settings={settings} initialCategory={categoryIdForMenu(settings, menu)}
                        close={() => selectMenu(null)} onSaved={showSavedMenu} />
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
            {newMenu?.categoryId === id
              ? <MenuEditor key={newMenu.menu.id} menu={newMenu.menu} data={data} commit={commit} settings={settings}
                initialCategory={id} create close={() => showSavedMenu(id, settings)} onSaved={showSavedMenu} />
              : id && <button type="button" className="action settings-menu-add"
                aria-label={name + 'にメニュー追加'} disabled={!!newMenu} onClick={() => {
                  selectMenu(null)
                  setNewMenu({ categoryId: id, menu: { id: crypto.randomUUID(), name: '', category: legacyCategory(id) ?? 'その他', unit: '回', enabled: true } })
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







