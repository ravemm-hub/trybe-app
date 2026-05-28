import { supabase } from '../lib/supabase'
import { sendPush } from '../lib/push'

export async function getGroupMembers(groupId: string) {
  const { data } = await supabase.from('group_members')
    .select('user_id, role, profile:profiles(id, display_name, username, avatar_char)')
    .eq('group_id', groupId)
  return data || []
}

// Adds app users to a group (RLS allows authenticated inserts). Skips existing members,
// posts a system message, and best-effort push-notifies the added users.
export async function addMembers(groupId: string, groupName: string, userIds: string[], addedByName: string): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return 0
  try {
    const { data: existing } = await supabase.from('group_members').select('user_id').eq('group_id', groupId).in('user_id', ids)
    const have = new Set((existing || []).map((m: any) => m.user_id))
    const toAdd = ids.filter(u => !have.has(u))
    if (!toAdd.length) return 0
    const { error } = await supabase.from('group_members').insert(toAdd.map(u => ({ group_id: groupId, user_id: u, role: 'member' })))
    if (error) throw error
    await supabase.from('messages').insert({
      group_id: groupId, user_id: null, type: 'system',
      content: (addedByName || 'Someone') + ' added ' + toAdd.length + (toAdd.length > 1 ? ' members' : ' member') + ' to the Trybe',
    })
    const { data: profs } = await supabase.from('profiles').select('push_token').in('id', toAdd)
    const tokens = (profs || []).map((p: any) => p.push_token).filter(Boolean)
    if (tokens.length) sendPush(tokens, 'Added to ' + groupName, (addedByName || 'Someone') + ' added you to ' + groupName, { group_id: groupId, group_name: groupName })
    return toAdd.length
  } catch {
    return 0
  }
}

export async function leaveGroup(groupId: string, userId: string) {
  return supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId)
}
