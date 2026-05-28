export type UserMode = 'lit' | 'ghost'
export type MsgType = 'text' | 'image' | 'system' | 'poll' | 'audio' | 'file'
export type GroupStatus = 'lobby' | 'open' | 'archived'
export type ReceiptStatus = 'sent' | 'delivered' | 'read'

export interface Profile {
  id: string; username: string; display_name: string | null
  bio: string | null; phone: string | null; avatar_char: string | null
  avatar_url: string | null; push_token: string | null; teeby_credits: number
}

export interface Group {
  id: string; name: string; description: string | null
  status: GroupStatus; is_private: boolean; min_members: number
  member_count: number; created_by: string; location_name: string | null
}

export interface Message {
  id: string; group_id: string; user_id: string | null
  type: MsgType; content: string; media_url: string | null
  sender_mode: UserMode; reply_to_id: string | null; reply_preview: string | null
  edited_at: string | null; deleted_for_all: boolean; is_forwarded: boolean
  poll_id: string | null; created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

export interface DmMessage {
  id: string; sender_id: string; receiver_id: string; content: string
  sender_mode: UserMode; receiver_mode: UserMode
  read_at: string | null; delivered_at: string | null
  edited_at: string | null; deleted_for_all: boolean
  is_forwarded: boolean; reply_to_id: string | null; reply_preview: string | null
  media_url?: string | null; media_type?: string | null
  created_at: string
}

export interface Post {
  id: string; user_id: string; content: string | null; media_url: string | null
  is_anonymous: boolean; likes: number; dislikes: number
  comment_count: number; created_at: string
  my_reaction?: 'like' | 'dislike' | null
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

export interface Contact {
  id: string; name: string; phone: string; initials: string
  onTryber: boolean; tryberUserId?: string; appName?: string
}
