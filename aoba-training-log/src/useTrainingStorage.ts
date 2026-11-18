import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createAccountStorage, type AccountState } from './accountStorage'
import { config } from './cloud'
import { snapshotApi } from './snapshotApi'
import { chooseSnapshot, syncOnce, type SyncDecision } from './sync'
import { storage, type Change } from './storage'

export type SyncStatus = '同期済み' | '同期待ち' | '同期中' | 'オフライン' | '同期エラー' | 'データ競合'

export function useTrainingStorage(session: Session | null) {
  const key = session && config ? config.url + '|' + session.user.id : null
  const account = useMemo(() => key ? createAccountStorage(key) : null, [key])
  const [state, setState] = useState<AccountState>()
  const [guest, setGuest] = useState<Awaited<ReturnType<typeof storage.read>>>()
  const [error, setError] = useState(false)
  const [status, setStatus] = useState<SyncStatus>('同期待ち')
  const [decision, setDecision] = useState<SyncDecision>()
  const [choiceError, setChoiceError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const auth = useRef(session)
  const kick = useRef<() => void>(() => {})
  const choosingRef = useRef(false)
  const accept = useCallback((next: AccountState) => {
    setState(current => current && current.version > next.version ? current : next)
  }, [])

  const load = useCallback(() => {
    setError(false)
    if (account) void account.read().then(accept, () => setError(true))
    else void storage.read().then(setGuest, () => setError(true))
  }, [account, accept])

  useEffect(load, [load])
  useEffect(() => { auth.current = session; kick.current() }, [session])

  useEffect(() => {
    if (!account) return
    const lifetime = new AbortController()
    let running = false
    let queued = false
    let retry: number | undefined
    let failures = 0

    async function run() {
      if (lifetime.signal.aborted || choosingRef.current || !auth.current || !account) return
      if (running) { queued = true; return }
      window.clearTimeout(retry)
      if (!navigator.onLine) {
        setStatus('オフライン')
        return
      }
      const request = new AbortController()
      const stop = () => request.abort()
      lifetime.signal.addEventListener('abort', stop, { once: true })
      const timeout = window.setTimeout(stop, 20_000)
      running = true
      setStatus('同期中')
      try {
        const api = snapshotApi(auth.current, request.signal)
        // The bounded loop coalesces finite state transitions and yields between bursts.
        for (let step = 0; step < 10; step++) {
          const result = await syncOnce(account, api, storage.read, request.signal)
          if (lifetime.signal.aborted) return
          accept(await account.read())
          if (lifetime.signal.aborted) return
          if (result === 'again') continue
          failures = 0
          if (result === 'synced') {
            setDecision(undefined)
            setStatus('同期済み')
          } else {
            setDecision(result)
            setStatus(result.kind === 'conflict' ? 'データ競合' : '同期待ち')
          }
          return
        }
        setStatus('同期待ち')
        retry = window.setTimeout(schedule, 1000)
      } catch {
        if (lifetime.signal.aborted) return
        setStatus(navigator.onLine ? '同期エラー' : 'オフライン')
        failures += 1
        retry = window.setTimeout(schedule, Math.min(60_000, 2000 * 2 ** Math.min(failures, 5)))
      } finally {
        running = false
        window.clearTimeout(timeout)
        lifetime.signal.removeEventListener('abort', stop)
        if (queued) { queued = false; schedule() }
      }
    }

    function schedule() { void run() }
    function offline() { setStatus('オフライン') }
    function visible() { if (document.visibilityState === 'visible') schedule() }

    kick.current = schedule
    window.addEventListener('online', schedule)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', visible)
    const poll = window.setInterval(visible, 30_000)
    schedule()
    return () => {
      lifetime.abort()
      kick.current = () => {}
      window.clearInterval(poll)
      window.clearTimeout(retry)
      window.removeEventListener('online', schedule)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [account, accept])

  const update = async (edit: Change) => {
    if (!account) {
      const next = await storage.update(edit)
      setGuest(next)
      return next
    }
    const next = await account.save(edit)
    accept(next)
    setStatus(navigator.onLine ? '同期待ち' : 'オフライン')
    kick.current()
    return next.data
  }

  async function choose(choice: 'local' | 'remote') {
    if (!account || !decision || choosingRef.current || !navigator.onLine) return
    choosingRef.current = true
    setChoosing(true)
    setChoiceError('')
    try {
      if (decision.source === 'guest' && JSON.stringify(await storage.read()) !== JSON.stringify(decision.local)) {
        throw new Error('未ログイン時のデータが変更されました。もう一度ご確認ください。')
      }
      accept(await chooseSnapshot(account, decision, choice))
      setDecision(undefined)
    } catch (error) {
      setChoiceError(error instanceof Error ? error.message : '保存内容を選択できませんでした。')
    } finally {
      choosingRef.current = false
      setChoosing(false)
      kick.current()
    }
  }

  return {
    data: account ? state?.data : guest,
    read: async () => account ? (await account.read()).data : storage.read(),
    update, load, loadFailed: error,
    sync: account ? {
      status, decision, choosing, choiceError, choose, retry: () => kick.current(),
      lastSynced: state?.lastSynced, archives: state?.archives ?? [],
    } : undefined,
  }
}

export type SyncView = NonNullable<ReturnType<typeof useTrainingStorage>['sync']>
