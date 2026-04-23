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
  distance_m?: number
  last_message?: string | null
}

export default function ExploreScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<'people' | 'trybes'>('trybes')
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
  const [radius, setRadius] = useState(5000)
  const [showAllGroups, setShowAllGroups] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
    loadAllGroups()
  }, [])

  const loadAllGroups = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('groups').select('*').neq('status', 'archived').order('member_count', { ascending: false }).limit(50)
      const enriched = await Promise.all((data || []).map(async (g: Group) => {
        const { data: msgs } = await supabase.from('messages').select('content').eq('group_id', g.id).eq('type', 'text').order('created_at', { ascending: false }).limit(1)
        return { ...g, last_message: msgs?.[0]?.content || null }
      }))
      setGroups(enriched)
      setShowAllGroups(true)
    } catch (e: any) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  const loadNearbyGroups = async (lat: number, lon: number, r: number) => {
    setLoading(true)
    try {
      const { data } = await supabase.rpc('nearby_groups', { lat, lon, radius_m: r })
      if (data?.length) {
        const enriched = await Promise.all(data.map(async (g: Group) => {
          const { data: msgs } = await supabase.from('messages').select('content').eq('group_id', g.id).eq('type', 'text').order('created_at', { ascending: false }).limit(1)
          return { ...g, last_message: msgs?.[0]?.content || null }
        }))
        setGroups(enriched)
        setShowAllGroups(false)
      } else {
        await loadAllGroups()
      }
    } catch { await loadAllGroups() }
    finally { setLoading(false) }
  }

  const loadNearbyUsers = async (lat: number, lon: number) => {
    try {
      const { data } = await supabase.rpc('nearby_users', { lat, lon, radius_m: 2000 })
      const users = ((data || []) as NearbyUser[]).filter((u) => u.id !== userId).map((u) => ({ ...u, is_agent: AGENT_IDS.includes(u.id) }))
      setNearbyUsers(users)
    } catch (e) { console.log(e) }
  }

  const activateRadar = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Location needed', 'Radar needs your location'); return }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    const { latitude, longitude } = loc.coords
    setCoords({ lat: latitude, lon: longitude })
    await supabase.from('user_locations').upsert({
      user_id: userId, location: `POINT(${longitude} ${latitude})`,
      radar_on: true, identity_mode: myMode, avatar_char: myAvatar, updated_at: new Date().toISOString(),
    })
    await loadNearbyUsers(latitude, longitude)
    await loadNearbyGroups(latitude, longitude, radius)
  }

  const toggleRadar = async (val: boolean) => {
    setRadarOn(val)
    if (val) { await activateRadar() }
    else {
      if (userId) await supabase.from('user_locations').update({ radar_on: false }).eq('user_id', userId)
      setNearbyUsers([])
      await loadAllGroups()
    }
  }

  const switchMode = async (mode: 'lit' | 'ghost') => {
    setMyMode(mode)
    if (radarOn && coords) {
      await supabase.from('user_locations').upsert({
        user_id: userId, location: `POINT(${coords.lon} ${coords.lat})`,
        radar_on: true, identity_mode: mode, avatar_char: myAvatar, updated_at: new Date().toISOString(),
      })
    }
  }

  const changeRadius = async (r: number) => {
    setRadius(r)
    if (radarOn && coords) await loadNearbyGroups(coords.lat, coords.lon, r)
  }

  const openDM = (user: NearbyUser) => {
    router.push({
      pathname: '/dm',
      params: { userId: user.id, userName: user.identity_mode === 'ghost' ? (user.avatar_char || '👻') : (user.display_name || user.username), myMode, myAvatar, isAgent: user.is_agent ? '1' : '0' }
    })
  }

  const createGroupWithUser = async (user: NearbyUser) => {
    if (!userId || !coords) return
    const myName = myMode === 'ghost' ? myAvatar : 'You'
    const otherName = user.identity_mode === 'ghost' ? (user.avatar_char || '👻') : (user.display_name || user.username)
    const { data, error } = await supabase.from('groups').insert({
      name: `${myName} & ${otherName}`, location: `POINT(${coords.lon} ${coords.lat})`,
      status: 'open', type: 'manual', min_members: 2, member_count: 2, created_by: userId,
    }).select().single()
    if (error) { Alert.alert('Error', error.message); return }
    await supabase.from('group_members').insert([
      { group_id: data.id, user_id: userId, role: 'admin' },
      { group_id: data.id, user_id: user.id, role: 'member' },
    ])
    router.push({ pathname: '/chat', params: { id: data.id, name: data.name, members: '2' } })
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
        <View style={s.radarToggle}>
          <Text style={s.radarLabel}>📡 Radar</Text>
          <Switch value={radarOn} onValueChange={toggleRadar} trackColor={{ true: GREEN }} thumbColor="#fff" />
        </View>
      </View>

      {radarOn && (
        <View style={s.modeBar}>
          <TouchableOpacity style={[s.modeBtn, myMode === 'lit' && s.modeBtnLit]} onPress={() => switchMode('lit')}>
            <Text style={s.modeBtnText}>🔥 Lit — Visible</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.modeBtn, myMode === 'ghost' && s.modeBtnGhost]} onPress={() => switchMode('ghost')}>
            <Text style={s.modeBtnText}>👻 Ghost — Anonymous</Text>
          </TouchableOpacity>
        </View>
      )}

      {radarOn && myMode === 'ghost' && (
        <TouchableOpacity style={s.avatarBtn} onPress={() => setShowAvatarPicker(!showAvatarPicker)}>
          <Text style={s.avatarBtnText}>Your avatar: {myAvatar} — tap to change</Text>
        </TouchableOpacity>
      )}

      {showAvatarPicker && (
        <View style={s.avatarGrid}>
          {AVATARS.map(a => (
            <TouchableOpacity key={a} style={[s.avatarOpt, myAvatar === a && s.avatarOptSel]} onPress={() => { setMyAvatar(a); setShowAvatarPicker(false) }}>
              <Text style={{ fontSize: 24 }}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, tab === 'trybes' && s.tabBtnActive]} onPress={() => setTab('trybes')}>
          <Text style={[s.tabBtnText, tab === 'trybes' && s.tabBtnTextActive]}>⚡ Trybes {groups.length > 0 ? `(${groups.length})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab === 'people' && s.tabBtnActive]} onPress={() => setTab('people')}>
          <Text style={[s.tabBtnText, tab === 'people' && s.tabBtnTextActive]}>👥 People {nearbyUsers.length > 0 ? `(${nearbyUsers.length})` : ''}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'trybes' && radarOn && (
        <View style={s.radiusRow}>
          <Text style={s.radiusLabel}>Radius:</Text>
          {[1000, 5000, 10000, 50000].map(r => (
            <TouchableOpacity key={r} style={[s.radiusBtn, radius === r && s.radiusBtnActive]} onPress={() => changeRadius(r)}>
              <Text style={[s.radiusBtnText, radius === r && s.radiusBtnTextActive]}>{r < 1000 ? `${r}m` : `${r / 1000}km`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {tab === 'trybes' && (
        <View style={s.searchRow}>
          <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Search groups..." placeholderTextColor="#B4B2A9" />
        </View>
      )}

      {showAllGroups && tab === 'trybes' && (
        <View style={s.allGroupsBanner}>
          <Text style={s.allGroupsBannerText}>{radarOn ? '📍 No nearby groups — showing all' : '⚡ All active groups'}</Text>
        </View>
      )}

      {tab === 'trybes' ? (
        <FlatList
          data={filteredGroups}
          keyExtractor={g => g.id}
          contentContainerStyle={s.list}
          refreshing={loading}
          onRefresh={radarOn && coords ? () => loadNearbyGroups(coords.lat, coords.lon, radius) : loadAllGroups}
          ListEmptyComponent={
            <View style={s.emptySmall}>
              {loading ? <ActivityIndicator color={GREEN} /> : <Text style={s.emptySmallText}>No groups yet</Text>}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={s.groupCard} onPress={() =>
              router.push({ pathname: item.status === 'open' ? '/chat' : '/lobby', params: { id: item.id, name: item.name, members: item.member_count.toString() } })
            }>
              <View style={s.groupCardTop}>
                <View style={[s.groupDot, item.status === 'open' ? s.dotOpen : s.dotLobby]} />
                <View style={s.groupInfo}>
                  <Text style={s.groupName} numberOfLines={1}>{item.name}</Text>
                  {item.location_name && <Text style={s.groupLoc}>📍 {item.location_name}</Text>}
                  {item.last_message && <Text style={s.groupLastMsg} numberOfLines={1}>💬 "{item.last_message}"</Text>}
                </View>
                <View style={s.groupRight}>
                  <Text style={s.groupCount}>{item.member_count}</Text>
                  <Text style={s.groupLabel}>people</Text>
                </View>
              </View>
              <View style={s.groupStatus}>
                {item.status === 'open'
                  ? <Text style={s.openLabel}>🟢 Chat is LIVE</Text>
                  : <Text style={s.lobbyLabel}>🟣 Lobby — {item.member_count}/{item.min_members}</Text>
                }
                {item.distance_m && (
                  <Text style={s.distLabel}>{item.distance_m < 1000 ? `${Math.round(item.distance_m)}m` : `${(item.distance_m / 1000).toFixed(1)}km`}</Text>
                )}
              </View>
            </Pressable>
          )}
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
                <View style={s.userActions}>
                  <TouchableOpacity style={s.actionBtn} onPress={() => openDM(item)}><Text style={s.actionBtnText}>💬</Text></TouchableOpacity>
                  <TouchableOpacity style={[s.actionBtn, s.actionBtnGroup]} onPress={() => createGroupWithUser(item)}><Text style={s.actionBtnText}>⚡</Text></TouchableOpacity>
                </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  title: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  radarToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  radarLabel: { fontSize: 13, fontWeight: '600', color: GRAY },
  modeBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F1EFE8', alignItems: 'center' },
  modeBtnLit: { backgroundColor: '#E1F5EE', borderWidth: 1.5, borderColor: GREEN },
  modeBtnGhost: { backgroundColor: '#EEEDFE', borderWidth: 1.5, borderColor: PURPLE },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: '#2C2C2A' },
  avatarBtn: { backgroundColor: '#EEEDFE', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  avatarBtnText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, backgroundColor: '#fff', gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  avatarOpt: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  avatarOptSel: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: '#F1EFE8', alignItems: 'center' },
  tabBtnActive: { backgroundColor: GREEN },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: GRAY },
  tabBtnTextActive: { color: '#fff' },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  radiusLabel: { fontSize: 12, color: GRAY, fontWeight: '600' },
  radiusBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1EFE8' },
  radiusBtnActive: { backgroundColor: PURPLE },
  radiusBtnText: { fontSize: 12, color: GRAY, fontWeight: '600' },
  radiusBtnTextActive: { color: '#fff' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  searchInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#2C2C2A' },
  allGroupsBanner: { backgroundColor: '#E1F5EE', paddingHorizontal: 16, paddingVertical: 8 },
  allGroupsBannerText: { fontSize: 12, color: '#0F6E56', fontWeight: '500' },
  list: { padding: 12, gap: 10, paddingBottom: 20 },
  emptySmall: { paddingTop: 40, alignItems: 'center' },
  emptySmallText: { fontSize: 14, color: GRAY },
  radarOffMsg: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  radarOffEmoji: { fontSize: 56, marginBottom: 16 },
  radarOffTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  radarOffSub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  radarOffBtn: { backgroundColor: GREEN, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 20 },
  radarOffBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  groupCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14 },
  groupCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  groupDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  dotOpen: { backgroundColor: GREEN },
  dotLobby: { backgroundColor: PURPLE },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', marginBottom: 3 },
  groupLoc: { fontSize: 12, color: GRAY, marginBottom: 3 },
  groupLastMsg: { fontSize: 12, color: GRAY, fontStyle: 'italic' },
  groupRight: { alignItems: 'center' },
  groupCount: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  groupLabel: { fontSize: 10, color: GRAY },
  groupStatus: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  openLabel: { fontSize: 12, color: GREEN, fontWeight: '600' },
  lobbyLabel: { fontSize: 12, color: PURPLE, fontWeight: '600' },
  distLabel: { fontSize: 11, color: GRAY },
  userCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  userAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  userAvatarAgent: { backgroundColor: '#FFF0EB', borderWidth: 2, borderColor: '#FF6B35' },
  userInfo: { flex: 1 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  userName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A' },
  agentBadge: { backgroundColor: '#FF6B35', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  agentBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  ghostBadge: { backgroundColor: '#F1EFE8', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ghostBadgeText: { fontSize: 10, color: GRAY },
  userDist: { fontSize: 12, color: GRAY },
  userActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  actionBtnGroup: { backgroundColor: '#EEEDFE' },
  actionBtnText: { fontSize: 18 },
})
