import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

type ChatItem = {
  id: string
  type: 'group' | 'dm'
  name: string
  avatar: string
  last_message: string | null
  last_message_at: string | null
  unread: number
  // group fields
  status?: string
  member_count?: number
  min_members?: number
  is_private?: boolean
  // dm fields
  other_user_id?: string
}

export default function ChatsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')

  const loadAll = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: profile } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
      if (profile) setUserName(profile.display_name || profile.username || '')

      const results: ChatItem[] = []

      // Load groups
      const { data: memberData } = await supabase
        .from('group_members')
        .select('group_id, last_read_at, groups(*)')
        .eq('user_id', user.id)

      for (const m of memberData || []) {
        const g = (m as any).groups
        if (!g || g.status === 'archived') continue

        const { data: msgs } = await supabase
          .from('messages').select('content, created_at').eq('group_id', g.id)
          .eq('type', 'text').order('created_at', { ascending: false }).limit(1)

        let unread = 0
        if (m.last_read_at) {
          const { count } = await supabase.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('group_id', g.id).neq('user_id', user.id)
            .gt('created_at', m.last_read_at)
          unread = count || 0
        }

        results.push({
          id: g.id,
          type: 'group',
          name: g.name,
          avatar: g.is_private ? '🔒' : '⚡',
          last_message: msgs?.[0]?.content || null,
          last_message_at: msgs?.[0]?.created_at || g.created_at,
          unread,
          status: g.status,
          member_count: g.member_count,
          min_members: g.min_members,
          is_private: g.is_private,
        })
      }

      // Load DMs
      const { data: dms } = await supabase
        .from('dm_messages')
        .select('*')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false })

      // Group DMs by conversation partner
      const dmMap = new Map<string, any>()
      for (const dm of dms || []) {
        const otherId = dm.sender_id === user.id ? dm.receiver_id : dm.sender_id
        if (!dmMap.has(otherId)) dmMap.set(otherId, dm)
      }

      for (const [otherId, lastDm] of dmMap.entries()) {
        const { data: otherProfile } = await supabase
          .from('profiles').select('display_name, username, avatar_char').eq('id', otherId).single()
        const name = otherProfile?.display_name || otherProfile?.username || 'Unknown'
        const avatar = otherProfile?.avatar_char || name[0] || '?'

        const { count: unread } = await supabase.from('dm_messages')
          .select('id', { count: 'exact', head: true })
          .eq('sender_id', otherId).eq('receiver_id', user.id)
          .eq('read', false)

        results.push({
          id: `dm_${otherId}`,
          type: 'dm',
          name,
          avatar,
          last_message: lastDm.content,
          last_message_at: lastDm.created_at,
          unread: unread || 0,
          other_user_id: otherId,
        })
      }

      // Sort all by last message
      results.sort((a, b) => {
        const aTime = a.last_message_at || ''
        const bTime = b.last_message_at || ''
        return new Date(bTime).getTime() - new Date(aTime).getTime()
      })

      setItems(results)
    } catch (err: any) { console.error(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const channel = supabase.channel('chats-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => loadAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, () => loadAll())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadAll])

  const markGroupRead = async (groupId: string) => {
    if (!userId) return
    await supabase.from('group_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('group_id', groupId).eq('user_id', userId)
  }

  const openItem = (item: ChatItem) => {
    if (item.type === 'group') {
      markGroupRead(item.id)
      if (item.status === 'open') {
        router.push({ pathname: '/chat', params: { id: item.id, name: item.name, members: item.member_count?.toString() || '0' } })
      } else {
        router.push({ pathname: '/lobby', params: { id: item.id, name: item.name } })
      }
    } else {
      router.push({
        pathname: '/dm',
        params: { userId: item.other_user_id, userName: item.name, myMode: 'lit', myAvatar: '💬', isAgent: '0' }
      })
    }
  }

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
    return new Date(ts).toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  const totalUnread = items.reduce((sum, i) => sum + i.unread, 0)

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.logo}>tryber</Text>
          {totalUnread > 0 && (
            <View style={s.totalUnread}>
              <Text style={s.totalUnreadText}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
          <Text style={s.createBtnText}>+ Drop Trybe</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll() }} tintColor={GREEN} />}
          contentContainerStyle={items.length === 0 ? s.listEmpty : undefined}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>💬</Text>
              <Text style={s.emptyTitle}>No chats yet</Text>
              <Text style={s.emptySub}>Drop a Trybe or find people on Explore</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/create')}>
                <Text style={s.emptyBtnText}>+ Drop Trybe</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const hasUnread = item.unread > 0
            const isGroup = item.type === 'group'
            const isOpen = item.status === 'open'

            return (
              <Pressable style={s.row} onPress={() => openItem(item)}>
                <View style={[s.avatar, isGroup && s.avatarGroup, !isGroup && s.avatarDM]}>
                  <Text style={s.avatarText}>{item.avatar}</Text>
                </View>
                <View style={s.rowInfo}>
                  <View style={s.rowTop}>
                    <Text style={[s.rowName, hasUnread && s.rowNameBold]} numberOfLines={1}>{item.name}</Text>
                    {item.last_message_at && (
                      <Text style={[s.rowTime, hasUnread && { color: GREEN }]}>{formatTime(item.last_message_at)}</Text>
                    )}
                  </View>
                  <View style={s.rowBottom}>
                    <Text style={[s.rowLastMsg, hasUnread && s.rowLastMsgBold]} numberOfLines={1}>
                      {item.last_message || (isGroup ? (isOpen ? '🟢 Live' : `🟣 ${item.member_count}/${item.min_members} to unlock`) : 'Start chatting')}
                    </Text>
                    {hasUnread && (
                      <View style={s.unreadBadge}>
                        <Text style={s.unreadBadgeText}>{item.unread > 99 ? '99+' : item.unread}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            )
          }}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { fontSize: 26, fontWeight: '800', color: GREEN, letterSpacing: -1 },
  totalUnread: { backgroundColor: '#E24B4A', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  totalUnreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  createBtn: { backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 24 },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarGroup: { backgroundColor: '#E1F5EE' },
  avatarDM: { backgroundColor: '#EEEDFE' },
  avatarText: { fontSize: 24 },
  rowInfo: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowName: { fontSize: 15, fontWeight: '500', color: '#2C2C2A', flex: 1 },
  rowNameBold: { fontWeight: '700' },
  rowTime: { fontSize: 12, color: GRAY },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLastMsg: { fontSize: 13, color: GRAY, flex: 1 },
  rowLastMsgBold: { color: '#2C2C2A', fontWeight: '500' },
  unreadBadge: { backgroundColor: GREEN, borderRadius: 12, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  separator: { height: 0.5, backgroundColor: '#E0DED8', marginLeft: 80 },
})
