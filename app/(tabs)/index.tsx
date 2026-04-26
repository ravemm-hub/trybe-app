import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Pressable, RefreshControl, ActivityIndicator, Alert, Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SMS from 'expo-sms'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const INVITE_MSG = `Hey! Join me on Tryber — The Next Generation of SocialAIsing 🚀\nDownload: https://ravemm-hub.github.io/trybe-app`

type ChatItem = {
  id: string
  type: 'group' | 'dm'
  name: string
  avatar: string
  last_message: string | null
  last_message_at: string | null
  unread: number
  status?: string
  member_count?: number
  min_members?: number
  is_private?: boolean
  other_user_id?: string
}

export default function ChatsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const results: ChatItem[] = []

      // Only groups I'm a member of
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

      // DMs
      const { data: dms } = await supabase
        .from('dm_messages').select('*')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false })

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
        results.push({
          id: `dm_${otherId}`, type: 'dm', name, avatar,
          last_message: lastDm.content, last_message_at: lastDm.created_at,
          unread: 0, other_user_id: otherId,
        })
      }

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
    await supabase.from('group_members').update({ last_read_at: new Date().toISOString() }).eq('group_id', groupId).eq('user_id', userId)
  }

  const leaveGroup = async (item: ChatItem) => {
    Alert.alert('Leave group', `Leave "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        await supabase.from('group_members').delete().eq('group_id', item.id).eq('user_id', userId)
        await supabase.from('groups').update({ member_count: (item.member_count || 1) - 1 }).eq('id', item.id)
        setItems(prev => prev.filter(i => i.id !== item.id))
      }}
    ])
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
      router.push({ pathname: '/dm', params: { userId: item.other_user_id, userName: item.name, myMode: 'lit', myAvatar: '💬', isAgent: '0' } })
    }
  }

  const inviteFriends = () => router.push('/contacts')

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
            <View style={s.totalUnread}><Text style={s.totalUnreadText}>{totalUnread > 99 ? '99+' : totalUnread}</Text></View>
          )}
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.inviteBtn} onPress={inviteFriends}>
            <Text style={s.inviteBtnText}>👥 Invite</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
            <Text style={s.createBtnText}>+ Trybe</Text>
          </TouchableOpacity>
        </View>
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
              <Text style={s.emptySub}>Join a Trybe on Explore or invite friends</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(tabs)/explore')}>
                <Text style={s.emptyBtnText}>📡 Explore Trybes</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.emptyBtn, s.emptyBtnInvite]} onPress={inviteFriends}>
                <Text style={[s.emptyBtnText, { color: PURPLE }]}>👥 Invite Friends</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const hasUnread = item.unread > 0
            const isGroup = item.type === 'group'
            const isOpen = item.status === 'open'

            return (
              <Pressable
                style={s.row}
                onPress={() => openItem(item)}
                onLongPress={() => {
                  if (isGroup) {
                    Alert.alert(item.name, '', [
                      { text: '🚪 Leave group', style: 'destructive', onPress: () => leaveGroup(item) },
                      { text: 'Cancel', style: 'cancel' },
                    ])
                  }
                }}
              >
                <View style={[s.avatar, isGroup ? s.avatarGroup : s.avatarDM]}>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { fontSize: 26, fontWeight: '800', color: GREEN, letterSpacing: -1 },
  totalUnread: { backgroundColor: '#E24B4A', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  totalUnreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  headerRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  inviteBtn: { backgroundColor: '#EEEDFE', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 },
  inviteBtnText: { color: PURPLE, fontSize: 12, fontWeight: '700' },
  createBtn: { backgroundColor: GREEN, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 },
  createBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyEmoji: { fontSize: 56, marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A' },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 8 },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20, width: '100%', alignItems: 'center' },
  emptyBtnInvite: { backgroundColor: '#EEEDFE' },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff' },
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
