import { supabase } from '../lib/supabase'
import { emit, UNREAD_CHANGED } from '../lib/events'

export async function sendDM(params: { id?: string; senderId: string; receiverId: string; content: string; senderMode?: string; receiverMode?: string; replyToId?: string | null; replyPreview?: string | null; mediaUrl?: string | null; mediaType?: string }) {
  const row: any = {
    sender_id: params.senderId, receiver_id: params.receiverId, content: params.content,
    sender_mode: params.senderMode || 'lit', receiver_mode: params.receiverMode || 'lit',
    reply_to_id: params.replyToId || null, reply_preview: params.replyPreview || null,
    media_url: params.mediaUrl || null, media_type: params.mediaType || null,
  }
  if (params.id) row.id = params.id
  return supabase.from('dm_messages').insert(row)
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
