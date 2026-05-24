import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getGroupUnread } from '../services/messages'
import { getDMUnread } from '../services/dms'

export function useUnread() {
  const [groupUnread, setGroupUnread] = useState(0)
  const [dmUnread, setDmUnread] = useState(0)

  const refresh = async () => {
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
  }

  useEffect(() => {
    refresh()
    const channel = supabase.channel('unread-global')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return { groupUnread, dmUnread, total: groupUnread + dmUnread, refresh }
}
