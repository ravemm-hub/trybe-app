import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, StatusBar, Pressable, RefreshControl, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { supabase } from '../lib/supabase'

type Group = {
  id: string; name: string; location_name: string | null
  member_count: number; min_members: number; status: 'lobby' | 'open' | 'archived'
  created_by: string | null
}

export default function DiscoverScreen() {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>([])
  const [joined, setJoined] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userName, setUserName] = useState('')
  const [locationLabel, setLocationLabel] = useState<string | null>(null)

  const loadGroups = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
      if (profile) setUserName(profile.display_name || profile.username || '')
      const { data, error } = await supabase.from('groups').select('*').neq('status', 'archived').order('created_at', { ascending: false })
      if (error) throw error
      setGroups(data || [])
      const { data: memberData } = await supabase.from('group_members').select('group_id').eq('user_id', user.id)
      if (memberData) setJoined(memberData.map(m => m.group_id))
    } catch (err: any) { console.error(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  const getLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      if (place) setLocationLabel([place.city, place.district].filter(Boolean).join(', ') || null)
    } catch {}
  }, [])

  useEffect(() => { loadGroups(); getLocation() }, [loadGroups, getLocation])

  useEffect(() => {
    const channel = supabase.channel('groups-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => loadGroups())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadGroups])

  const joinGroup = async (groupId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('group_members').insert({ group_id: groupId, user_id: user.id })
      setJoined(prev => [...prev, groupId])
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, member_count: g.member_count + 1 } : g))
    } catch (err: any) { Alert.alert('Error', err.message) }
  }

  const openGroup = (group: Group) => {
    if (group.status === 'open') {
      router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: group.member_count.toString() } })
    } else {
      router.push({ pathname: '/lobby', params: { id: group.id, name: group.name } })
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <View>
          <Text style={s.logo}>trybe</Text>
          <Text style={s.subtitle}>{locationLabel ? `📍 ${locationLabel}` : `${groups.length} active trybes`}</Text>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
            <Text style={s.createBtnText}>+ Drop Trybe</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => supabase.auth.signOut()}>
            <Text style={s.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {userName ? (
        <View style={s.welcomeBanner}>
          <Text style={s.welcomeText}>Hey {userName} 👋</Text>
          {locationLabel && <Text style={s.welcomeSub}>{groups.length} trybes active near you</Text>}
        </View>
      ) : null}

      <FlatList
        data={groups}
        keyExtractor={g => g.id}
        contentContainerStyle={[s.list, groups.length === 0 && s.listEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadGroups() }} tintColor={GREEN} />}
        ListEmptyComponent={!loading ? (
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🐦</Text>
            <Text style={s.emptyTitle}>No trybes nearby yet</Text>
            <Text style={s.emptySub}>Be the first to drop a trybe — everyone nearby gets pinged instantly</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/create')}>
              <Text style={s.emptyBtnText}>+ Drop the first Trybe</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <GroupCard group={item} isJoined={joined.includes(item.id)} onJoin={() => joinGroup(item.id)} onOpen={() => openGroup(item)} />
        )}
      />
    </SafeAreaView>
  )
}

function GroupCard({ group, isJoined, onJoin, onOpen }: { group: Group; isJoined: boolean; onJoin: () => void; onOpen: () => void }) {
  const isOpen = group.status === 'open'
  const pct = Math.min(100, Math.round((group.member_count / group.min_members) * 100))
  return (
    <Pressable style={s.card} onPress={onOpen}>
      <View style={s.cardTop}>
        <View style={[s.dot, isOpen ? s.dotOpen : s.dotLobby]} />
        <View style={s.cardInfo}>
          <Text style={s.cardName}>{group.name}</Text>
          {group.location_name && <Text style={s.cardLocation}>📍 {group.location_name}</Text>}
        </View>
        <View style={s.cardRight}>
          <Text style={s.memberNum}>{group.member_count}</Text>
          <Text style={s.memberLabel}>people</Text>
        </View>
      </View>
      {!isOpen && (
        <View style={s.progressSection}>
          <View style={s.progressBg}>
            <View style={[s.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={s.progressLabel}>{group.member_count}/{group.min_members} to unlock</Text>
        </View>
      )}
      {isOpen && <Text style={s.openLabel}>🟢 Chat is LIVE — tap to join</Text>}
      {!isOpen && (
        <TouchableOpacity style={[s.joinBtn, isJoined && s.joinBtnDone]} onPress={onJoin} disabled={isJoined}>
          <Text style={[s.joinBtnText, isJoined && s.joinBtnTextDone]}>
            {isJoined ? '✓ In the lobby' : 'Join Lobby'}
          </Text>
        </TouchableOpacity>
      )}
    </Pressable>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  logo: { fontSize: 28, fontWeight: '700', color: GREEN, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: GRAY, marginTop: 2 },
  headerRight: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  createBtn: { backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  signOutText: { fontSize: 13, color: GRAY },
  welcomeBanner: { backgroundColor: '#E1F5EE', paddingHorizontal: 20, paddingVertical: 10 },
  welcomeText: { fontSize: 14, color: '#0F6E56', fontWeight: '600' },
  welcomeSub: { fontSize: 12, color: '#1D9E75', marginTop: 2 },
  list: { padding: 16, gap: 12 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 0.5, borderColor: '#E0DED8', padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 2 },
  dotOpen: { backgroundColor: GREEN },
  dotLobby: { backgroundColor: PURPLE },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', marginBottom: 3 },
  cardLocation: { fontSize: 12, color: GRAY },
  cardRight: { alignItems: 'center' },
  memberNum: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  memberLabel: { fontSize: 10, color: GRAY },
  progressSection: { marginBottom: 12 },
  progressBg: { height: 5, backgroundColor: '#F1EFE8', borderRadius: 3, marginBottom: 5 },
  progressFill: { height: 5, backgroundColor: PURPLE, borderRadius: 3, minWidth: 5 },
  progressLabel: { fontSize: 11, color: PURPLE, fontWeight: '600' },
  openLabel: { fontSize: 12, color: GREEN, fontWeight: '600', marginBottom: 4 },
  joinBtn: { backgroundColor: '#F1EFE8', paddingVertical: 10, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  joinBtnDone: { backgroundColor: '#E1F5EE' },
  joinBtnText: { fontSize: 14, fontWeight: '600', color: PURPLE },
  joinBtnTextDone: { color: GREEN },
})
