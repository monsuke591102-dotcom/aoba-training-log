import { useEffect, useRef, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { downloadBackup, encodeLocalBackup } from './DataManagement'
import { localDate } from './dates'
import { ExcelImport } from './ExcelImport'
import { browserCategorySettings } from './menuCategories'
import type { LocalDate, Menu, RoutineItem, TrainingData } from './model'
import { errorMessage, type Commit } from './recordFeedback'
import { NewPlanMenu, RoutineFields } from './RoutineFields'
import { findRoutineMenu, isMenuDeleted, isMenuHidden, nextMonth, routineForDate, saveRoutine, weekdays, type RoutineDraftItem } from './routines'
import { ScreenTitle } from './ScreenTitle'
import { InputError, saveMenu } from './training'

const scheduleLabel = (item: RoutineItem) => item.schedule === 'daily' ? '毎日'
  : item.schedule === 'conditional' ? '条件付き・任意' : item.weekdays.map(day => weekdays[day]).join('・')

export default function PlanManagement({ data, commit, back, read }: {
  data: TrainingData; commit: Commit; back: () => void; read: () => Promise<TrainingData>
}) {
  const now = new Date()
  const today = localDate(now)
  const versions = data.routineVersions ?? []
  const current = routineForDate(data, today)
  const [draft, setDraft] = useState<{ startsOn: string; items: RoutineDraftItem[]; sourceKey?: string }>()
  const [pendingMenus, setPendingMenus] = useState<Menu[]>([])
  const [categorySettings] = useState(browserCategorySettings)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const saving = useRef(false)
  const importHeading = useRef<HTMLHeadingElement>(null)
  const confirmingImport = Boolean(draft?.sourceKey)
  const menus = [...data.menus, ...pendingMenus]

  useEffect(() => {
    if (confirmingImport) importHeading.current?.focus()
  }, [confirmingImport])

  function cancelDraft() {
    setDraft(undefined)
    setError('')
    setPendingMenus([])
  }

  function start(startsOn: string, items: RoutineDraftItem[], sourceKey?: string) {
    setPendingMenus([])
    setImporting(false)
    setFeedback('')
    setError('')
    setDraft({ startsOn, items: structuredClone(items.filter(item => !isMenuDeleted(data, startsOn as LocalDate, item.menuId))), sourceKey })
  }

  async function backup() {
    setError('')
    try {
      downloadBackup(encodeLocalBackup(await read()), 'aoba-training-log-backup-' + today + '.json')
      setFeedback('ダウンロードを開始しました。ブラウザーの保存先を確認してください。')
    } catch {
      setFeedback('バックアップを書き出せませんでした。設定の「バックアップ・復元」も利用できます。')
    }
  }

  async function save() {
    if (!draft || saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const id = crypto.randomUUID()
      await commit(latest => {
        let candidate = latest
        for (const menu of pendingMenus.filter(menu => draft.items.some(item => item.menuId === menu.id))) {
          if (candidate.menus.some(item => item.name.normalize('NFKC').trim() === menu.name.normalize('NFKC').trim())) {
            throw new InputError('同名の練習メニューがあります。既存メニューを選んでください。')
          }
          candidate = saveMenu(candidate, menu, '', new Date(), undefined, true)
        }
        return saveRoutine(candidate, { id, startsOn: draft.startsOn as LocalDate, items: draft.items, sourceKey: draft.sourceKey })
      })
      setDraft(undefined)
      setPendingMenus([])
      setFeedback('練習計画を保存しました。')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <>
    <ScreenTitle title="練習計画の管理" icon={CalendarRange} />
    {!confirmingImport && <section className="card">
      <button type="button" className="action back-button" onClick={back} disabled={busy}>設定へ戻る</button>
      <h2>現在の練習計画</h2>
      {current ? <>
        <p className="hint">適用開始 {current.startsOn}</p>
        <ul className="entries">{current.items.filter(item => !isMenuDeleted(data, today, item.menuId)).map(item => <li key={item.id}>
          <strong>{item.group && item.group + ' · '}{item.name}</strong> · {scheduleLabel(item)}{isMenuHidden(menus, item.menuId) && ' · 非表示'}{item.target && ' · ' + item.target.amount + item.target.unit}
          {item.condition && <p className="hint">{item.condition}</p>}{item.note && <p className="entry-note">{item.note}</p>}
        </li>)}</ul>
      </> : <p className="hint">今日適用される計画はまだありません。</p>}
      <div className="form-actions">
        <button className="action filled" disabled={busy} onClick={() => start(today, current?.items ?? [])}>{current ? '変更版を作る' : '計画を作る'}</button>
        <button className="action" disabled={busy || !current} onClick={() => current && start(nextMonth(now), current.items)}>翌月版を作る</button>
        {!versions.some(item => item.sourceKey) && <button className="action" disabled={busy} onClick={() => {
          setDraft(undefined); setError(''); setFeedback(''); setImporting(true)
        }}>Excel初期取り込み</button>}
      </div>
      {feedback && <p role="status" className="hint">{feedback}</p>}
    </section>}
    {importing && <ExcelImport menus={menus} close={() => setImporting(false)} backup={backup}
      useItems={(items, sourceKey) => start(today, items, sourceKey)} />}
    {draft && <section className="card">
      {confirmingImport
        ? <h2 ref={importHeading} tabIndex={-1}>Excel取り込みの最終確認</h2>
        : <h2>計画を編集</h2>}
      <fieldset className="fields editor" disabled={busy}>
        {confirmingImport && <strong>取り込み予定：{draft.items.length}種目</strong>}
        <label>適用開始日<input type="date" min={today} value={draft.startsOn} onChange={event => setDraft({ ...draft, startsOn: event.target.value })} /></label>
        {!confirmingImport && <div className="form-actions">
          <button type="button" className="action filled" onClick={save}>計画を保存</button>
          <button type="button" className="action" onClick={cancelDraft}>キャンセル</button>
        </div>}
        {!confirmingImport && error && <p role="alert" className="error">{error}</p>}
        {confirmingImport && <>
          <p className="hint">指定日から使う計画を登録します。過去の計画、練習記録、目標履歴は保持されます。</p>
          <div className="form-actions">
            <button type="button" className="action filled" onClick={save} disabled={!draft.items.length || !draft.startsOn || draft.startsOn < today}>初期計画を確定</button>
            <button type="button" className="action" onClick={cancelDraft}>キャンセル</button>
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          <p className="hint">確定前にJSONバックアップを保存してください。</p>
          <button type="button" className="action" onClick={backup}>JSONバックアップを保存</button>
          {feedback && <p role="status" className="hint">{feedback}</p>}
          <h3>取り込み内容</h3>
          <p className="hint">種目名をタップすると編集できます。</p>
        </>}
        {draft.items.map((item, index) => {
          const fields = <>
            <RoutineFields item={item} menus={menus} settings={categorySettings}
              change={next => setDraft({ ...draft, items: draft.items.map((old, i) => i === index ? next : old) })} />
            <button type="button" className="action edit-menu" onClick={() => setDraft({ ...draft, items: draft.items.filter(old => old.id !== item.id) })}>この種目を除外</button>
          </>
          return <details key={item.id} className="excel-preview-group import-draft-item">
            <summary>
              <strong>{item.name || '新しい種目'}</strong>
              <span className="excel-preview-meta">{[item.group, scheduleLabel(item), item.condition,
                findRoutineMenu(menus, item)?.enabled === false && '非表示',
                item.target && item.target.amount + item.target.unit].filter(Boolean).join(' · ')}</span>
            </summary>
            <div className="routine-item">{fields}</div>
          </details>
        })}
        <button type="button" className="action" onClick={() => setDraft({ ...draft, items: [...draft.items, {
          id: crypto.randomUUID(), name: '', schedule: 'weekdays', weekdays: [], note: '', condition: '',
        }] })}>種目を追加</button>
        {confirmingImport && <details><summary>新しい記録メニューを候補に追加</summary>
          <NewPlanMenu add={menu => setPendingMenus([...pendingMenus, { ...menu, id: crypto.randomUUID() }])} /></details>}
      </fieldset>
    </section>}
    <section className="card">
      <h2>計画の履歴・適用予定</h2>
      <ul className="entries">{[...versions].reverse().map(version => <li key={version.id}>
        <details><summary>{version.startsOn} · {version.items.length}種目{version === current ? ' · 適用中' : version.startsOn > today ? ' · 適用予定' : ''}</summary>
          <ul className="compact-list">{version.items.map(item => <li key={item.id}>{item.name} · {scheduleLabel(item)}{isMenuDeleted(data, today, item.menuId) && ' · 削除済み'}{isMenuHidden(menus, item.menuId) && ' · 非表示'}{item.target && ' · ' + item.target.amount + item.target.unit}{item.condition && ' · ' + item.condition}{item.note && ' · ' + item.note}</li>)}</ul>
          <button type="button" className="action edit-menu" disabled={busy} onClick={() => start(version.startsOn > today ? version.startsOn : today, version.items)}>この計画をコピーして編集</button>
        </details>
      </li>)}</ul>
      {!versions.length && <p className="hint">保存済みの計画はありません。</p>}
    </section>
  </>
}


