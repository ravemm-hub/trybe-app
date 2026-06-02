import { supabase } from '../lib/supabase'
import { emit, UNREAD_CHANGED } from '../lib/events'
import { EDGE_URL, EDGE_AUTH, AGENT_IDS } from '../constants'

export async function sendDM(params: { id?: string; senderId: string; receiverId: string; content: string; senderMode?: string; receiverMode?: string; replyToId?: string | null; replyPreview?: string | null; mediaUrl?: string | null; mediaType?: string }) {
  const row: any = {
    sender_id: params.senderId, receiver_id: params.receiverId, content: params.content,
    sender_mode: params.senderMode || 'lit', receiver_mode: params.receiverMode || 'lit',
    reply_to_id: params.replyToId || null, reply_preview: params.replyPreview || null,
    media_url: params.mediaUrl || null, media_type: params.mediaType || null,
  }
  if (params.id) row.id = params.id
  const res = await supabase.from('dm_messages').insert(row)
  // Fan out a push notification to the receiver via the edge function — skip
  // agent receivers (agents don't have devices). Ghost mode hides the sender's
  // real name behind 👻 Anonymous so the push doesn't leak identity.
  if (!res.error && !AGENT_IDS.includes(params.receiverId)) {
    const isGhost = (params.senderMode || 'lit') === 'ghost'
    let senderName = ''
    if (!isGhost) {
      try {
        const { data: p } = await supabase.from('profiles').select('display_name, username').eq('id', params.senderId).single()
        senderName = (p?.display_name || p?.username || '').slice(0, 60)
      } catch {}
    } else {
      senderName = '👻 Anonymous'
    }
    const previewBody = (params.content || '').trim() || (params.mediaUrl ? (params.mediaType === 'audio' ? '🎤 Voice message' : params.mediaType === 'file' ? '📄 File' : '📷 Photo') : '')
    fetch(EDGE_URL, {
      method: 'POST', headers: { Authorization: EDGE_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dm: { sender_id: params.senderId, receiver_id: params.receiverId, sender_name: senderName, content: previewBody } }),
    }).catch(() => {})
  }
  return res
}

export async function markDMRead(senderId: string, receiverId: string) {
  const res = await supabase.from('dm_messages').update({ read_at: new Date().toISOString() })
    .eq('sender_id', senderId).eq('receiver_id', receiverId).is('read_at', null)
  emit(UNREAD_CHANGED)
  return res
}

export async function markDMDelivered(receiverId: string) {
  const res = await supabase.from('dm_messages').update({ delivered_at: new Date().toISOString() })
    .eq('receiver_id', receiverId).is('delivered_at', null)
  emit(UNREAD_CHANGED)
  return res
}

export async function editDM(messageId: string, userId: string, content: string) {
  return supabase.from('dm_messages').update({ content, edited_at: new Date().toISOString() })
    .eq('id', messageId).eq('sender_id', userId)
}

export async function deleteDM(messageId: string, userId: string) {
  return supabase.from('dm_messages').update({ content: '', deleted_for_all: true })
    .eq('id', messageId).eq('sender_id', userId)
}

// Delete-for-everyone — DB-enforced 60-minute window + sender-only.
export async function deleteDMForEveryone(messageId: string) {
  return supabase.rpc('delete_dm_for_everyone', { p_message: messageId })
}

// Delete-for-me — hides the DM message from MY view only.
export async function hideDMForMe(messageId: string) {
  return supabase.rpc('hide_dm_for_me', { p_message: messageId })
}

export function getReceiptStatus(msg: any): 'sent' | 'delivered' | 'read' {
  if (msg.read_at) return 'read'
  if (msg.delivered_at) return 'delivered'
  return 'sent'
}

export async function getDMUnread(userId: string): Promise<number> {
  const { count } = await supabase.from('dm_messages')
    .select('id', { count: 'exact', head: true }).eq('receiver_id', userId).is('read_at', null)
  return count || 0
}
