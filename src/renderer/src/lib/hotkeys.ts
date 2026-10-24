export function isTypingTarget(): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLElement && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
  )
}
