import { supabase } from '../lib/supabase'

// ─── Reports ────────────────────────────────────────────────────────────────

export type ReportTarget =
  | 'user' | 'post' | 'message' | 'dm' | 'listing' | 'comment' | 'group'

export type ReportReason =
  | 'spam' | 'harassment' | 'hate_speech' | 'sexual' | 'underage' | 'self_harm'
  | 'violence' | 'impersonation' | 'scam' | 'illegal' | 'other'

export const REASON_LABELS: Record<ReportReason, string> = {
  spam:          '🚫 Spam',
  harassment:    '⚠️ Harassment or bullying',
  hate_speech:   '🚷 Hate speech',
  sexual:        '🔞 Sexual content (unwanted)',
  underage:      '👶 Underage user / content',
  self_harm:     '💔 Self-harm or suicide content',
  violence:      '⚔️ Violence or gore',
  impersonation: '🎭 Impersonation',
  scam:          '💸 Scam or fraud',
  illegal:       '🚨 Illegal activity',
  other:         '❓ Other',
}

export async function submitReport(
  reporterId: string,
  target: { type: ReportTarget; id: string },
  reason: ReportReason,
  comment?: string,
): Promise<{ error: any | null }> {
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    target_type: target.type,
    target_id: target.id,
    reason,
    comment: comment?.trim() || null,
  })
  return { error }
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

export async function blockUser(targetId: string, reason?: string) {
  return supabase.rpc('block_user', { p_target: targetId, p_reason: reason || null })
}

export async function unblockUser(targetId: string) {
  return supabase.rpc('unblock_user', { p_target: targetId })
}

export async function isUserBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const { data } = await supabase.rpc('is_blocked', { p_blocker: blockerId, p_blocked: blockedId })
  return !!data
}

export async function listMyBlocks(): Promise<{ blocked_id: string; created_at: string; profile?: any }[]> {
  const { data } = await supabase.from('user_blocks')
    .select('blocked_id, created_at, profile:profiles!user_blocks_blocked_id_fkey(id, display_name, username, avatar_char)')
    .order('created_at', { ascending: false })
  return (data || []) as any
}
