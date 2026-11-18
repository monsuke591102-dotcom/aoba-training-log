import { useEffect, useState } from 'react'
import { localDate } from './dates'

export function useLocalDay() {
  const [day, setDay] = useState(() => ({ date: localDate(new Date()), changed: false }))

  useEffect(() => {
    let timer: number

    function refresh() {
      window.clearTimeout(timer)
      const now = new Date()
      const date = localDate(now)
      setDay(current => current.date === date ? current : { date, changed: true })
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      // Also recheck after a clock or time-zone change while the page stays visible.
      timer = window.setTimeout(refresh, Math.min(60_000, Math.max(1, +midnight - +now)))
    }

    function visible() {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }, [])

  return day
}
