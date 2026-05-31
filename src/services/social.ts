import { supabase } from '../lib/supabase'

// ─── Follow graph ───────────────────────────────────────────────────────────

export async function followUser(myId: string, targetId: string) {
  if (myId === targetId) return { error: new Error('cannot follow yourself') }
  return supabase.from('follows').insert({ follower_id: myId, following_id: targetId })
}

export async function unfollowUser(myId: string, targetId: string) {
  return supabase.from('follows').delete().eq('follower_id', myId).eq('following_id', targetId)
}

export async function isFollowing(myId: string, targetId: string): Promise<boolean> {
  if (myId === targetId) return false
  const { count } = await supabase.from('follows')
    .select('follower_id', { count: 'exact', head: true })
    .eq('follower_id', myId).eq('following_id', targetId)
  return (count || 0) > 0
}

// Bulk: which of these target user_ids does `myId` follow? Returns a Set for fast lookup.
export async function getFollowingSet(myId: string, targetIds: string[]): Promise<Set<string>> {
  if (!targetIds.length) return new Set()
  const { data } = await supabase.from('follows')
    .select('following_id')
    .eq('follower_id', myId)
    .in('following_id', targetIds)
  return new Set((data || []).map((r: any) => r.following_id))
}

export type SocialCounts = { followers: number; following: number; posts_count: number }
export async function getProfileCounts(userId: string): Promise<SocialCounts> {
  const { data } = await supabase.rpc('profile_social_counts', { p_user_id: userId })
  const row = Array.isArray(data) ? data[0] : data
  return {
    followers: Number(row?.followers || 0),
    following: Number(row?.following || 0),
    posts_count: Number(row?.posts_count || 0),
  }
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotifRow = {
  id: string
  user_id: string
  actor_id: string | null
  type: 'follow' | 'reaction' | 'comment' | 'mention' | 'dm' | 'group_invite'
  post_id: string | null
  comment_id: string | null
  group_id: string | null
  content: string | null
  read_at: string | null
  created_at: string
  actor?: { id: string; display_name: string | null; username: string | null; avatar_char: string | null } | null
  post?: { id: string; content: string | null; media_url: string | null } | null
}

export async function listNotifications(userId: string, limit = 50): Promise<NotifRow[]> {
  // Embed actor (the user who triggered the notification) so the UI can render avatar + name.
  const { data, error } = await supabase.from('notifications')
    .select('*, actor:profiles!notifications_actor_id_fkey(id,display_name,username,avatar_char), post:posts(id,content,media_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { console.warn('listNotifications:', error.message); return [] }
  return (data || []) as NotifRow[]
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const { count } = await supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).is('read_at', null)
  return count || 0
}

export async function markAllNotificationsRead(userId: string) {
  return supabase.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId).is('read_at', null)
}

export async function markOneNotificationRead(id: string) {
  return supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
}

// ─── Feed filters ───────────────────────────────────────────────────────────

// Posts only from people the user follows, chronologically.
export async function getFollowingFeed(userId: string, limit = 30) {
  const { data, error } = await supabase.rpc('following_feed', { p_user_id: userId, p_limit: limit })
  if (error) { console.warn('following_feed:', error.message); return [] }
  return data || []
}
