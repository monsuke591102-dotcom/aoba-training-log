import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ChevronLeft, Database } from 'lucide-react'
import { BackupError, backupMatchesRestoreSnapshot, backupRestoreData, compareBackupCounts, decodeBackup, encodeBackup, replacedStrikeoutDetails, replacesMatches, restoreBackup, restoreChange, type Backup } from './backup'
import { localDate } from './dates'
import type { MatchEntry, TrainingData } from './model'
import { readCategorySettings, type CategorySettings } from './menuCategories'
import { readMonthlyGoals, type MonthlyGoal } from './monthlyGoals'
import { ScreenTitle } from './ScreenTitle'
import type { Change } from './storage'
import type { LocalRestoreSettings } from './localMatchStorage'

type SaveWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

export function downloadBackup(contents: string, name: string) {
  const href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = href
  link.download = name
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
  }
}

export function encodeLocalBackup(data: TrainingData, now = new Date()) {
  return encodeBackup(data, now, readMonthlyGoals(window.localStorage), readCategorySettings(window.localStorage))
}

export function DataManagement({ back, restore, read, owner = 'ゲスト', preserveLocalDetails = false, readGuestMatches, copyGuestMatches }: {
  back: () => void; restore: (change: Change, settings?: LocalRestoreSettings) => Promise<void>; read: () => Promise<TrainingData>
  owner?: string; preserveLocalDetails?: boolean
  readGuestMatches?: () => Promise<MatchEntry[]>
  copyGuestMatches?: (entries: MatchEntry[]) => Promise<number>
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{
    backup: Backup; current: TrainingData; monthlyGoals: MonthlyGoal[]; categories: CategorySettings; name: string
  }>()
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const [savedRecoverySnapshot, setSavedRecoverySnapshot] = useState('')
  const [guestCopy, setGuestCopy] = useState<MatchEntry[]>()
  const restored = preview && backupRestoreData(preview.backup, preview.current, preserveLocalDetails)
  const matchRisk = preview && replacesMatches(preview.current, restored)
  const strikeoutReplacements = preview ? replacedStrikeoutDetails(preview.current, restored) : []
  const strikeoutRisk = strikeoutReplacements.length > 0
  const savedCurrentPreview = preview !== undefined && savedRecoverySnapshot === JSON.stringify(preview.current)
  const requiresBackupConfirmation = matchRisk || strikeoutRisk
  const restoreBlocked = (requiresBackupConfirmation && !backupConfirmed) || (strikeoutRisk && !savedCurrentPreview)
  const preserving = preserveLocalDetails && preview?.backup.backupVersion === 1 &&
    preview.current.matches?.some(row => row.details || !row.recordId)
  const input = useRef<HTMLInputElement>(null)
  const savedBackupInput = useRef<HTMLInputElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const active = useRef(false)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  useEffect(() => {
    if (preview) previewHeading.current?.focus()
  }, [preview])

  async function saveBackup() {
    setBackupConfirmed(false)
    setSavedRecoverySnapshot('')
    setError('')
    setStatus('')
    setBusy(true)
    const now = new Date()
    const name = 'aoba-training-log-backup-' + localDate(now) + '.json'
    try {
      const picker = (window as SaveWindow).showSaveFilePicker
      if (picker) {
        let handle: FileSystemFileHandle
        try {
          handle = await picker.call(window, {
            suggestedName: name, types: [{ description: 'JSONバックアップ', accept: { 'application/json': ['.json'] } }],
          })
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setStatus('バックアップの保存をキャンセルしました。')
            return
          }
          throw error
        }
        if (!active.current) return
        const data = await read()
        if (!active.current) return
        const contents = encodeLocalBackup(data, now)
        const writable = await handle.createWritable()
        try {
          await writable.write(contents)
          await writable.close()
        } catch (error) {
          await writable.abort().catch(() => {})
          throw error
        }
        setStatus('バックアップを保存しました。')
        if (preview && active.current) setSavedRecoverySnapshot(JSON.stringify(data))
      } else {
        const data = await read()
        if (!active.current) return
        downloadBackup(encodeLocalBackup(data, now), name)
        if (preview && active.current) setSavedRecoverySnapshot(JSON.stringify(data))
        setStatus('ダウンロードを開始しました。ブラウザのダウンロード先でファイルをご確認ください。')
      }
    } catch {
      setError('バックアップを保存できませんでした。保存先の空き容量やアクセス権を確認して、再度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setStatus('')
    setPreview(undefined)
    setBackupConfirmed(false)
    setSavedRecoverySnapshot('')
    try {
      const backup = decodeBackup(await file.text())
      setPreview({ backup, name: file.name, current: await read(), monthlyGoals: readMonthlyGoals(window.localStorage),
        categories: readCategorySettings(window.localStorage) })
    } catch (error) {
      setError(error instanceof BackupError ? error.message : 'ファイルまたは現在のデータを読み込めませんでした。')
    } finally {
      setBusy(false)
    }
  }

  async function verifySavedBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !preview || !strikeoutRisk) return
    setBusy(true)
    setError('')
    setStatus('')
    setBackupConfirmed(false)
    setSavedRecoverySnapshot('')
    try {
      const backup = decodeBackup(await file.text())
      const current = await read()
      if (!active.current) return
      const goals = readMonthlyGoals(window.localStorage)
      const categories = readCategorySettings(window.localStorage)
      if (!backupMatchesRestoreSnapshot(backup, preview.current, preview.monthlyGoals, preview.categories) ||
        !backupMatchesRestoreSnapshot(backup, current, goals, categories)) {
        throw new BackupError('保存したファイルが現在の復元先のデータと一致しません。復元内容と退避ファイルを確認してください。')
      }
      setSavedRecoverySnapshot(JSON.stringify(current))
      setStatus('退避ファイルを確認しました。復元内容と保存先を確認し、確認欄にチェックしてください。')
    } catch (error) {
      if (active.current) setError(error instanceof BackupError ? error.message : '退避ファイルを読み込めませんでした。')
    } finally {
      if (active.current) setBusy(false)
    }
  }

  async function confirmRestore() {
    if (!preview || restoreBlocked) return
    setBusy(true)
    setError('')
    try {
      if (strikeoutRisk) {
        const current = await read()
        if (!active.current) return
        if (JSON.stringify(current) !== savedRecoverySnapshot ||
          JSON.stringify(readMonthlyGoals(window.localStorage)) !== JSON.stringify(preview.monthlyGoals) ||
          JSON.stringify(readCategorySettings(window.localStorage)) !== JSON.stringify(preview.categories)) {
          throw new BackupError('確認後に現在のデータが変更されました。復元するファイルを選び直してください。')
        }
      }
      if (preserveLocalDetails) {
        await restore(restoreChange(preview.backup, preview.current, true, strikeoutRisk && savedCurrentPreview && backupConfirmed), {
          goals: preview.backup.monthlyGoals && { before: preview.monthlyGoals, after: preview.backup.monthlyGoals },
          categories: preview.backup.menuCategories && { before: preview.categories, after: preview.backup.menuCategories },
        })
      } else {
        await restoreBackup(preview.backup, preview.current, preview.monthlyGoals, window.localStorage, restore, preview.categories)
      }
      setPreview(undefined)
      setStatus('バックアップから復元しました。')
    } catch (error) {
      setError(error instanceof BackupError ? error.message : '復元を完了できませんでした。画面を開き直して、復元結果を確認してください。')
      if (error instanceof BackupError) setPreview(undefined)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <ScreenTitle title="データ管理" icon={Database} />
    <section className="card">
      <button className="action back-button" disabled={busy} onClick={back}><ChevronLeft size={16} aria-hidden="true" />設定へ戻る</button>
      <h2>バックアップと復元</h2>
      <p className="hint">記録は基本的にこの端末・ブラウザに保存されます。アプリを削除したり、ブラウザのデータを消去したりすると、記録が失われる場合があります。</p>
      <p className="hint">定期的にバックアップを作成し、JSONファイルはご自身で安全な場所に保管してください。</p>
      <p className="hint">試合詳細はアプリ内に保存され、別端末には自動同期されません。Safariとホーム画面のアプリで保存領域が分かれる場合があります。</p>
      <p className="hint">保存後に復元確認が閉じた場合は、同じアカウントで復元するファイルを選び直してください。振り逃げの内訳が変わる復元では「保存済みの退避ファイルを確認」から、すでに保存したファイルを照合できます。</p>
      <div className="form-actions">
        <button className="action filled" disabled={busy} onClick={saveBackup}>バックアップを保存</button>
        <button className="action" disabled={busy} onClick={() => input.current?.click()}>バックアップから復元</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={selectFile} />
      </div>
      {status && <p className="hint" role="status">{status}</p>}
      {error && !preview && <p className="error" role="alert">{error}</p>}
    </section>
    {readGuestMatches && copyGuestMatches && <section className="card">
      <h2>ゲストの試合をコピー</h2>
      {!guestCopy ? <button className="action" disabled={busy} onClick={async () => {
        setBusy(true)
        setError('')
        try { setGuestCopy(await readGuestMatches()) }
        catch { setError('ゲストの試合を読み込めませんでした。') }
        finally { setBusy(false) }
      }}>コピーする試合を確認</button> : <>
        <p>ゲストの端末内試合 {guestCopy.length}件を {owner} の端末内にコピーします。ゲストの元データは残ります。</p>
        <div className="form-actions">
          <button className="action" disabled={busy || !guestCopy.length} onClick={async () => {
            setBusy(true)
            setError('')
            try {
              setStatus((await copyGuestMatches(guestCopy)) + '件コピーしました。')
              setGuestCopy(undefined)
            } catch { setError('ゲストの試合をコピーできませんでした。') }
            finally { setBusy(false) }
          }}>このアカウントにコピー</button>
          <button className="action" disabled={busy} onClick={() => setGuestCopy(undefined)}>キャンセル</button>
        </div>
      </>}
    </section>}
    {preview && <section className="card restore-preview" aria-labelledby="restore-title">
      <h2 id="restore-title" tabIndex={-1} ref={previewHeading}>復元内容を確認</h2>
      <p className="hint">{preview.name}</p>
      <p className="hint">作成日時 <time dateTime={preview.backup.createdAt}>{new Date(preview.backup.createdAt).toLocaleString('ja-JP')}</time></p>
      <p className="hint">復元先 {owner} · ファイル内の試合 {(preview.backup.data.matches ?? []).length}件</p>
      <p className="restore-warning">{preserving
        ? '練習記録などを置き換えます。端末内の試合詳細は保持します。'
        : '現在の練習記録と試合データをバックアップの内容に置き換えます。'}</p>
      {preview.backup.monthlyGoals === undefined && <p className="hint">このファイルに月別目標の項目がないため、現在の月別目標は保持されます。</p>}
      {preview.backup.menuCategories === undefined && <p className="hint">このファイルに分類設定がないため、現在の分類設定は保持されます。</p>}
      <table className="restore-counts">
        <thead><tr><th scope="col">データ</th><th scope="col">現在</th><th scope="col">復元後</th></tr></thead>
        <tbody>{compareBackupCounts(preview.current, restored ?? preview.backup.data).map(({ key, label, current, restored }) =>
          <tr key={key}><th scope="row">{label}</th><td>{current}件</td><td>{restored}件</td></tr>,
        )}
          <tr><th scope="row">月別目標</th><td>{preview.monthlyGoals.length}件</td>
            <td>{(preview.backup.monthlyGoals ?? preview.monthlyGoals).length}件</td></tr>
          <tr><th scope="row">メニュー分類</th><td>{preview.categories.categories.length}件</td>
            <td>{(preview.backup.menuCategories ?? preview.categories).categories.length}件</td></tr>
        </tbody>
      </table>
      {error && <p className="error" role="alert">{error}</p>}
      {requiresBackupConfirmation && <div className="fields">
        <p className="restore-warning">現在の試合記録や振り返りの一部が置き換わります。復元前に「バックアップを保存」で現在のデータを保存してください。</p>
        {strikeoutRisk && <>
          <p className="restore-warning">現在の振り逃げの内訳 {strikeoutReplacements.length}件が失われるか変更されます。</p>
          <ul className="compact-list">{strikeoutReplacements.map(row => <li key={row.matchId + ':' + row.plateId}>
            {row.date} {row.opponent} · 試合ID {row.matchId} · 第{row.order}打席 · {row.kind === 'swinging' ? '空振り' : '見逃し'}
          </li>)}</ul>
          {!savedCurrentPreview && <p className="hint">現在のバックアップを保存するか、保存済みの退避ファイルを確認すると、確認欄が有効になります。</p>}
          <button className="action" disabled={busy} onClick={() => savedBackupInput.current?.click()}>保存済みの退避ファイルを確認</button>
          <input ref={savedBackupInput} type="file" accept=".json,application/json" hidden onChange={verifySavedBackup} />
        </>}
        <label className="checkbox"><input type="checkbox" checked={backupConfirmed} disabled={busy || (strikeoutRisk && !savedCurrentPreview)}
          onChange={event => setBackupConfirmed(event.target.checked)} />現在のバックアップファイルを保存したことを確認しました</label>
      </div>}
      <div className="form-actions">
        <button className="action danger" disabled={busy || restoreBlocked} onClick={confirmRestore}>{preserving ? '試合詳細を保持して復元' : '全データを置き換えて復元'}</button>
        <button className="action" disabled={busy} onClick={() => {
          setPreview(undefined)
          setError('')
          setStatus('復元をキャンセルしました。')
        }}>キャンセル</button>
      </div>
    </section>}
  </>
}


