import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, Pressable,
  SafeAreaView, StatusBar, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

type DM = {
  user_id: string
  display_name: string | null
  username: string
  avatar_char: string | null
  last_message: string | null
  last_time: string | null
  unread: number
  my_mode: 'lit' | 'ghost'
  their_mode: 'lit' | 'ghost'
}

export default function ChatsScreen() {
  const router = useRouter()
  const [dms, setDms] = useState<DM[]>([])
  const [loading, setLoading] = useState(true)
  const [myId, setMyId] = useState<string | null>(null)

  const loadDMs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMyId(user.id)

    const { data } = await supabase
      .from('dm_messages')
      .select('sender_id, receiver_id, sender_mode, receiver_mode, content, created_at')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false })

    if (!data) { setLoading(false); return }

    const seen = new Set<string>()
    const conversations: DM[] = []

    for (const msg of data) {
      const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id
      if (seen.has(otherId)) continue
      seen.add(otherId)

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_char')
        .eq('id', otherId)
        .single()

      const myMode = msg.sender_id === user.id ? msg.sender_mode : msg.receiver_mode
      const theirMode = msg.sender_id === user.id ? msg.receiver_mode : msg.sender_mode

      conversations.push({
        user_id: otherId,
        display_name: profile?.display_name || null,
        username: profile?.username || '',
        avatar_char: profile?.avatar_char || '👻',
        last_message: msg.content,
        last_time: msg.created_at,
        unread: 0,
        my_mode: myMode,
        their_mode: theirMode,
      })
    }

    setDms(conversations)
    setLoading(false)
  }, [])

  useEffect(() => { loadDMs() }, [loadDMs])

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  const getChatLabel = (dm: DM) => {
    if (dm.my_mode === 'ghost' && dm.their_mode === 'ghost') return 'Shadow Chat 👻'
    if (dm.my_mode === 'lit' && dm.their_mode === 'lit') return 'Real Talk 🔥'
    return 'Mixed ⚡'
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.title}>Chats</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <FlatList
          data={dms}
          keyExtractor={d => d.user_id}
          contentContainerStyle={[s.list, dms.length === 0 && s.listEmpty]}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>💬</Text>
              <Text style={s.emptyTitle}>No chats yet</Text>
              <Text style={s.emptySub}>Find people nearby on Explore and start a conversation</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={s.dmCard}
              onPress={() => router.push({
                pathname: '/dm',
                params: {
                  userId: item.user_id,
                  userName: item.their_mode === 'ghost' ? (item.avatar_char || '👻') : (item.display_name || item.username),
                  myMode: item.my_mode,
                  myAvatar: '🦊',
                }
              })}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>
                  {item.their_mode === 'ghost' ? (item.avatar_char || '👻') : (item.display_name?.[0] || item.username?.[0] || '?')}
                </Text>
              </View>
              <View style={s.dmInfo}>
                <View style={s.dmTop}>
                  <Text style={s.dmName}>
                    {item.their_mode === 'ghost' ? 'Ghost' : (item.display_name || item.username)}
                  </Text>
                  {item.last_time && <Text style={s.dmTime}>{formatTime(item.last_time)}</Text>}
                </View>
                <Text style={s.dmSub}>{getChatLabel(item)}</Text>
                {item.last_message && (
                  <Text style={s.dmPreview} numberOfLines={1}>{item.last_message}</Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  title: { fontSize: 24, fontWeight: '700', color: '#2C2C2A' },
  list: { padding: 16, gap: 10 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 22 },
  dmCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26 },
  dmInfo: { flex: 1 },
  dmTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  dmName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A' },
  dmTime: { fontSize: 11, color: GRAY },
  dmSub: { fontSize: 11, color: PURPLE, fontWeight: '500', marginBottom: 3 },
  dmPreview: { fontSize: 13, color: GRAY },
})
