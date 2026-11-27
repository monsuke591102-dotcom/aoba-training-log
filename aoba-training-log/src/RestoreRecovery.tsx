import { useEffect, useState } from 'react'
import { encodeBackup } from './backup'
import { downloadBackup } from './DataManagement'
import type { RestoreReview } from './localMatchStorage'
import type { TrainingData } from './model'

const candidates = [
  ['before', '復元開始時'],
  ['current', '現在の保存データ（別タブの更新を含む）'],
  ['proposed', '保留中の復元予定'],
] as const

function details(data: TrainingData) {
  const matches = data.matches ?? []
  const updatedAt = [...data.records, ...matches].map(row => row.updatedAt).sort().at(-1)
  return { matches, updatedAt }
}

export function RestoreRecovery({ owner, inspect, resume, reload, logout }: {
  owner: string
  inspect: () => Promise<RestoreReview | undefined>
  resume: (review: RestoreReview) => Promise<void>
  reload: () => void
  logout?: () => Promise<void>
}) {
  const [review, setReview] = useState<RestoreReview>()
  const [saved, setSaved] = useState(false)
  const [exported, setExported] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void inspect().then(value => { if (active) setReview(value) },
      () => { if (active) setError('候補を読み込めませんでした。') })
    return () => { active = false }
  }, [inspect])

  async function refresh() {
    setBusy(true)
    setError('')
    setSaved(false)
    setExported(false)
    setStatus('')
    try {
      const latest = await inspect()
      setReview(latest)
      if (!latest) reload()
    } catch {
      setError('候補を読み込めませんでした。')
    } finally { setBusy(false) }
  }

  function exportCandidate(candidate?: typeof candidates[number][0]) {
    if (!review) return
    setError('')
    try {
      if (candidate) {
        downloadBackup(encodeBackup(review[candidate]), 'aoba-recovery-' + candidate + '-' + review.id + '.json')
      } else {
        const { id, detectedAt, before, current, proposed, base } = review
        downloadBackup(JSON.stringify({ format: 'aoba-restore-diagnostic', version: 1, id, detectedAt,
          before, current, proposed, base }, null, 2), 'aoba-restore-diagnostic-' + id + '.json')
        setExported(true)
      }
      setStatus('ダウンロードを開始しました。「ファイル」またはブラウザーの保存先を確認してください。')
    } catch {
      setError('この候補を通常バックアップにできませんでした。診断用JSONを保存してください。')
    }
  }

  async function confirm() {
    if (!review || !saved) return
    setBusy(true)
    setError('')
    try { await resume(review) }
    catch (failure) {
      setSaved(false)
      setExported(false)
      setError(failure instanceof Error ? failure.message : '復旧を確認できませんでした。')
    } finally { setBusy(false) }
  }

  return <section className="card" aria-labelledby="restore-conflict-title">
    <h2 id="restore-conflict-title">復元の衝突</h2>
    <p role="alert">復元処理と別のタブの更新が衝突しました。データを保護するため、読み込みと同期を停止しています。</p>
    <p>再読み込みだけでは解消しません。別のタブを閉じ、サイトデータを消去せずに、候補を保存してから復旧してください。</p>
    <p>対象 {owner}</p>
    {review && <>
      <p>検出日時 <time dateTime={review.detectedAt}>{new Date(review.detectedAt).toLocaleString('ja-JP')}</time></p>
      {candidates.map(([id, label]) => {
        const data = review[id]
        const { matches, updatedAt } = details(data)
        return <section key={id}>
          <h3>{label}</h3>
          <p>練習記録 {data.records.length}件 · 試合 {matches.length}件 · 詳細付き {matches.filter(row => row.details).length}件</p>
          <p>記録・試合の最終更新 {updatedAt ? new Date(updatedAt).toLocaleString('ja-JP') : '—'}</p>
          {matches.length > 0 && <details><summary>試合の日付とID</summary><ul>{matches.map(row =>
            <li key={row.id}>{row.date} · {row.id}</li>)}</ul></details>}
          <button className="action" disabled={busy} onClick={() => exportCandidate(id)}>通常バックアップを保存 ({label})</button>
        </section>
      })}
      <p>通常バックアップには練習記録と試合データが含まれます。ブラウザー共通の月別目標・分類設定は含みません。診断用JSONには3つの候補と元の保存スナップショットがあり、復元画面には読み込めません。</p>
      <button className="action" disabled={busy} onClick={() => exportCandidate()}>診断用JSONを保存</button>
      <p>現在の練習記録と復元前の試合詳細を使って再開します。復元予定の内容は端末内に退避します。必要な場合は、保存した通常バックアップから、内容と復元先を確認して改めて復元できます。</p>
      {review.hasSettings && <p>月別目標・分類は現在の端末設定を保持します。復元が途中まで反映している場合があるため、再開後に確認してください。</p>}
      <p id="restore-export-help" className="hint">{busy ? '処理が完了するまでお待ちください。' : exported
        ? '「ファイル」などで診断用JSONの保存を確認してから、チェックを入れてください。'
        : 'チェックを入れるには、この画面で「診断用JSONを保存」を押してください。候補の再確認やログインし直した後は、診断用JSONを保存し直してください。'}</p>
      <div className="fields">
        <label className="checkbox"><input type="checkbox" disabled={busy || !exported} checked={saved}
          aria-describedby="restore-export-help" onChange={event => setSaved(event.target.checked)} />診断用JSONが保存されたことを確認しました</label>
      </div>
      <button className="action filled" disabled={busy || !saved} onClick={confirm}>現在のデータを保持して再開</button>
    </>}
    <button className="action" disabled={busy} onClick={refresh}>候補を再確認</button>
    {logout && <button className="action" disabled={busy} onClick={async () => {
      setBusy(true)
      try { await logout() }
      catch { setError('ログアウトできませんでした。') }
      finally { setBusy(false) }
    }}>保留したままログアウト</button>}
    {status && <p role="status">{status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
