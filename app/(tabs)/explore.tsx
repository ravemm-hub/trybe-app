import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  SafeAreaView, StatusBar, TouchableOpacity, Switch, ActivityIndicator, Alert,
} from 'react-native'
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps'
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

type NearbyGroup = {
  id: string
  name: string
  location_name: string | null
  member_count: number
  min_members: number
  status: string
  distance_m: number
}

export default function ExploreScreen() {
  const router = useRouter()
  const [view, setView] = useState<'map' | 'list'>('list')
  const [tab, setTab] = useState<'people' | 'trybes'>('people')
  const [radarOn, setRadarOn] = useState(false)
  const [myMode, setMyMode] = useState<'lit' | 'ghost'>('lit')
  const [myAvatar, setMyAvatar] = useState('🦊')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([])
  const [nearbyGroups, setNearbyGroups] = useState<NearbyGroup[]>([])
  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  const updateRadar = async (on: boolean, mode: 'lit' | 'ghost') => {
    if (!userId) return
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Location needed', 'Radar needs your location'); return }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    const { latitude, longitude } = loc.coords
    setCoords({ lat: latitude, lon: longitude })
    await supabase.from('user_locations').upsert({
      user_id: userId,
      location: `POINT(${longitude} ${latitude})`,
      radar_on: on,
      identity_mode: mode,
      avatar_char: myAvatar,
      updated_at: new Date().toISOString(),
    })
    if (on) {
      loadNearbyUsers(latitude, longitude)
      loadNearbyGroups(latitude, longitude)
    }
  }

  const loadNearbyUsers = async (lat: number, lon: number) => {
    setLoading(true)
    try {
      const { data } = await supabase.rpc('nearby_users', { lat, lon, radius_m: 2000 })
      const users = ((data || []) as NearbyUser[])
        .filter((u) => u.id !== userId)
        .map((u) => ({ ...u, is_agent: AGENT_IDS.includes(u.id) }))
      setNearbyUsers(users)
    } catch (e) { console.log(e) }
    finally { setLoading(false) }
  }

  const loadNearbyGroups = async (lat: number, lon: number) => {
    try {
      const { data } = await supabase.rpc('nearby_groups', { lat, lon, radius_m: 5000 })
      setNearbyGroups(data || [])
    } catch (e) { console.log(e) }
  }

  const toggleRadar = async (val: boolean) => {
    setRadarOn(val)
    await updateRadar(val, myMode)
  }

  const switchMode = async (mode: 'lit' | 'ghost') => {
    setMyMode(mode)
    if (radarOn) await updateRadar(true, mode)
  }

  const openDM = (user: NearbyUser) => {
    router.push({
      pathname: '/dm',
      params: {
        userId: user.id,
        userName: user.identity_mode === 'ghost'
          ? (user.avatar_char || '👻')
          : (user.display_name || user.username),
        myMode,
        myAvatar,
        isAgent: user.is_agent ? '1' : '0',
      }
    })
  }

  const createGroupWithUser = async (user: NearbyUser) => {
    if (!userId || !coords) return
    const name = `${myMode === 'ghost' ? myAvatar : 'You'} & ${user.identity_mode === 'ghost' ? (user.avatar_char || '👻') : (user.display_name || user.username)}`
    const { data, error } = await supabase.from('groups').insert({
      name,
      location: `POINT(${coords.lon} ${coords.lat})`,
      status: 'open',
      type: 'manual',
      min_members: 2,
      member_count: 2,
      created_by: userId,
    }).select().single()
    if (error) { Alert.alert('Error', error.message); return }
    await supabase.from('group_members').insert([
      { group_id: data.id, user_id: userId, role: 'admin' },
      { group_id: data.id, user_id: user.id, role: 'member' },
    ])
    router.push({ pathname: '/chat', params: { id: data.id, name: data.name, members: '2' } })
  }

  const filteredGroups = nearbyGroups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.location_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <Text style={s.title}>Explore</Text>
        <View style={s.headerRight}>
          <TouchableOpacity
            style={[s.viewBtn, view === 'map' && s.viewBtnActive]}
            onPress={() => setView('map')}
          >
            <Text style={[s.viewBtnText, view === 'map' && s.viewBtnTextActive]}>🗺️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.viewBtn, view === 'list' && s.viewBtnActive]}
            onPress={() => setView('list')}
          >
            <Text style={[s.viewBtnText, view === 'list' && s.viewBtnTextActive]}>☰</Text>
          </TouchableOpacity>
          <View style={s.radarToggle}>
            <Text style={s.radarLabel}>{radarOn ? '📡' : '📡'}</Text>
            <Switch value={radarOn} onValueChange={toggleRadar} trackColor={{ true: GREEN }} thumbColor="#fff" />
          </View>
        </View>
      </View>

      {radarOn && (
        <View style={s.modeBar}>
          <View style={s.modeBtns}>
            <TouchableOpacity style={[s.modeBtn, myMode === 'lit' && s.modeBtnLit]} onPress={() => switchMode('lit')}>
              <Text style={s.modeBtnText}>🔥 Lit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modeBtn, myMode === 'ghost' && s.modeBtnGhost]} onPress={() => switchMode('ghost')}>
              <Text style={s.modeBtnText}>👻 Ghost</Text>
            </TouchableOpacity>
          </View>
          {myMode === 'ghost' && (
            <TouchableOpacity onPress={() => setShowAvatarPicker(!showAvatarPicker)} style={s.avatarBtn}>
              <Text style={s.avatarBtnText}>Your avatar: {myAvatar} — tap to change</Text>
            </TouchableOpacity>
          )}
        </View>
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

      {!radarOn ? (
        <View style={s.offState}>
          <Text style={s.offEmoji}>📡</Text>
          <Text style={s.offTitle}>Radar is off</Text>
          <Text style={s.offSub}>Turn on to discover people and trybes near you</Text>
          <TouchableOpacity style={s.offBtn} onPress={() => toggleRadar(true)}>
            <Text style={s.offBtnText}>Activate Radar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={s.tabRow}>
            <TouchableOpacity style={[s.tabBtn, tab === 'people' && s.tabBtnActive]} onPress={() => setTab('people')}>
              <Text style={[s.tabBtnText, tab === 'people' && s.tabBtnTextActive]}>
                People {nearbyUsers.length > 0 ? `(${nearbyUsers.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.tabBtn, tab === 'trybes' && s.tabBtnActive]} onPress={() => setTab('trybes')}>
              <Text style={[s.tabBtnText, tab === 'trybes' && s.tabBtnTextActive]}>
                Trybes {nearbyGroups.length > 0 ? `(${nearbyGroups.length})` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          {tab === 'trybes' && (
            <View style={s.searchRow}>
              <TextInput
                style={s.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search trybes..."
                placeholderTextColor="#B4B2A9"
              />
            </View>
          )}

          {view === 'map' && coords ? (
            <MapView
              style={s.map}
              provider={PROVIDER_GOOGLE}
              initialRegion={{
                latitude: coords.lat,
                longitude: coords.lon,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }}
              showsUserLocation
            >
              {tab === 'people' && nearbyUsers.map(user => (
                <Marker
                  key={user.id}
                  coordinate={{ latitude: coords.lat + (Math.random()-0.5)*0.01, longitude: coords.lon + (Math.random()-0.5)*0.01 }}
                  onPress={() => openDM(user)}
                >
                  <View style={[s.mapPin, user.is_agent && s.mapPinAgent]}>
                    <Text style={s.mapPinText}>
                      {user.identity_mode === 'ghost' ? (user.avatar_char || '👻') : (user.display_name?.[0] || '?')}
                    </Text>
                    {user.is_agent && <Text style={s.agentDot}>AI</Text>}
                  </View>
                </Marker>
              ))}
              {tab === 'trybes' && filteredGroups.map(group => (
                <Marker
                  key={group.id}
                  coordinate={{ latitude: coords.lat + (Math.random()-0.5)*0.01, longitude: coords.lon + (Math.random()-0.5)*0.01 }}
                  onPress={() => router.push({ pathname: group.status === 'open' ? '/chat' : '/lobby', params: { id: group.id, name: group.name, members: group.member_count.toString() } })}
                >
                  <View style={[s.mapGroupPin, group.status === 'open' ? s.mapPinOpen : s.mapPinLobby]}>
                    <Text style={s.mapGroupCount}>{group.member_count}</Text>
                  </View>
                </Marker>
              ))}
            </MapView>
          ) : (
            <FlatList
              data={tab === 'people' ? nearbyUsers : filteredGroups}
              keyExtractor={item => item.id}
              contentContainerStyle={s.list}
              ListEmptyComponent={
                <View style={s.emptySmall}>
                  <Text style={s.emptySmallText}>
                    {loading ? 'Scanning...' : tab === 'people' ? 'No one nearby on radar' : 'No trybes found nearby'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                if (tab === 'people') {
                  const user = item as NearbyUser
                  const displayName = user.identity_mode === 'ghost'
                    ? 'Ghost'
                    : (user.display_name || user.username)
                  const avatar = user.identity_mode === 'ghost'
                    ? (user.avatar_char || '👻')
                    : (user.display_name?.[0] || '?')

                  return (
                    <View style={s.userCard}>
                      <View style={[s.userAvatar, user.is_agent && s.userAvatarAgent]}>
                        <Text style={{ fontSize: 24 }}>{avatar}</Text>
                      </View>
                      <View style={s.userInfo}>
                        <View style={s.userNameRow}>
                          <Text style={s.userName}>{displayName}</Text>
                          {user.is_agent && (
                            <View style={s.agentBadge}>
                              <Text style={s.agentBadgeText}>AI</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.userDist}>
                          {user.identity_mode === 'ghost' ? '👻 Anonymous' : '🔥 Lit'} ·{' '}
                          {user.distance_m < 1000
                            ? `${Math.round(user.distance_m)}m away`
                            : `${(user.distance_m/1000).toFixed(1)}km away`}
                        </Text>
                      </View>
                      <View style={s.userActions}>
                        <TouchableOpacity style={s.actionBtn} onPress={() => openDM(user)}>
                          <Text style={s.actionBtnText}>💬</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.actionBtn, s.actionBtnGroup]} onPress={() => createGroupWithUser(user)}>
                          <Text style={s.actionBtnText}>⚡</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                } else {
                  const group = item as NearbyGroup
                  return (
                    <Pressable
                      style={s.groupCard}
                      onPress={() => router.push({
                        pathname: group.status === 'open' ? '/chat' : '/lobby',
                        params: { id: group.id, name: group.name, members: group.member_count.toString() }
                      })}
                    >
                      <View style={[s.groupDot, group.status === 'open' ? s.dotOpen : s.dotLobby]} />
                      <View style={s.groupInfo}>
                        <Text style={s.groupName}>{group.name}</Text>
                        {group.location_name && <Text style={s.groupLoc}>📍 {group.location_name}</Text>}
                      </View>
                      <View style={s.groupRight}>
                        <Text style={s.groupCount}>{group.member_count}</Text>
                        <Text style={s.groupLabel}>people</Text>
                      </View>
                    </Pressable>
                  )
                }
              }}
            />
          )}
        </>
      )}
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  title: { fontSize: 24, fontWeight: '700', color: '#2C2C2A' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  viewBtnActive: { backgroundColor: GREEN },
  viewBtnText: { fontSize: 16 },
  viewBtnTextActive: { fontSize: 16 },
  radarToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  radarLabel: { fontSize: 16 },
  modeBar: { backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  modeBtns: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: '#F1EFE8', alignItems: 'center' },
  modeBtnLit: { backgroundColor: '#E1F5EE', borderWidth: 1.5, borderColor: GREEN },
  modeBtnGhost: { backgroundColor: '#EEEDFE', borderWidth: 1.5, borderColor: PURPLE },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  avatarBtn: { marginTop: 8 },
  avatarBtnText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, backgroundColor: '#fff', gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  avatarOpt: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  avatarOptSel: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F1EFE8', alignItems: 'center' },
  tabBtnActive: { backgroundColor: GREEN },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: GRAY },
  tabBtnTextActive: { color: '#fff' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  searchInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#2C2C2A' },
  map: { flex: 1 },
  mapPin: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PURPLE },
  mapPinAgent: { borderColor: '#FF6B35', backgroundColor: '#FFF0EB' },
  mapPinText: { fontSize: 20 },
  agentDot: { fontSize: 8, fontWeight: '700', color: '#FF6B35', position: 'absolute', bottom: 0, right: 0, backgroundColor: '#fff', borderRadius: 4, paddingHorizontal: 2 },
  mapGroupPin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  mapPinOpen: { backgroundColor: '#E1F5EE', borderColor: GREEN },
  mapPinLobby: { backgroundColor: '#EEEDFE', borderColor: PURPLE },
  mapGroupCount: { fontSize: 14, fontWeight: '700', color: '#2C2C2A' },
  offState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  offEmoji: { fontSize: 64, marginBottom: 16 },
  offTitle: { fontSize: 22, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  offSub: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  offBtn: { backgroundColor: GREEN, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24 },
  offBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  list: { padding: 16, gap: 10 },
  emptySmall: { paddingTop: 40, alignItems: 'center' },
  emptySmallText: { fontSize: 14, color: GRAY },
  userCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  userAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  userAvatarAgent: { backgroundColor: '#FFF0EB', borderWidth: 2, borderColor: '#FF6B35' },
  userInfo: { flex: 1 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  userName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A' },
  agentBadge: { backgroundColor: '#FF6B35', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  agentBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  userDist: { fontSize: 12, color: GRAY },
  userActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  actionBtnGroup: { backgroundColor: '#EEEDFE' },
  actionBtnText: { fontSize: 18 },
  groupCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupDot: { width: 10, height: 10, borderRadius: 5 },
  dotOpen: { backgroundColor: GREEN },
  dotLobby: { backgroundColor: PURPLE },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', marginBottom: 3 },
  groupLoc: { fontSize: 12, color: GRAY },
  groupRight: { alignItems: 'center' },
  groupCount: { fontSize: 20, fontWeight: '700', color: '#2C2C2A' },
  groupLabel: { fontSize: 10, color: GRAY },
})
