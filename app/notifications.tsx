import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { listNotifications, markAllNotificationsRead, markOneNotificationRead, NotifRow } from '../src/services/social'
import { getContactNameMap } from '../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../src/constants'

const ICON: Record<NotifRow['type'], string> = {
  follow: '👤', reaction: '❤️', comment: '💬', mention: '🔖', dm: '✉️', group_invite: '⚡',
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [items, setItems] = useState<NotifRow[]>([])
  const [contactNames, setContactNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    setContactNames(await getContactNameMap())
    const list = await listNotifications(user.id)
    setItems(list)
    setLoading(false)
    // Mark everything read when the user lands here, so the bell badge clears.
    if (list.some(n => !n.read_at)) markAllNotificationsRead(user.id)
  }, [])

  useEffect(() => { load() }, [load])
  useFocusEffect(useCallback(() => { load() }, [load]))

  // Tapping a notification → mark it read + navigate to the relevant thing.
  const open = async (n: NotifRow) => {
    if (!n.read_at) markOneNotificationRead(n.id)
    if (n.type === 'follow' && n.actor_id) {
      router.push({ pathname: '/profile-view', params: { userId: n.actor_id } })
    } else if (n.type === 'reaction' || n.type === 'comment') {
      // Both currently jump to the post's profile (the post itself doesn't yet have a detail page).
      if (n.post && n.actor_id) router.push({ pathname: '/profile-view', params: { userId: n.actor_id } })
    } else if (n.type === 'dm' && n.actor_id) {
      router.push({ pathname: '/dm', params: { userId: n.actor_id, userName: actorName(n), myMode: 'lit', theirMode: 'lit', myAvatar: '💬', isAgent: '0' } })
    } else if (n.type === 'group_invite' && n.group_id) {
      router.push({ pathname: '/chat', params: { id: n.group_id, name: 'Trybe', members: '0' } })
    }
  }

  const actorName = (n: NotifRow): string => {
    if (!n.actor) return 'Someone'
    return contactNames[n.actor.id] || n.actor.display_name || n.actor.username || 'Someone'
  }

  const fmt = (ts: string) => {
    const d = new Date(ts), now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3600_000) return Math.floor(diff / 60_000) + 'm'
    if (diff < 86400_000) return Math.floor(diff / 3600_000) + 'h'
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <Text style={s.title}>Notifications</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading
        ? <ActivityIndicator color={PRIMARY} style={{ flex: 1 }} />
        : <FlatList data={items} keyExtractor={n => n.id}
            contentContainerStyle={items.length === 0 ? { flex: 1 } : {}}
            ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>🔔</Text><Text style={s.emptyTitle}>No notifications yet</Text><Text style={s.emptySub}>Follows, likes, and comments will show up here.</Text></View>}
            renderItem={({ item: n }) => {
              const an = actorName(n)
              const verb = n.type === 'follow' ? 'started following you'
                : n.type === 'reaction' ? 'liked your post'
                : n.type === 'comment' ? 'commented on your post'
                : n.type === 'mention' ? 'mentioned you'
                : n.type === 'dm' ? 'sent you a message'
                : n.type === 'group_invite' ? 'invited you to a Trybe' : ''
              return (
                <TouchableOpacity style={[s.row, !n.read_at && s.rowUnread]} onPress={() => open(n)}>
                  <View style={s.avatar}><Text style={s.avatarText}>{n.actor?.avatar_char || an[0] || '?'}</Text></View>
                  <View style={s.info}>
                    <Text style={s.text}><Text style={s.actor}>{an}</Text> {verb}</Text>
                    {n.content ? <Text style={s.preview} numberOfLines={1}>{n.content}</Text> : null}
                    {n.post?.content ? <Text style={s.preview} numberOfLines={1}>"{n.post.content}"</Text> : null}
                    <Text style={s.time}>{fmt(n.created_at)}</Text>
                  </View>
                  <Text style={s.iconR}>{ICON[n.type]}</Text>
                  {!n.read_at && <View style={s.unreadDot} />}
                </TouchableOpacity>
              )
            }} />
      }
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4, width: 36 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 32, marginTop: -4 },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: TEXT },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  rowUnread: { backgroundColor: '#F5F4FF' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18 },
  info: { flex: 1 },
  text: { fontSize: 14, color: TEXT, lineHeight: 18 },
  actor: { fontWeight: '700' },
  preview: { fontSize: 12, color: GRAY, marginTop: 2, fontStyle: 'italic' },
  time: { fontSize: 11, color: GRAY, marginTop: 4 },
  iconR: { fontSize: 18 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY, marginLeft: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT, marginBottom: 6 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center' },
})
