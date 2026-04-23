import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

type Group = {
  id: string
  name: string
  location_name: string | null
  member_count: number
  min_members: number
  status: string
  created_at: string
  is_private: boolean
  last_message?: string | null
  last_message_at?: string | null
  message_count?: number
}

export default function DiscoverScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [groups, setGroups] = useState<Group[]>([])
  const [joined, setJoined] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userName, setUserName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)

  const loadGroups = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      const { data: profile } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
      if (profile) setUserName(profile.display_name || profile.username || '')
      const { data, error } = await supabase.from('groups').select('*').neq('status', 'archived')
      if (error) throw error
      const enriched = await Promise.all((data || []).map(async (g: Group) => {
        const { data: msgs } = await supabase
          .from('messages').select('content, created_at').eq('group_id', g.id)
          .eq('type', 'text').order('created_at', { ascending: false }).limit(1)
        const { count } = await supabase
          .from('messages').select('id', { count: 'exact', head: true }).eq('group_id', g.id)
        return { ...g, last_message: msgs?.[0]?.content || null, last_message_at: msgs?.[0]?.created_at || null, message_count: count || 0 }
      }))
      enriched.sort((a, b) => {
        const aTime = a.last_message_at || a.created_at
        const bTime = b.last_message_at || b.created_at
        return new Date(bTime).getTime() - new Date(aTime).getTime()
      })
      setGroups(enriched)
      const { data: memberData } = await supabase.from('group_members').select('group_id').eq('user_id', user.id)
      if (memberData) setJoined(memberData.map((m: any) => m.group_id))
    } catch (err: any) { console.error(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  useEffect(() => {
    const channel = supabase.channel('groups-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => loadGroups())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => loadGroups())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadGroups])

  const joinGroup = async (groupId: string) => {
    if (!userId) return
    await supabase.from('group_members').insert({ group_id: groupId, user_id: userId })
    setJoined(prev => [...prev, groupId])
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, member_count: g.member_count + 1 } : g))
  }

  const openGroup = (group: Group) => {
    if (group.status === 'open') {
      router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: group.member_count.toString() } })
    } else {
      router.push({ pathname: '/lobby', params: { id: group.id, name: group.name } })
    }
  }

  const formatLastMsg = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
    return new Date(ts).toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.logo}>tryber</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
          <Text style={s.createBtnText}>+ Drop Trybe</Text>
        </TouchableOpacity>
      </View>

      {userName ? <View style={s.welcomeBanner}><Text style={s.welcomeText}>Hey {userName} 👋</Text></View> : null}

      {loading ? (
        <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={g => g.id}
          contentContainerStyle={[s.list, groups.length === 0 && s.listEmpty]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadGroups() }} tintColor={GREEN} />}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>⚡️</Text>
              <Text style={s.emptyTitle}>No trybes yet</Text>
              <Text style={s.emptySub}>Drop the first trybe and get the party started</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/create')}>
                <Text style={s.emptyBtnText}>+ Drop Trybe</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const isOpen = item.status === 'open'
            const pct = Math.min(100, Math.round((item.member_count / Math.max(item.min_members, 1)) * 100))
            const isJoined = joined.includes(item.id)
            return (
              <Pressable style={s.card} onPress={() => openGroup(item)}>
                <View style={s.cardTop}>
                  <View style={[s.dot, isOpen ? s.dotOpen : s.dotLobby]} />
                  <View style={s.cardInfo}>
                    <View style={s.cardNameRow}>
                      <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
                      <View style={[s.privacyTag, item.is_private ? s.privacyTagPrivate : s.privacyTagPublic]}>
                        <Text style={s.privacyTagText}>{item.is_private ? '🔒 Private' : '🌐 Public'}</Text>
                      </View>
                    </View>
                    {item.location_name && <Text style={s.cardLocation}>📍 {item.location_name}</Text>}
                    {item.last_message && <Text style={s.lastMsg} numberOfLines={1}>{item.last_message}</Text>}
                  </View>
                  <View style={s.cardRight}>
                    {item.last_message_at && <Text style={s.lastTime}>{formatLastMsg(item.last_message_at)}</Text>}
                    <Text style={s.memberNum}>{item.member_count}</Text>
                    <Text style={s.memberLabel}>people</Text>
                  </View>
                </View>
                {!isOpen && (
                  <View style={s.progressSection}>
                    <View style={s.progressBg}>
                      <View style={[s.progressFill, { width: `${pct}%` as any }]} />
                    </View>
                    <Text style={s.progressLabel}>{item.member_count}/{item.min_members} to unlock</Text>
                  </View>
                )}
                {isOpen && <Text style={s.openLabel}>🟢 Chat is LIVE — tap to join</Text>}
                {!isOpen && !isJoined && (
                  <TouchableOpacity style={s.joinBtn} onPress={() => joinGroup(item.id)}>
                    <Text style={s.joinBtnText}>Join Lobby</Text>
                  </TouchableOpacity>
                )}
                {!isOpen && isJoined && <Text style={s.inLobby}>✓ In the lobby</Text>}
              </Pressable>
            )
          }}
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
  logo: { fontSize: 26, fontWeight: '800', color: GREEN, letterSpacing: -1 },
  createBtn: { backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  welcomeBanner: { backgroundColor: '#E1F5EE', paddingHorizontal: 20, paddingVertical: 8 },
  welcomeText: { fontSize: 13, color: '#0F6E56', fontWeight: '600' },
  list: { padding: 12, gap: 8 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 24 },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  dotOpen: { backgroundColor: GREEN },
  dotLobby: { backgroundColor: PURPLE },
  cardInfo: { flex: 1 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  cardName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', flex: 1 },
  privacyTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  privacyTagPublic: { backgroundColor: '#E1F5EE' },
  privacyTagPrivate: { backgroundColor: '#EEEDFE' },
  privacyTagText: { fontSize: 10, fontWeight: '700', color: '#2C2C2A' },
  cardLocation: { fontSize: 12, color: GRAY, marginBottom: 3 },
  lastMsg: { fontSize: 12, color: GRAY, fontStyle: 'italic' },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  lastTime: { fontSize: 11, color: GRAY },
  memberNum: { fontSize: 20, fontWeight: '700', color: '#2C2C2A' },
  memberLabel: { fontSize: 10, color: GRAY },
  progressSection: { marginBottom: 8 },
  progressBg: { height: 4, backgroundColor: '#F1EFE8', borderRadius: 2, marginBottom: 4 },
  progressFill: { height: 4, backgroundColor: PURPLE, borderRadius: 2, minWidth: 4 },
  progressLabel: { fontSize: 11, color: PURPLE, fontWeight: '600' },
  openLabel: { fontSize: 12, color: GREEN, fontWeight: '600' },
  joinBtn: { backgroundColor: '#F1EFE8', paddingVertical: 8, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  joinBtnText: { fontSize: 13, fontWeight: '600', color: PURPLE },
  inLobby: { fontSize: 12, color: GREEN, fontWeight: '500', textAlign: 'center', marginTop: 6 },
})
