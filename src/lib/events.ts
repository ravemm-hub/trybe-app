// Tiny global event bus — used to nudge `useUnread` the instant the user
// reads a chat so the bottom-tab badge updates without waiting for the
// 800ms realtime debounce.

type Handler = () => void
const handlers: Record<string, Set<Handler>> = {}

export function emit(event: string) {
  const set = handlers[event]
  if (!set) return
  // Snapshot so handlers that unsubscribe during the loop don't mutate it.
  for (const h of Array.from(set)) { try { h() } catch {} }
}

export function on(event: string, handler: Handler): () => void {
  if (!handlers[event]) handlers[event] = new Set()
  handlers[event].add(handler)
  return () => { handlers[event]?.delete(handler) }
}

export const UNREAD_CHANGED = 'unread_changed'
