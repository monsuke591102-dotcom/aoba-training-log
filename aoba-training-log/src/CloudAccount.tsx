import { useState, type FormEvent } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { ChevronLeft, Cloud } from 'lucide-react'
import { supabase } from './cloud'
import { compareBackupCounts, encodeBackup, replacesMatches } from './backup'
import { downloadBackup } from './DataManagement'
import { localDate } from './dates'
import type { TrainingData } from './model'
import type { SyncView } from './useTrainingStorage'
import { ScreenTitle } from './ScreenTitle'

function EmailSignIn({ client, session }: { client: SupabaseClient; session: Session | null }) {
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const credentials = { email: email.trim(), password }
      const result = registering
        ? await client.auth.signUp({
          ...credentials,
          options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href },
        })
        : await client.auth.signInWithPassword(credentials)
      if (result.error) {
        if (result.error.code === 'email_not_confirmed') {
          setError('メール確認が完了していません。登録時の確認メールのリンクを開いてから、ログインしてください。')
        } else if (registering && result.error.code === 'weak_password') {
          setError('このパスワードは登録条件を満たしていません。長く、推測しにくいパスワードを設定してください。')
        } else if (registering) {
          setError('新規登録できませんでした。入力内容を確認してください。登録済みの場合はログインをお試しください。')
        } else {
          setError('ログインできませんでした。メールアドレス、アプリ用パスワード、通信状況をご確認ください。')
        }
        return
      }
      setPassword('')
      if (registering && !result.data.session) {
        setRegistering(false)
        setMessage('確認メールが届いたら、メール内のリンクを開いてください。確認後にこの画面でログインできます。すでに登録済みの場合は、そのままログインをお試しください。')
      }
    } catch {
      setError('認証サービスに接続できませんでした。通信状況を確認して、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
      setMessage('ログアウトしました。')
    } catch {
      setError('ログアウトできませんでした。通信状況を確認して再度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return <>
    {session ? <>
        <p className="hint">ログイン済み</p>
        <div className="form-actions"><button type="button" className="action" disabled={busy} onClick={signOut}>ログアウト</button></div>
      </> : <form className="editor" onSubmit={submit}>
        <fieldset className="fields" disabled={busy}>
          <label>メールアドレス<input type="email" autoComplete="email" autoCapitalize="none" required
            value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>アプリ用パスワード<input type="password" autoComplete={registering ? 'new-password' : 'current-password'}
            required value={password} onChange={event => setPassword(event.target.value)} /></label>
          {registering && <p className="hint">Supabase管理画面とは別のパスワードを設定してください。</p>}
          <button type="submit" className="action filled">{registering ? '新規登録する' : 'ログイン'}</button>
          <button type="button" className="action" onClick={() => {
            setRegistering(!registering)
            setPassword('')
            setError('')
            setMessage('')
          }}>{registering ? 'ログインに戻る' : '新規登録'}</button>
        </fieldset>
      </form>}
    {message && <p className="hint" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </>
}

export function CloudAccount({ back, session, sync }: { back: () => void; session: Session | null; sync?: SyncView }) {
  return <>
    <ScreenTitle title="クラウドアカウント" icon={Cloud} />
    <section className="card">
      <button className="action back-button" onClick={back}><ChevronLeft size={16} aria-hidden="true" />設定へ戻る</button>
      <h2>メールアドレスとパスワード</h2>
      <p className="hint">記録は先に端末に保存されます。ログインしている間は、同じアカウントのクラウドに同期します。</p>
      {supabase ? <EmailSignIn client={supabase} session={session} /> : <p className="hint">クラウド接続は未設定です。練習記録やバックアップは引き続き利用できます。</p>}
    </section>
    {sync && <SyncPanel sync={sync} />}
  </>
}



function SyncPanel({ sync }: { sync: SyncView }) {
  const { decision } = sync
  const counts = decision && compareBackupCounts(decision.local, decision.remote?.data ?? decision.local)
  const localRisk = decision?.remote ? replacesMatches(decision.remote.data, decision.local) : false
  const remoteRisk = decision ? replacesMatches(decision.local, decision.remote?.data) : false
  const [protectedDecision, setProtectedDecision] = useState<typeof decision>()
  const backupConfirmed = protectedDecision === decision
  const [downloadError, setDownloadError] = useState(false)
  const blocked = sync.choosing || sync.status === '同期中' || sync.status === 'オフライン'

  function exportCopy(data: TrainingData, suffix: string, createdAt = new Date()) {
    setDownloadError(false)
    try {
      downloadBackup(encodeBackup(data), 'aoba-sync-' + suffix + '-' + localDate(createdAt) + '.json')
    } catch { setDownloadError(true) }
  }
  return <section className="card restore-preview">
    <h2>クラウド同期</h2>
    <p className="hint" role="status">{sync.status}</p>
    <p className="hint">最終同期 {sync.lastSynced
      ? <time dateTime={sync.lastSynced}>{new Date(sync.lastSynced).toLocaleString('ja-JP')}</time>
      : 'まだありません'}</p>
    {sync.status === '同期エラー' && <p className="hint">未送信の変更は端末に保持されます。通信とログイン状態を確認してください。</p>}
    <button className="action edit-menu" type="button" disabled={blocked} onClick={sync.retry}>同期を確認</button>
    {decision && <div className="editor">
      <h3>{decision.kind === 'initial' ? '初回同期で使うデータを選ぶ' : '端末とクラウドの変更が競合しています'}</h3>
      <p className="restore-warning">{decision.source === 'guest' ? '未ログイン時の記録をこのアカウントにコピーするか選べます。元の端末内データは保持されます。'
        : '同期に使用しない側の内容は、この端末で退避し、JSONとして保存できます。'}</p>
      <table className="restore-counts">
        <thead><tr><th scope="col">データ</th><th scope="col">端末</th><th scope="col">クラウド</th></tr></thead>
        <tbody>{counts?.map(({ key, label, current, restored }) => <tr key={key}>
          <th scope="row">{label}</th><td>{current}件</td><td>{decision.remote ? restored + '件' : '—'}</td>
        </tr>)}</tbody>
      </table>
      <div className="form-actions">
        <button className="action" onClick={() => exportCopy(decision.local, 'device')}>端末の候補を保存</button>
        {decision.remote && <button className="action" onClick={() => exportCopy(decision.remote!.data, 'cloud')}>クラウドの候補を保存</button>}
      </div>
      {(localRisk || remoteRisk) && <div className="fields">
        <p className="restore-warning">候補によっては試合記録や振り返りの一部が置き換わります。選択前に、表示されている候補をJSONで保存してください。</p>
        <label className="checkbox"><input type="checkbox" checked={backupConfirmed} disabled={blocked}
          onChange={event => setProtectedDecision(event.target.checked ? decision : undefined)} />候補のバックアップファイルを保存したことを確認しました</label>
      </div>}
      <div className="form-actions">
        <button className="action filled" disabled={blocked || (localRisk && !backupConfirmed)} onClick={() => sync.choose('local')}>端末のデータで同期</button>
        <button className="action" disabled={blocked || (remoteRisk && !backupConfirmed)} onClick={() => sync.choose('remote')}>
          {decision.remote ? 'クラウドのデータを使う' : 'クラウドの空の状態を使う'}
        </button>
      </div>
    </div>}
    {sync.choiceError && <p className="error" role="alert">{sync.choiceError}</p>}
    {sync.archives.length > 0 && <details className="editor">
      <summary>退避したデータ</summary>
      <ul className="entries">{sync.archives.map((archive, index) => <li key={index}>
        <p className="hint">{new Date(archive.createdAt).toLocaleString('ja-JP')}</p>
        <button className="action" onClick={() => exportCopy(archive.data, 'archive-' + (index + 1), new Date(archive.createdAt))}>退避データを保存</button>
      </li>)}</ul>
    </details>}
    {downloadError && <p className="error" role="alert">JSONを書き出せませんでした。</p>}
  </section>
}

