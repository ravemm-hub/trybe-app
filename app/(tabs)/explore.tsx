import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  StatusBar, TouchableOpacity, Switch, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'
const BG = '#F8F9FD'
const CARD = '#FFFFFF'
const TEXT = '#1A1A2E'
const GRAY = '#8A8A9A'

const AGENT_IDS = ['a1000001-0000-0000-0000-000000000001','a1000001-0000-0000-0000-000000000002','a1000001-0000-0000-0000-000000000003','a1000001-0000-0000-0000-000000000019','a1000001-0000-0000-0000-000000000020','a1000001-0000-0000-0000-000000000026','a1000001-0000-0000-0000-000000000029']

type NearbyUser = { id: string; display_name: string | null; username: string; avatar_char: string | null; identity_mode: 'lit' | 'ghost'; distance_m: number; is_agent?: boolean }
type Group = { id: string; name: string; location_name: string | null; member_count: number; min_members: number; status: string; is_private: boolean; distance_m?: number; last_message?: string | null; memberStatus?: 'member' | 'pending' | null }

export default function ExploreScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<'trybes' | 'people'>('trybes')
  const [radarOn, setRadarOn] = useState(false)
  const [myMode, setMyMode] = useState<'lit' | 'ghost'>('lit')
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [radarLoading, setRadarLoading] = useState(false)
  const radarIntervalRef = useRef<any>(null)

  useEffect(() => {
    return () => { if (radarIntervalRef.current) clearInterval(radarIntervalRef.current) }
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); loadGroups(user.id) }
    })
  }, [])

  const loadGroups = useCallback(async (uid?: string) => {
    setLoading(true)
    try {
      const myId = uid || userId
      const { data } = await supabase.from('groups').select('*').neq('status', 'archived').order('member_count', { ascending: false }).limit(50)
      const { data: myMemberships } = await supabase.from('group_members').select('group_id').eq('user_id', myId || '')
      const { data: myRequests } = await supabase.from('join_requests').select('group_id, status').eq('user_id', myId || '')
      const memberSet = new Set((myMemberships || []).map((m: any) => m.group_id))
      const requestMap = new Map((myRequests || []).map((r: any) => [r.group_id, r.status]))
      const enriched = await Promise.all((data || []).map(async (g: Group) => {
        const { data: msgs } = await supabase.from('messages').select('content').eq('group_id', g.id).eq('type', 'text').order('created_at', { ascending: false }).limit(1)
        let memberStatus: Group['memberStatus'] = null
        if (memberSet.has(g.id)) memberStatus = 'member'
        else if (requestMap.has(g.id)) memberStatus = 'pending'
        return { ...g, last_message: msgs?.[0]?.content || null, memberStatus }
      }))
      setGroups(enriched)
    } catch {} finally { setLoading(false) }
  }, [userId])

  const joinGroup = async (group: Group) => {
    if (!userId || joiningId) return
    setJoiningId(group.id)
    try {
      if (group.is_private) {
        const { error } = await supabase.from('join_requests').insert({ group_id: group.id, user_id: userId })
        if (error?.code === '23505') { Alert.alert('Already requested'); return }
        Alert.alert('✓ Request sent!')
      } else {
        await supabase.from('group_members').insert({ group_id: group.id, user_id: userId, role: 'member' })
        await supabase.from('groups').update({ member_count: group.member_count + 1 }).eq('id', group.id)
        router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: (group.member_count + 1).toString() } })
      }
      await loadGroups()
    } catch (e: any) { Alert.alert('Error', e.message) } finally { setJoiningId(null) }
  }

  const openGroup = (group: Group) => {
    if (group.status === 'open') {
      router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: group.member_count.toString(), readOnly: group.memberStatus !== 'member' ? '1' : '0' } })
    } else {
      router.push({ pathname: '/lobby', params: { id: group.id, name: group.name } })
    }
  }

  const activateRadar = async () => {
    setRadarLoading(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Radar needs your location to find people nearby')
        setRadarOn(false)
        return
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const { latitude, longitude } = loc.coords
      setCoords({ lat: latitude, lon: longitude })

      // Update my location
      await supabase.from('user_locations').upsert({
        user_id: userId,
        location: `POINT(${longitude} ${latitude})`,
        radar_on: true,
        identity_mode: myMode,
        updated_at: new Date().toISOString(),
      })

      // Place fake agents near me
      await supabase.rpc('place_agents_near_user', { user_id_input: userId })

      // Load nearby users
      const { data } = await supabase.rpc('nearby_users', { p_lat: latitude, p_lon: longitude, radius_m: 10000 })
      const users = ((data || []) as NearbyUser[])
        .filter(u => u.id !== userId)
        .map(u => ({ ...u, is_agent: AGENT_IDS.includes(u.id) }))
      setNearbyUsers(users)
    } catch (e: any) {
      console.log('Radar error:', e)
    } finally {
      setRadarLoading(false)
    }
  }

  const toggleRadar = async (val: boolean) => {
    setRadarOn(val)
    if (!val) {
      if (radarIntervalRef.current) { clearInterval(radarIntervalRef.current); radarIntervalRef.current = null }
      if (userId) await supabase.from('user_locations').update({ radar_on: false }).eq('user_id', userId)
      setNearbyUsers([])
      return
    }
    await activateRadar()
    // Update location every 30 seconds while radar is on
    radarIntervalRef.current = setInterval(async () => {
      if (!userId) return
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        const { latitude, longitude } = loc.coords
        await supabase.from('user_locations').update({ 
          location: `POINT(${longitude} ${latitude})`,
          updated_at: new Date().toISOString()
        }).eq('user_id', userId)
      } catch {}
    }, 30000)
  }

  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.location_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={CARD} />
      <View style={s.header}>
        <Text style={s.title}>Explore</Text>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.mapBtn} onPress={() => router.push('/radar')}>
            <Text style={s.mapBtnText}>🗺️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
            <Text style={s.createBtnText}>+ Trybe</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Radar Bar */}
      <View style={s.radarBar}>
        <View style={{ flex: 1 }}>
          <Text style={s.radarTitle}>📡 Radar</Text>
          <Text style={s.radarSub}>
            {radarLoading ? 'Finding people...' :
             radarOn ? (myMode === 'lit' ? '🔥 You are visible to others' : '👻 Ghost mode — anonymous') :
             'Turn on to see people nearby'}
          </Text>
        </View>
        {radarLoading ? <ActivityIndicator color={TEAL} /> :
          <Switch value={radarOn} onValueChange={toggleRadar} trackColor={{ false: '#E0E0E0', true: TEAL }} thumbColor="#fff" />
        }
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
          <Text style={[s.tabBtnText, tab === 'people' && s.tabBtnTextActive]}>
            👥 People {nearbyUsers.length > 0 ? `(${nearbyUsers.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'trybes' && (
        <View style={s.searchWrap}>
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search groups..." placeholderTextColor="#B4B2A9" />
        </View>
      )}

      {tab === 'trybes' ? (
        <FlatList
          data={filteredGroups}
          keyExtractor={g => g.id}
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 20 }}
          refreshing={loading}
          onRefresh={() => loadGroups()}
          ListEmptyComponent={
            <View style={s.empty}>
              {loading ? <ActivityIndicator color={PRIMARY} /> : <Text style={s.emptyText}>No groups yet</Text>}
            </View>
          }
          renderItem={({ item }) => {
            const isMember = item.memberStatus === 'member'
            const isPending = item.memberStatus === 'pending'
            const isOpen = item.status === 'open'
            return (
              <Pressable style={s.groupCard} onPress={() => openGroup(item)}>
                <View style={s.groupCardTop}>
                  <View style={[s.groupDot, { backgroundColor: isOpen ? TEAL : PRIMARY }]} />
                  <View style={s.groupInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.groupName} numberOfLines={1}>{item.name}</Text>
                      {item.is_private && <Text style={{ fontSize: 12 }}>🔒</Text>}
                    </View>
                    {item.location_name && <Text style={s.groupLoc}>📍 {item.location_name}</Text>}
                    {item.last_message && <Text style={s.groupLastMsg} numberOfLines={1}>"{item.last_message}"</Text>}
                  </View>
                  <View style={s.groupRight}>
                    <Text style={s.groupCount}>{item.member_count}</Text>
                    <Text style={s.groupLabel}>people</Text>
                  </View>
                </View>
                <View style={s.groupFooter}>
                  <Text style={[s.statusLabel, { color: isOpen ? TEAL : PRIMARY }]}>{isOpen ? '🟢 LIVE' : '🟣 Lobby'}</Text>
                  {isMember ? (
                    <TouchableOpacity style={s.enterBtn} onPress={() => openGroup(item)}>
                      <Text style={s.enterBtnText}>Enter →</Text>
                    </TouchableOpacity>
                  ) : isPending ? (
                    <View style={s.pendingBtn}><Text style={s.pendingBtnText}>⏳ Pending</Text></View>
                  ) : (
                    <TouchableOpacity style={[s.joinBtn, item.is_private && { backgroundColor: PRIMARY }]} onPress={() => joinGroup(item)} disabled={joiningId === item.id}>
                      {joiningId === item.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.joinBtnText}>{item.is_private ? '📨 Request' : '⚡ Join'}</Text>}
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
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 20 }}
          ListEmptyComponent={
            <View style={s.empty}>
              {!radarOn ? (
                <View style={{ alignItems: 'center', gap: 16, paddingTop: 40 }}>
                  <Text style={{ fontSize: 56 }}>📡</Text>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: TEXT }}>Enable Radar</Text>
                  <Text style={{ fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 22 }}>
                    Turn on Radar above to see{'\n'}people nearby in real-time
                  </Text>
                  <TouchableOpacity style={[s.joinBtn, { paddingHorizontal: 28 }]} onPress={() => toggleRadar(true)}>
                    <Text style={s.joinBtnText}>📡 Enable Radar</Text>
                  </TouchableOpacity>
                </View>
              ) : radarLoading ? (
                <View style={{ alignItems: 'center', gap: 12, paddingTop: 40 }}>
                  <ActivityIndicator color={TEAL} size="large" />
                  <Text style={{ color: GRAY }}>Scanning for people nearby...</Text>
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
                  <Text style={{ color: GRAY, fontSize: 14 }}>No people nearby with Radar on</Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const displayName = item.identity_mode === 'ghost' ? 'Anonymous' : (item.display_name || item.username)
            const avatar = item.identity_mode === 'ghost' ? (item.avatar_char || '👻') : (item.avatar_char || item.display_name?.[0] || '?')
            return (
              <View style={s.userCard}>
                <View style={[s.userAvatar, item.is_agent && { backgroundColor: '#EEF0FF', borderColor: PRIMARY, borderWidth: 2 }]}>
                  <Text style={{ fontSize: 24 }}>{avatar}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.userName}>{displayName}</Text>
                    {item.is_agent && <View style={s.agentBadge}><Text style={s.agentBadgeText}>AI</Text></View>}
                    {item.identity_mode === 'ghost' && !item.is_agent && <View style={s.ghostBadge}><Text style={s.ghostBadgeText}>👻 anon</Text></View>}
                  </View>
                  <Text style={s.userDist}>{item.distance_m < 1000 ? `${Math.round(item.distance_m)}m` : `${(item.distance_m / 1000).toFixed(1)}km`} away</Text>
                </View>
                <TouchableOpacity style={s.dmBtn} onPress={() => router.push({
                  pathname: '/dm',
                  params: { userId: item.id, userName: item.identity_mode === 'ghost' ? (item.avatar_char || '👻') : (item.display_name || item.username), myMode, myAvatar: '📡', isAgent: item.is_agent ? '1' : '0' }
                })}>
                  <Text style={{ fontSize: 20 }}>💬</Text>
                </TouchableOpacity>
              </View>
            )
          }}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  title: { fontSize: 24, fontWeight: '800', color: TEXT },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mapBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  mapBtnText: { fontSize: 18 },
  createBtn: { backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  createBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  radarBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB', gap: 12 },
  radarTitle: { fontSize: 15, fontWeight: '700', color: TEXT },
  radarSub: { fontSize: 12, color: GRAY, marginTop: 2 },
  modeBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  modeBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: BG, alignItems: 'center' },
  modeBtnLit: { backgroundColor: '#E8F5F3', borderWidth: 1.5, borderColor: TEAL },
  modeBtnGhost: { backgroundColor: '#EEF0FF', borderWidth: 1.5, borderColor: PRIMARY },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: TEXT },
  tabRow: { flexDirection: 'row', backgroundColor: CARD, paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 12, backgroundColor: BG, alignItems: 'center' },
  tabBtnActive: { backgroundColor: PRIMARY },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: GRAY },
  tabBtnTextActive: { color: '#fff' },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  searchInput: { backgroundColor: BG, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: TEXT },
  empty: { paddingTop: 40, alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  emptyText: { fontSize: 14, color: GRAY },
  groupCard: { backgroundColor: CARD, borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  groupCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  groupDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 3 },
  groupLoc: { fontSize: 12, color: GRAY, marginBottom: 2 },
  groupLastMsg: { fontSize: 12, color: GRAY, fontStyle: 'italic' },
  groupRight: { alignItems: 'center' },
  groupCount: { fontSize: 22, fontWeight: '800', color: TEXT },
  groupLabel: { fontSize: 10, color: GRAY },
  groupFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { fontSize: 12, fontWeight: '700' },
  enterBtn: { backgroundColor: TEAL, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  enterBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  joinBtn: { backgroundColor: TEAL, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, minWidth: 80, alignItems: 'center' },
  joinBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pendingBtn: { backgroundColor: BG, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  pendingBtnText: { color: GRAY, fontSize: 12, fontWeight: '600' },
  userCard: { backgroundColor: CARD, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  userAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  userName: { fontSize: 15, fontWeight: '700', color: TEXT },
  userDist: { fontSize: 12, color: GRAY, marginTop: 2 },
  agentBadge: { backgroundColor: PRIMARY, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  agentBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  ghostBadge: { backgroundColor: BG, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ghostBadgeText: { fontSize: 10, color: GRAY },
  dmBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
})
