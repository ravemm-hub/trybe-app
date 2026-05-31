import { supabase } from '../lib/supabase'
import { EDGE_URL, EDGE_AUTH } from '../constants'
import { emit, UNREAD_CHANGED } from '../lib/events'

export async function sendMessage(params: { id?: string; groupId: string; userId: string; content: string; senderMode?: string; replyToId?: string | null; replyPreview?: string | null; isForwarded?: boolean; mediaUrl?: string | null; kind?: string }) {
  const row: any = {
    group_id: params.groupId, user_id: params.userId, type: params.kind || 'text',
    content: params.content, sender_mode: params.senderMode || 'lit',
    reply_to_id: params.replyToId || null, reply_preview: params.replyPreview || null,
    is_forwarded: params.isForwarded || false,
    media_url: params.mediaUrl || null,
  }
  if (params.id) row.id = params.id
  const { error } = await supabase.from('messages').insert(row)
  if (!error) {
    // Ping the edge function so it (a) triggers an agent reply when relevant and
    // (b) fans out push notifications to all other group members. Anonymous
    // senders (ghost mode) hide their name from the push title.
    const isGhost = params.senderMode === 'ghost'
    let senderName = ''
    if (!isGhost) {
      try {
        const { data: p } = await supabase.from('profiles').select('display_name, username').eq('id', params.userId).single()
        senderName = (p?.display_name || p?.username || '').slice(0, 60)
      } catch {}
    } else {
      senderName = '👻 Anonymous'
    }
    const previewBody = (params.content || '').trim() || (params.mediaUrl ? (params.kind === 'audio' ? '🎤 Voice message' : params.kind === 'file' ? '📄 File' : '📷 Photo') : '')
    fetch(EDGE_URL, {
      method: 'POST', headers: { Authorization: EDGE_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: params.groupId, sender_id: params.userId, sender_name: senderName, content: previewBody }),
    }).catch(() => {})
  }
  return error
}

export async function editMessage(messageId: string, userId: string, content: string) {
  const { data: msg } = await supabase.from('messages').select('created_at, user_id').eq('id', messageId).single()
  if (!msg || msg.user_id !== userId) throw new Error('Unauthorized')
  if (Date.now() - new Date(msg.created_at).getTime() > 15 * 60 * 1000) throw new Error('Too old')
  return supabase.from('messages').update({ content, edited_at: new Date().toISOString() }).eq('id', messageId)
}

export async function deleteMessage(messageId: string, userId: string) {
  return supabase.from('messages').update({ content: '', deleted_for_all: true }).eq('id', messageId).eq('user_id', userId)
}

export async function markGroupRead(groupId: string, userId: string) {
  const res = await supabase.from('group_members').update({ last_read_at: new Date().toISOString() }).eq('group_id', groupId).eq('user_id', userId)
  // Nudge the bottom-tab badge immediately instead of waiting on realtime.
  emit(UNREAD_CHANGED)
  return res
}

export async function getGroupUnread(groupId: string, userId: string, lastReadAt: string): Promise<number> {
  const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true })
    .eq('group_id', groupId).neq('user_id', userId).neq('type', 'system').gt('created_at', lastReadAt)
  return count || 0
}
