import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput,
  SafeAreaView, StatusBar, TouchableOpacity, Switch, ActivityIndicator,
} from 'react-native'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const AVATARS = ['🦊','🐺','🦁','🐯','🐻','🦝','🐼','🦄','🐲','👾','🤖','👽','🎭','🔮','⚡️','🌊','🔥','🌙']

type NearbyUser = {
  id: string
  display_name: string | null
  username: string
  avatar_char: string | null
  identity_mode: 'lit' | 'ghost'
  distance_m: number
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
  const [tab, setTab] = useState<'people' | 'trybes'>('people')
  const [radarOn, setRadarOn] = useState(false)
  const [myMode, setMyMode] = useState<'lit' | 'ghost'>('lit')
  const [myAvatar, setMyAvatar] = useState('🦊')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([])
  const [nearbyGroups, setNearbyGroups] = useState<NearbyGroup[]>([])
  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  const updateRadar = async (on: boolean, mode: 'lit' | 'ghost') => {
    if (!userId) return
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    const { latitude, longitude } = loc.coords
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
      const { data } = await supabase.rpc('nearby_users', { lat, lon, radius_m: 1000 })
      setNearbyUsers((data || []).filter((u: NearbyUser) => u.id !== userId))
    } catch (e) { console.log(e) }
    finally { setLoading(false) }
  }

  const loadNearbyGroups = async (lat: number, lon: number) => {
    try {
      const { data } = await supabase.rpc('nearby_groups', { lat, lon, radius_m: 1000 })
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

  const filteredGroups = nearbyGroups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.location_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <Text style={s.title}>Explore</Text>
        <View style={s.radarToggle}>
          <Text style={s.radarLabel}>{radarOn ? '📡 Active' : '📡 Off'}</Text>
          <Switch value={radarOn} onValueChange={toggleRadar} trackColor={{ true: GREEN, false: '#E0DED8' }} thumbColor="#fff" />
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
              <Text style={s.avatarBtnText}>Avatar: {myAvatar} — change</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {showAvatarPicker && (
        <View style={s.avatarGrid}>
          {AVATARS.map(a => (
            <TouchableOpacity key={a} style={[s.avatarOpt, myAvatar === a && s.avatarOptSelected]} onPress={() => { setMyAvatar(a); setShowAvatarPicker(false) }}>
              <Text style={{ fontSize: 24 }}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, tab === 'people' && s.tabBtnActive]} onPress={() => setTab('people')}>
          <Text style={[s.tabBtnText, tab === 'people' && s.tabBtnTextActive]}>People nearby</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab === 'trybes' && s.tabBtnActive]} onPress={() => setTab('trybes')}>
          <Text style={[s.tabBtnText, tab === 'trybes' && s.tabBtnTextActive]}>Trybes nearby</Text>
        </TouchableOpacity>
      </View>

      {tab === 'trybes' && (
        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search trybes or locations..."
            placeholderTextColor="#B4B2A9"
          />
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
      ) : tab === 'people' ? (
        <FlatList
          data={nearbyUsers}
          keyExtractor={u => u.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={<View style={s.emptySmall}><Text style={s.emptySmallText}>{loading ? 'Scanning...' : 'No one nearby yet'}</Text></View>}
          renderItem={({ item }) => (
            <Pressable style={s.userCard} onPress={() => router.push({ pathname: '/dm', params: { userId: item.id, userName: item.identity_mode === 'ghost' ? (item.avatar_char || '👻') : (item.display_name || item.username), myMode, myAvatar } })}>
              <View style={s.userAvatar}>
                <Text style={{ fontSize: 28 }}>{item.identity_mode === 'ghost' ? (item.avatar_char || '👻') : (item.display_name?.[0] || '?')}</Text>
              </View>
              <View style={s.userInfo}>
                <Text style={s.userName}>{item.identity_mode === 'ghost' ? 'Ghost' : (item.display_name || item.username)}</Text>
                <Text style={s.userDist}>{item.identity_mode === 'ghost' ? '👻 Anonymous' : '🔥 Lit'} · {item.distance_m < 1000 ? `${Math.round(item.distance_m)}m away` : `${(item.distance_m/1000).toFixed(1)}km away`}</Text>
              </View>
              <Text style={{ fontSize: 20 }}>💬</Text>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={filteredGroups}
          keyExtractor={g => g.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={<View style={s.emptySmall}><Text style={s.emptySmallText}>No trybes found nearby</Text></View>}
          renderItem={({ item }) => (
            <Pressable style={s.groupCard} onPress={() => router.push({ pathname: item.status === 'open' ? '/chat' : '/lobby', params: { id: item.id, name: item.name, members: item.member_count.toString() } })}>
              <View style={[s.groupDot, item.status === 'open' ? s.dotOpen : s.dotLobby]} />
              <View style={s.groupInfo}>
                <Text style={s.groupName}>{item.name}</Text>
                {item.location_name && <Text style={s.groupLoc}>📍 {item.location_name}</Text>}
              </View>
              <View style={s.groupRight}>
                <Text style={s.groupCount}>{item.member_count}</Text>
                <Text style={s.groupLabel}>people</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  title: { fontSize: 24, fontWeight: '700', color: '#2C2C2A' },
  radarToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radarLabel: { fontSize: 13, color: GRAY, fontWeight: '500' },
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
  avatarOptSelected: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F1EFE8', alignItems: 'center' },
  tabBtnActive: { backgroundColor: GREEN },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: GRAY },
  tabBtnTextActive: { color: '#fff' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  searchInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#2C2C2A' },
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
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', marginBottom: 3 },
  userDist: { fontSize: 12, color: GRAY },
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
