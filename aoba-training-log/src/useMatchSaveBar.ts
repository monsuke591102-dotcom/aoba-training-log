import { useEffect, useRef } from 'react'

export function useMatchSaveBar(active = true) {
  const editor = useRef<HTMLElement>(null)
  const saveBar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const section = editor.current
    const bar = saveBar.current
    if (!section || !bar) return
    const viewport = window.visualViewport
    let fullHeight = viewport?.height ?? window.innerHeight
    const measure = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height)
      if (height) section.style.setProperty('--batting-save-height', height + 'px')
    }
    const updateKeyboard = () => {
      const focused = document.activeElement
      const typing = focused instanceof HTMLElement && section.contains(focused) &&
        focused.matches('textarea, input:not([type]), input[type="text"]')
      const visibleHeight = viewport?.height ?? window.innerHeight
      if (!typing || (viewport?.scale ?? 1) !== 1) fullHeight = visibleHeight
      section.toggleAttribute('data-batting-keyboard', typing &&
        (viewport?.scale ?? 1) === 1 && Math.max(fullHeight, window.innerHeight) - visibleHeight > 120)
    }
    const resize = new ResizeObserver(measure)
    resize.observe(bar)
    measure()
    viewport?.addEventListener('resize', updateKeyboard)
    window.addEventListener('resize', updateKeyboard)
    section.addEventListener('focusin', updateKeyboard)
    section.addEventListener('focusout', updateKeyboard)
    return () => {
      resize.disconnect()
      viewport?.removeEventListener('resize', updateKeyboard)
      window.removeEventListener('resize', updateKeyboard)
      section.removeEventListener('focusin', updateKeyboard)
      section.removeEventListener('focusout', updateKeyboard)
    }
  }, [active])

  return { editor, saveBar }
}
