import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ChevronLeft, Database } from 'lucide-react'
import { BackupError, compareBackupCounts, decodeBackup, encodeBackup, replacesMatches, restoreBackup, type Backup } from './backup'
import { localDate } from './dates'
import type { TrainingData } from './model'
import { readCategorySettings, type CategorySettings } from './menuCategories'
import { readMonthlyGoals, type MonthlyGoal } from './monthlyGoals'
import { ScreenTitle } from './ScreenTitle'
import type { Change } from './storage'

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

export function DataManagement({ back, restore, read }: { back: () => void; restore: (change: Change) => Promise<void>; read: () => Promise<TrainingData> }) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{
    backup: Backup; current: TrainingData; monthlyGoals: MonthlyGoal[]; categories: CategorySettings; name: string
  }>()
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const matchRisk = preview && replacesMatches(preview.current, preview.backup.data)
  const input = useRef<HTMLInputElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (preview) previewHeading.current?.focus()
  }, [preview])

  async function saveBackup() {
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
        const contents = encodeLocalBackup(await read(), now)
        const writable = await handle.createWritable()
        try {
          await writable.write(contents)
          await writable.close()
        } catch (error) {
          await writable.abort().catch(() => {})
          throw error
        }
        setStatus('バックアップを保存しました。')
      } else {
        downloadBackup(encodeLocalBackup(await read(), now), name)
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

  async function confirmRestore() {
    if (!preview || (matchRisk && !backupConfirmed)) return
    setBusy(true)
    setError('')
    try {
      await restoreBackup(preview.backup, preview.current, preview.monthlyGoals, window.localStorage, restore, preview.categories)
      setPreview(undefined)
      setStatus('バックアップから復元しました。')
    } catch (error) {
      setError(error instanceof BackupError ? error.message : '復元できませんでした。現在のデータは保持されています。')
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
      <div className="form-actions">
        <button className="action filled" disabled={busy} onClick={saveBackup}>バックアップを保存</button>
        <button className="action" disabled={busy} onClick={() => input.current?.click()}>バックアップから復元</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={selectFile} />
      </div>
      {status && <p className="hint" role="status">{status}</p>}
      {error && !preview && <p className="error" role="alert">{error}</p>}
    </section>
    {preview && <section className="card restore-preview" aria-labelledby="restore-title">
      <h2 id="restore-title" tabIndex={-1} ref={previewHeading}>復元内容を確認</h2>
      <p className="hint">{preview.name}</p>
      <p className="hint">作成日時 <time dateTime={preview.backup.createdAt}>{new Date(preview.backup.createdAt).toLocaleString('ja-JP')}</time></p>
      <p className="restore-warning"><strong>現在のデータが置き換えられます。</strong> バックアップに含まれない現在のデータは、復元後に表示されなくなります。</p>
      {preview.backup.monthlyGoals === undefined && <p className="hint">このファイルに月別目標の項目がないため、現在の月別目標は保持されます。</p>}
      {preview.backup.menuCategories === undefined && <p className="hint">このファイルに分類設定がないため、現在の分類設定は保持されます。</p>}
      <table className="restore-counts">
        <thead><tr><th scope="col">データ</th><th scope="col">現在</th><th scope="col">復元後</th></tr></thead>
        <tbody>{compareBackupCounts(preview.current, preview.backup.data).map(({ key, label, current, restored }) =>
          <tr key={key}><th scope="row">{label}</th><td>{current}件</td><td>{restored}件</td></tr>,
        )}
          <tr><th scope="row">月別目標</th><td>{preview.monthlyGoals.length}件</td>
            <td>{(preview.backup.monthlyGoals ?? preview.monthlyGoals).length}件</td></tr>
          <tr><th scope="row">メニュー分類</th><td>{preview.categories.categories.length}件</td>
            <td>{(preview.backup.menuCategories ?? preview.categories).categories.length}件</td></tr>
        </tbody>
      </table>
      {error && <p className="error" role="alert">{error}</p>}
      {matchRisk && <div className="fields">
        <p className="restore-warning">現在の試合記録や振り返りの一部が置き換わります。復元前に「バックアップを保存」で現在のデータを保存してください。</p>
        <label className="checkbox"><input type="checkbox" checked={backupConfirmed} disabled={busy}
          onChange={event => setBackupConfirmed(event.target.checked)} />現在のバックアップファイルを保存したことを確認しました</label>
      </div>}
      <div className="form-actions">
        <button className="action danger" disabled={busy || (matchRisk && !backupConfirmed)} onClick={confirmRestore}>全データを置き換えて復元</button>
        <button className="action" disabled={busy} onClick={() => {
          setPreview(undefined)
          setError('')
          setStatus('復元をキャンセルしました。')
        }}>キャンセル</button>
      </div>
    </section>}
  </>
}


