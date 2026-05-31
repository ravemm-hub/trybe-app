import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getGroupUnread } from '../services/messages'
import { getDMUnread } from '../services/dms'
import { on, UNREAD_CHANGED } from '../lib/events'
import { setAppBadge } from '../lib/push'
import { getUnreadNotificationCount } from '../services/social'

export function useUnread() {
  const [groupUnread, setGroupUnread] = useState(0)
  const [dmUnread, setDmUnread] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAppBadge(0); return }
      const { data: myGroups } = await supabase.from('group_members').select('group_id, last_read_at').eq('user_id', user.id)
      let total = 0
      for (const g of myGroups || []) {
        total += await getGroupUnread(g.group_id, user.id, g.last_read_at || new Date(0).toISOString())
      }
      const dm = await getDMUnread(user.id)
      const notif = await getUnreadNotificationCount(user.id).catch(() => 0)
      setGroupUnread(total)
      setDmUnread(dm)
      // Sync the launcher-icon badge to the true unread total (groups + DMs +
      // social notifications). Pushes increment via the OS; this brings it back
      // in sync when the user has read messages without tapping a push.
      setAppBadge(total + dm + notif)
    } catch {}
  }, [])

  // Coalesce bursts of realtime events into a single refresh.
  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { refresh() }, 300)
  }, [refresh])

  useEffect(() => {
    refresh()
    const channel = supabase.channel('unread-global')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages' }, scheduleRefresh)
      // last_read_at changes when you open a chat -> recompute so the badge drops.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_members' }, scheduleRefresh)
      .subscribe()
    // Local event bus — fires the moment markGroupRead / markDMRead runs
    // (no realtime round-trip, no debounce). Keeps the badge instant.
    const off = on(UNREAD_CHANGED, () => { refresh() })
    return () => { if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel); off() }
  }, [refresh, scheduleRefresh])

  return { groupUnread, dmUnread, total: groupUnread + dmUnread, refresh }
}
