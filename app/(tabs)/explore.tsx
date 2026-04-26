import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  StatusBar, TouchableOpacity, Switch, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const AVATARS = ['🦊','🐺','🦁','🐯','🐻','🦝','🐼','🦄','🐲','👾','🤖','👽','🎭','🔮','⚡️','🌊','🔥','🌙']

const AGENT_IDS = [
  'a1000001-0000-0000-0000-000000000001',
  'a1000001-0000-0000-0000-000000000002',
  'a1000001-0000-0000-0000-000000000003',
  'a1000001-0000-0000-0000-000000000019',
  'a1000001-0000-0000-0000-000000000020',
  'a1000001-0000-0000-0000-000000000026',
  'a1000001-0000-0000-0000-000000000029',
]

type NearbyUser = {
  id: string
  display_name: string | null
  username: string
  avatar_char: string | null
  identity_mode: 'lit' | 'ghost'
  distance_m: number
  is_agent?: boolean
}

type Group = {
  id: string
  name: string
  location_name: string | null
  member_count: number
  min_members: number
  status: string
  is_private: boolean
  distance_m?: number
  last_message?: string | null
  memberStatus?: 'member' | 'pending' | 'invited' | null
}

export default function ExploreScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<'trybes' | 'people'>('trybes')
  const [radarOn, setRadarOn] = useState(false)
  const [myMode, setMyMode] = useState<'lit' | 'ghost'>('lit')
  const [myAvatar, setMyAvatar] = useState('🦊')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [joiningId, setJoiningId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); loadGroups(user.id) }
    })
  }, [])

  const loadGroups = useCallback(async (uid?: string) => {
    setLoading(true)
    try {
      const { data } = await supabase.from('groups').select('*').neq('status', 'archived').order('member_count', { ascending: false }).limit(50)

      const myId = uid || userId
      const { data: myMemberships } = await supabase.from('group_members').select('group_id').eq('user_id', myId || '')
      const { data: myRequests } = await supabase.from('join_requests').select('group_id, status').eq('user_id', myId || '')

      const memberSet = new Set((myMemberships || []).map((m: any) => m.group_id))
      const requestMap = new Map((myRequests || []).map((r: any) => [r.group_id, r.status]))

      const enriched = await Promise.all((data || []).map(async (g: Group) => {
        const { data: msgs } = await supabase.from('messages').select('content').eq('group_id', g.id).eq('type', 'text').order('created_at', { ascending: false }).limit(1)

        let memberStatus: Group['memberStatus'] = null
        if (memberSet.has(g.id)) memberStatus = 'member'
        else if (requestMap.has(g.id)) memberStatus = requestMap.get(g.id) === 'pending' ? 'pending' : null

        return { ...g, last_message: msgs?.[0]?.content || null, memberStatus }
      }))

      setGroups(enriched)
    } catch (e: any) { console.error(e) }
    finally { setLoading(false) }
  }, [userId])

  const joinGroup = async (group: Group) => {
    if (!userId || joiningId) return
    setJoiningId(group.id)
    try {
      if (group.is_private) {
        const { error } = await supabase.from('join_requests').insert({ group_id: group.id, user_id: userId })
        if (error?.code === '23505') { Alert.alert('Already requested'); return }
        Alert.alert('✓ Request sent', 'The admin will review your request.')
      } else {
        await supabase.from('group_members').insert({ group_id: group.id, user_id: userId, role: 'member' })
        await supabase.from('groups').update({ member_count: group.member_count + 1 }).eq('id', group.id)
        if (group.status === 'open') {
          router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: (group.member_count + 1).toString() } })
        }
      }
      await loadGroups()
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setJoiningId(null) }
  }

  const openGroup = (group: Group) => {
    if (group.memberStatus !== 'member') return
    if (group.status === 'open') {
      router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: group.member_count.toString() } })
    } else {
      router.push({ pathname: '/lobby', params: { id: group.id, name: group.name } })
    }
  }

  const loadNearbyUsers = async (lat: number, lon: number) => {
    try {
      const { data } = await supabase.rpc('nearby_users', { lat, lon, radius_m: 2000 })
      const users = ((data || []) as NearbyUser[]).filter(u => u.id !== userId).map(u => ({ ...u, is_agent: AGENT_IDS.includes(u.id) }))
      setNearbyUsers(users)
    } catch {}
  }

  const activateRadar = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Location needed'); return }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    const { latitude, longitude } = loc.coords
    setCoords({ lat: latitude, lon: longitude })
    await supabase.from('user_locations').upsert({
      user_id: userId, location: `POINT(${longitude} ${latitude})`,
      radar_on: true, identity_mode: myMode, avatar_char: myAvatar, updated_at: new Date().toISOString(),
    })
    await loadNearbyUsers(latitude, longitude)
  }

  const toggleRadar = async (val: boolean) => {
    setRadarOn(val)
    if (val) { await activateRadar() }
    else {
      if (userId) await supabase.from('user_locations').update({ radar_on: false }).eq('user_id', userId)
      setNearbyUsers([])
    }
  }

  const openDM = (user: NearbyUser) => {
    router.push({
      pathname: '/dm',
      params: { userId: user.id, userName: user.identity_mode === 'ghost' ? (user.avatar_char || '👻') : (user.display_name || user.username), myMode, myAvatar, isAgent: user.is_agent ? '1' : '0' }
    })
  }

  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.location_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <Text style={s.title}>Explore</Text>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
            <Text style={s.createBtnText}>+ Trybe</Text>
          </TouchableOpacity>
          <View style={s.radarToggle}>
            <Text style={s.radarLabel}>📡</Text>
            <Switch value={radarOn} onValueChange={toggleRadar} trackColor={{ true: GREEN }} thumbColor="#fff" />
          </View>
        </View>
      </View>

      {radarOn && (
        <View style={s.modeBar}>
          <TouchableOpacity style={[s.modeBtn, myMode === 'lit' && s.modeBtnLit]} onPress={() => setMyMode('lit')}>
            <Text style={s.modeBtnText}>🔥 Visible</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.modeBtn, myMode === 'ghost' && s.modeBtnGhost]} onPress={() => setMyMode('ghost')}>
            <Text style={s.modeBtnText}>👻 Ghost</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, tab === 'trybes' && s.tabBtnActive]} onPress={() => setTab('trybes')}>
          <Text style={[s.tabBtnText, tab === 'trybes' && s.tabBtnTextActive]}>⚡ Trybes ({groups.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab === 'people' && s.tabBtnActive]} onPress={() => setTab('people')}>
          <Text style={[s.tabBtnText, tab === 'people' && s.tabBtnTextActive]}>👥 People {nearbyUsers.length > 0 ? `(${nearbyUsers.length})` : ''}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'trybes' && (
        <View style={s.searchRow}>
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search groups..." placeholderTextColor="#B4B2A9" />
        </View>
      )}

      {tab === 'trybes' ? (
        <FlatList
          data={filteredGroups}
          keyExtractor={g => g.id}
          contentContainerStyle={s.list}
          refreshing={loading}
          onRefresh={() => loadGroups()}
          ListEmptyComponent={
            <View style={s.emptySmall}>
              {loading ? <ActivityIndicator color={GREEN} /> : <Text style={s.emptySmallText}>No groups yet — be the first!</Text>}
            </View>
          }
          renderItem={({ item }) => {
            const isMember = item.memberStatus === 'member'
            const isPending = item.memberStatus === 'pending'
            const isOpen = item.status === 'open'
            const pct = Math.min(100, Math.round((item.member_count / Math.max(item.min_members, 1)) * 100))

            return (
              <Pressable style={s.groupCard} onPress={() => isMember ? openGroup(item) : null}>
                <View style={s.groupCardTop}>
                  <View style={[s.groupDot, isOpen ? s.dotOpen : s.dotLobby]} />
                  <View style={s.groupInfo}>
                    <View style={s.groupNameRow}>
                      <Text style={s.groupName} numberOfLines={1}>{item.name}</Text>
                      {item.is_private && <Text style={s.privateBadge}>🔒</Text>}
                    </View>
                    {item.location_name && <Text style={s.groupLoc}>📍 {item.location_name}</Text>}
                    {item.last_message && <Text style={s.groupLastMsg} numberOfLines={1}>"{item.last_message}"</Text>}
                  </View>
                  <View style={s.groupRight}>
                    <Text style={s.groupCount}>{item.member_count}</Text>
                    <Text style={s.groupLabel}>people</Text>
                  </View>
                </View>

                {!isOpen && (
                  <View style={s.progressWrap}>
                    <View style={s.progressBg}><View style={[s.progressFill, { width: `${pct}%` as any }]} /></View>
                    <Text style={s.progressLabel}>{item.member_count}/{item.min_members} to unlock</Text>
                  </View>
                )}

                <View style={s.groupFooter}>
                  <Text style={[s.statusLabel, isOpen ? s.statusOpen : s.statusLobby]}>
                    {isOpen ? '🟢 LIVE' : '🟣 Lobby'}
                  </Text>

                  {isMember ? (
                    <TouchableOpacity style={s.enterBtn} onPress={() => openGroup(item)}>
                      <Text style={s.enterBtnText}>Enter →</Text>
                    </TouchableOpacity>
                  ) : isPending ? (
                    <View style={s.pendingBtn}>
                      <Text style={s.pendingBtnText}>⏳ Pending</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[s.joinBtn, item.is_private && s.joinBtnPrivate]}
                      onPress={() => joinGroup(item)}
                      disabled={joiningId === item.id}
                    >
                      {joiningId === item.id
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.joinBtnText}>{item.is_private ? '📨 Request' : '⚡ Join'}</Text>
                      }
                    </TouchableOpacity>
                  )}
                </View>
              </Pressable>
            )
          }}
        />
      ) : (
        <FlatList
          data={nearbyUsers}
          keyExtractor={u => u.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <View style={s.emptySmall}>
              {!radarOn ? (
                <View style={s.radarOffMsg}>
                  <Text style={s.radarOffEmoji}>📡</Text>
                  <Text style={s.radarOffTitle}>Enable Radar</Text>
                  <Text style={s.radarOffSub}>Turn on Radar to see nearby people</Text>
                  <TouchableOpacity style={s.radarOffBtn} onPress={() => toggleRadar(true)}>
                    <Text style={s.radarOffBtnText}>Enable Radar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={s.emptySmallText}>No people nearby with Radar on</Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const displayName = item.identity_mode === 'ghost' ? 'Ghost' : (item.display_name || item.username)
            const avatar = item.identity_mode === 'ghost' ? (item.avatar_char || '👻') : (item.display_name?.[0] || '?')
            return (
              <View style={s.userCard}>
                <View style={[s.userAvatar, item.is_agent && s.userAvatarAgent]}>
                  <Text style={{ fontSize: 24 }}>{avatar}</Text>
                </View>
                <View style={s.userInfo}>
                  <View style={s.userNameRow}>
                    <Text style={s.userName}>{displayName}</Text>
                    {item.is_agent && <View style={s.agentBadge}><Text style={s.agentBadgeText}>AI</Text></View>}
                    {item.identity_mode === 'ghost' && !item.is_agent && <View style={s.ghostBadge}><Text style={s.ghostBadgeText}>👻 anon</Text></View>}
                  </View>
                  <Text style={s.userDist}>{item.distance_m < 1000 ? `${Math.round(item.distance_m)}m` : `${(item.distance_m / 1000).toFixed(1)}km`} away</Text>
                </View>
                <TouchableOpacity style={s.dmBtn} onPress={() => openDM(item)}>
                  <Text style={s.dmBtnText}>💬</Text>
                </TouchableOpacity>
              </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  title: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  createBtn: { backgroundColor: GREEN, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  createBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  radarToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  radarLabel: { fontSize: 16 },
  modeBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  modeBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F1EFE8', alignItems: 'center' },
  modeBtnLit: { backgroundColor: '#E1F5EE', borderWidth: 1.5, borderColor: GREEN },
  modeBtnGhost: { backgroundColor: '#EEEDFE', borderWidth: 1.5, borderColor: PURPLE },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: '#2C2C2A' },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F1EFE8', alignItems: 'center' },
  tabBtnActive: { backgroundColor: GREEN },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: GRAY },
  tabBtnTextActive: { color: '#fff' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  searchInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#2C2C2A' },
  list: { padding: 12, gap: 10, paddingBottom: 20 },
  emptySmall: { paddingTop: 60, alignItems: 'center' },
  emptySmallText: { fontSize: 14, color: GRAY },
  radarOffMsg: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 },
  radarOffEmoji: { fontSize: 48, marginBottom: 12 },
  radarOffTitle: { fontSize: 18, fontWeight: '700', color: '#2C2C2A', marginBottom: 6 },
  radarOffSub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 20 },
  radarOffBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  radarOffBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  groupCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14 },
  groupCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  groupDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  dotOpen: { backgroundColor: GREEN },
  dotLobby: { backgroundColor: PURPLE },
  groupInfo: { flex: 1 },
  groupNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  groupName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', flex: 1 },
  privateBadge: { fontSize: 13 },
  groupLoc: { fontSize: 12, color: GRAY, marginBottom: 2 },
  groupLastMsg: { fontSize: 12, color: GRAY, fontStyle: 'italic' },
  groupRight: { alignItems: 'center' },
  groupCount: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  groupLabel: { fontSize: 10, color: GRAY },
  progressWrap: { marginBottom: 10 },
  progressBg: { height: 4, backgroundColor: '#F1EFE8', borderRadius: 2, marginBottom: 4 },
  progressFill: { height: 4, backgroundColor: PURPLE, borderRadius: 2, minWidth: 4 },
  progressLabel: { fontSize: 11, color: PURPLE, fontWeight: '600' },
  groupFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { fontSize: 12, fontWeight: '600' },
  statusOpen: { color: GREEN },
  statusLobby: { color: PURPLE },
  enterBtn: { backgroundColor: GREEN, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  enterBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  joinBtn: { backgroundColor: GREEN, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, minWidth: 80, alignItems: 'center' },
  joinBtnPrivate: { backgroundColor: PURPLE },
  joinBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pendingBtn: { backgroundColor: '#F1EFE8', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  pendingBtnText: { color: GRAY, fontSize: 12, fontWeight: '600' },
  userCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  userAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  userAvatarAgent: { backgroundColor: '#FFF0EB', borderWidth: 2, borderColor: '#FF6B35' },
  userInfo: { flex: 1 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  userName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A' },
  agentBadge: { backgroundColor: '#FF6B35', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  agentBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  ghostBadge: { backgroundColor: '#F1EFE8', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ghostBadgeText: { fontSize: 10, color: GRAY },
  userDist: { fontSize: 12, color: GRAY },
  dmBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  dmBtnText: { fontSize: 20 },
})
