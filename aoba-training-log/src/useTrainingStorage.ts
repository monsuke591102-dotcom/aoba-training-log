import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createAccountStorage, type AccountState } from './accountStorage'
import { config } from './cloud'
import { snapshotApi, SnapshotWriteDenied } from './snapshotApi'
import { chooseSnapshot, syncOnce, type SyncDecision } from './sync'
import { storage, type Change } from './storage'
import { createLocalMatchStorage, legacySyncData, LocalMatchVersionError, LocalRestoreConflict, type LocalRestoreSettings } from './localMatchStorage'

export type SyncStatus = '同期済み' | '同期待ち' | '同期中' | 'オフライン' | '同期エラー' | '書き込み停止' | 'データ競合' | '復元衝突'

const guestMatches = createLocalMatchStorage('guest', storage)

export function useTrainingStorage(session: Session | null) {
  const separatesMatches = Boolean(navigator.locks)
  const key = session && config ? config.url + '|' + session.user.id : null
  const [matchUpgradeBlocked, setMatchUpgradeBlocked] = useState(false)
  const [matchVersionError, setMatchVersionError] = useState('')
  const account = useMemo(() => key ? createAccountStorage(key) : null, [key])
  const separated = useMemo(() => createLocalMatchStorage(key ?? 'guest', account ? {
    read: async () => (await account.read()).data,
    update: async edit => (await account.save(edit)).data,
  } : storage, undefined, undefined, setMatchUpgradeBlocked), [key, account])
  const read = useCallback(() => separatesMatches ? separated.read()
    : account ? account.read().then(value => value.data) : storage.read(),
  [separatesMatches, separated, account])
  const [state, setState] = useState<AccountState>()
  const [guest, setGuest] = useState<Awaited<ReturnType<typeof storage.read>>>()
  const [error, setError] = useState(false)
  const [restoreConflict, setRestoreConflict] = useState(false)
  const blocked = useRef(false)
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
  const handleRestoreConflict = useCallback((failure: unknown) => {
    if (failure instanceof LocalMatchVersionError) {
      blocked.current = true
      setMatchVersionError(failure.message)
      setDecision(undefined)
      setStatus('書き込み停止')
      return true
    }
    if (!(failure instanceof LocalRestoreConflict) || failure.owner !== (key ?? 'guest')) return false
    blocked.current = true
    setRestoreConflict(true)
    setDecision(undefined)
    setStatus('復元衝突')
    return true
  }, [key])

  const load = useCallback(() => {
    setError(false)
    void read().then(data => {
      setGuest(data)
      setMatchVersionError('')
      if (blocked.current) {
        blocked.current = false
        setRestoreConflict(false)
        setStatus('同期待ち')
        kick.current()
      }
    }, failure => {
      if (!handleRestoreConflict(failure)) setError(true)
    })
    if (account) void account.read().then(accept, () => setError(true))
  }, [account, accept, handleRestoreConflict, read])

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
      if (lifetime.signal.aborted || blocked.current || choosingRef.current || !auth.current || !account) return
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
          const result = separatesMatches ? await separated.exclusive(async () => {
            await separated.ready()
            return syncOnce(account, api, guestMatches.readSync, request.signal)
          }) : await syncOnce(account, api, async () => legacySyncData(await storage.read(), true), request.signal)
          if (lifetime.signal.aborted) return
          accept(await account.read())
          const updated = await read()
          if (lifetime.signal.aborted) return
          setGuest(updated)
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
      } catch (error) {
        if (lifetime.signal.aborted) return
        if (handleRestoreConflict(error)) return
        if (error instanceof SnapshotWriteDenied) {
          setStatus('書き込み停止')
          return
        }
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
    function offline() { if (!blocked.current) setStatus('オフライン') }
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
  }, [account, accept, handleRestoreConflict, separated, separatesMatches, read])

  const update = async (edit: Change, settings?: LocalRestoreSettings) => {
    const next = await (separatesMatches ? separated.update(edit, settings)
      : (account ? account.save(edit).then(value => value.data) : storage.update(edit))
        .then(data => ({ data, syncChanged: true }))).catch(failure => {
      handleRestoreConflict(failure)
      throw failure
    })
    setGuest(next.data)
    if (account && next.syncChanged) {
      accept(await account.read())
      setStatus(navigator.onLine ? '同期待ち' : 'オフライン')
      kick.current()
    }
    return next.data
  }

  async function choose(choice: 'local' | 'remote') {
    if (!account || !decision || choosingRef.current || !navigator.onLine) return
    choosingRef.current = true
    setChoosing(true)
    setChoiceError('')
    try {
      const select = async () => {
        if (separatesMatches) await separated.ready()
        const readGuest = separatesMatches ? guestMatches.readSync : async () => legacySyncData(await storage.read(), true)
        if (decision.source === 'guest' && JSON.stringify(await readGuest()) !== JSON.stringify(decision.local)) {
          throw new Error('未ログイン時のデータが変更されました。もう一度ご確認ください。')
        }
        accept(await chooseSnapshot(account, decision, choice))
      }
      if (separatesMatches) await separated.exclusive(select)
      else await select()
      setGuest(await read())
      setDecision(undefined)
    } catch (error) {
      handleRestoreConflict(error)
      setChoiceError(error instanceof Error ? error.message : '保存内容を選択できませんでした。')
    } finally {
      choosingRef.current = false
      setChoosing(false)
      kick.current()
    }
  }

  return {
    data: guest,
    restoreConflict,
    reviewRecovery: separated.reviewRecovery,
    keepCurrent: async (review: Parameters<typeof separated.keepCurrent>[0]) => {
      const data = await separated.keepCurrent(review)
      if (account) accept(await account.read())
      setGuest(data)
      setError(false)
      blocked.current = false
      setRestoreConflict(false)
      setStatus(navigator.onLine ? '同期待ち' : 'オフライン')
      kick.current()
    },
    read,
    separatesMatches,
    readGuestMatches: account && separatesMatches ? guestMatches.readLocal : undefined,
    copyGuestMatches: account && separatesMatches ? async (entries: Awaited<ReturnType<typeof guestMatches.readLocal>>) => {
      const count = await separated.copyFromGuest(entries).catch(failure => {
        handleRestoreConflict(failure)
        throw failure
      })
      setGuest(await separated.read())
      return count
    } : undefined,
    update, load, loadFailed: error, matchUpgradeBlocked, matchVersionError,
    sync: account ? {
      status, decision, choosing, choiceError, choose, retry: () => kick.current(),
      lastSynced: state?.lastSynced, archives: state?.archives ?? [],
    } : undefined,
  }
}

export type SyncView = NonNullable<ReturnType<typeof useTrainingStorage>['sync']>
