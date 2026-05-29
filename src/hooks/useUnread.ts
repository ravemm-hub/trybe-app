import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getGroupUnread } from '../services/messages'
import { getDMUnread } from '../services/dms'

export function useUnread() {
  const [groupUnread, setGroupUnread] = useState(0)
  const [dmUnread, setDmUnread] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: myGroups } = await supabase.from('group_members').select('group_id, last_read_at').eq('user_id', user.id)
      let total = 0
      for (const g of myGroups || []) {
        total += await getGroupUnread(g.group_id, user.id, g.last_read_at || new Date(0).toISOString())
      }
      setGroupUnread(total)
      setDmUnread(await getDMUnread(user.id))
    } catch {}
  }, [])

  // Coalesce bursts of realtime events into a single refresh.
  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { refresh() }, 800)
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
    return () => { if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel) }
  }, [refresh, scheduleRefresh])

  return { groupUnread, dmUnread, total: groupUnread + dmUnread, refresh }
}
