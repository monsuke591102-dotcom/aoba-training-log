import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { HOLD_MS, movedOutsidePress, pressStep } from './quickRecord'

export function StepButton({ direction, label, disabled, step }: {
  direction: 'plus' | 'minus'; label: string; disabled: boolean; step: (units: number) => void
}) {
  const press = useRef<{ id: number; x: number; y: number; start: number } | undefined>(undefined)
  const timer = useRef<number | undefined>(undefined)
  const [held, setHeld] = useState(false)
  const Icon = direction === 'plus' ? Plus : Minus

  function cancel() {
    press.current = undefined
    window.clearTimeout(timer.current)
    setHeld(false)
  }

  useEffect(() => {
    function hidden() { if (document.visibilityState !== 'visible') cancel() }
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.clearTimeout(timer.current)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])

  useEffect(() => { if (disabled) cancel() }, [disabled])

  function down(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || press.current || disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: performance.now() }
    timer.current = window.setTimeout(() => setHeld(true), HOLD_MS)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = press.current
    if (active?.id === event.pointerId && movedOutsidePress(active.x, active.y, event.clientX, event.clientY)) cancel()
  }

  function up(event: PointerEvent<HTMLButtonElement>) {
    const active = press.current
    if (active?.id !== event.pointerId) return
    cancel()
    if (!disabled && !movedOutsidePress(active.x, active.y, event.clientX, event.clientY)) {
      step(pressStep(performance.now() - active.start))
    }
  }

  return <button type="button" className={'action quick-step ' + direction} aria-label={label}
    disabled={disabled} data-held={held || undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel}
    onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) step(1) }}
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      if (!event.repeat && !disabled) step(event.shiftKey ? 10 : 1)
    }}
    onKeyUp={event => { if (event.key === 'Enter' || event.key === ' ') event.preventDefault() }}>
    {held ? <span aria-hidden="true">{direction === 'plus' ? '+10' : '−10'}</span> : <Icon size={22} aria-hidden="true" />}
  </button>
}


