import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  Alert, ActivityIndicator, Modal, ScrollView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'

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
  lat: number
  lon: number
  is_agent?: boolean
}

type NearbyGroup = {
  id: string
  name: string
  status: string
  member_count: number
  lat: number
  lon: number
  distance_m: number
}

export default function RadarScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const mapRef = useRef<MapView>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [myLocation, setMyLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([])
  const [nearbyGroups, setNearbyGroups] = useState<NearbyGroup[]>([])
  const [radius, setRadius] = useState(1000)
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<NearbyGroup | null>(null)
  const [myMode, setMyMode] = useState<'lit' | 'ghost'>('lit')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [selectedForGroup, setSelectedForGroup] = useState<Set<string>>(new Set())

  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Location needed', 'Radar needs your location to work')
      setLoading(false)
      return
    }

    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    const { latitude, longitude } = loc.coords
    setMyLocation({ lat: latitude, lon: longitude })

    await supabase.from('user_locations').upsert({
      user_id: user.id,
      location: `POINT(${longitude} ${latitude})`,
      radar_on: true,
      identity_mode: myMode,
      updated_at: new Date().toISOString(),
    })

    await loadNearby(latitude, longitude, user.id)
    setLoading(false)
  }

  const loadNearby = async (lat: number, lon: number, uid: string) => {
    try {
      // Load nearby users
      const { data: users } = await supabase.rpc('nearby_users', { lat, lon, radius_m: radius })
      if (users) {
        const filtered = users
          .filter((u: any) => u.id !== uid)
          .map((u: any) => ({
            ...u,
            lat: u.lat || lat + (Math.random() - 0.5) * 0.01,
            lon: u.lon || lon + (Math.random() - 0.5) * 0.01,
            is_agent: AGENT_IDS.includes(u.id),
          }))
        setNearbyUsers(filtered)
      }

      // Load nearby groups
      const { data: groups } = await supabase.rpc('nearby_groups', { lat, lon, radius_m: radius })
      if (groups) {
        const withCoords = groups.map((g: any) => ({
          ...g,
          lat: g.lat || lat + (Math.random() - 0.5) * 0.008,
          lon: g.lon || lon + (Math.random() - 0.5) * 0.008,
        }))
        setNearbyGroups(withCoords)
      }
    } catch (e) { console.log(e) }
  }

  const createGroupWithSelected = async () => {
    if (!userId || !myLocation || selectedForGroup.size === 0) return
    setCreatingGroup(true)
    try {
      const { data: myProfile } = await supabase.from('profiles').select('display_name, username').eq('id', userId).single()
      const myName = myProfile?.display_name || myProfile?.username || 'Me'

      const { data, error } = await supabase.from('groups').insert({
        name: `${myName}'s Radar Group`,
        location: `POINT(${myLocation.lon} ${myLocation.lat})`,
        status: 'lobby',
        type: 'manual',
        group_type: 'live',
        min_members: selectedForGroup.size + 1,
        member_count: 1,
        created_by: userId,
      }).select().single()

      if (error) throw error

      await supabase.from('group_members').insert({ group_id: data.id, user_id: userId, role: 'admin' })
      await supabase.from('group_agents').insert({ group_id: data.id, enabled: true })

      // Add selected users
      for (const uid of selectedForGroup) {
        await supabase.from('group_members').insert({ group_id: data.id, user_id: uid, role: 'member' })
      }

      await supabase.from('messages').insert({
        group_id: data.id, type: 'system',
        content: `📍 Group created from Radar with ${selectedForGroup.size + 1} people nearby`
      })

      setSelectedForGroup(new Set())
      Alert.alert('✓ Group created!', `${selectedForGroup.size + 1} people added`, [
        { text: 'Open group', onPress: () => router.push({ pathname: '/chat', params: { id: data.id, name: data.name, members: data.member_count.toString() } }) },
        { text: 'Stay on Radar' }
      ])
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setCreatingGroup(false) }
  }

  const toggleSelectUser = (userId: string) => {
    setSelectedForGroup(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  if (loading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹</Text></TouchableOpacity>
          <Text style={s.title}>Radar 📡</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.center}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={s.loadingText}>Finding people nearby...</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹</Text></TouchableOpacity>
        <Text style={s.title}>Radar 📡</Text>
        <TouchableOpacity
          style={[s.modeToggle, myMode === 'ghost' && s.modeToggleGhost]}
          onPress={() => setMyMode(myMode === 'lit' ? 'ghost' : 'lit')}
        >
          <Text style={s.modeToggleText}>{myMode === 'lit' ? '🔥' : '👻'}</Text>
        </TouchableOpacity>
      </View>

      {/* Radius selector */}
      <View style={s.radiusRow}>
        <Text style={s.radiusLabel}>Radius:</Text>
        {[500, 1000, 2000, 5000].map(r => (
          <TouchableOpacity
            key={r}
            style={[s.radiusBtn, radius === r && s.radiusBtnActive]}
            onPress={async () => {
              setRadius(r)
              if (myLocation && userId) await loadNearby(myLocation.lat, myLocation.lon, userId)
            }}
          >
            <Text style={[s.radiusBtnText, radius === r && s.radiusBtnTextActive]}>
              {r < 1000 ? `${r}m` : `${r / 1000}km`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Create group from selected */}
      {selectedForGroup.size > 0 && (
        <TouchableOpacity style={s.createGroupBar} onPress={createGroupWithSelected} disabled={creatingGroup}>
          {creatingGroup
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.createGroupBarText}>⚡ Create group with {selectedForGroup.size} selected people</Text>
          }
        </TouchableOpacity>
      )}

      {myLocation && (
        <MapView
          ref={mapRef}
          style={s.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={{
            latitude: myLocation.lat,
            longitude: myLocation.lon,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation
          showsMyLocationButton
        >
          {/* Radius circle */}
          <Circle
            center={{ latitude: myLocation.lat, longitude: myLocation.lon }}
            radius={radius}
            fillColor="rgba(29, 158, 117, 0.08)"
            strokeColor="rgba(29, 158, 117, 0.3)"
            strokeWidth={1}
          />

          {/* Nearby users */}
          {nearbyUsers.map(user => (
            <Marker
              key={user.id}
              coordinate={{ latitude: user.lat, longitude: user.lon }}
              onPress={() => setSelectedUser(user)}
            >
              <View style={[
                s.markerUser,
                user.identity_mode === 'ghost' && s.markerGhost,
                user.is_agent && s.markerAgent,
                selectedForGroup.has(user.id) && s.markerSelected,
              ]}>
                <Text style={s.markerEmoji}>{user.avatar_char || (user.identity_mode === 'ghost' ? '👻' : user.display_name?.[0] || '?')}</Text>
              </View>
            </Marker>
          ))}

          {/* Nearby groups */}
          {nearbyGroups.map(group => (
            <Marker
              key={group.id}
              coordinate={{ latitude: group.lat, longitude: group.lon }}
              onPress={() => setSelectedGroup(group)}
            >
              <View style={[s.markerGroup, group.status === 'open' && s.markerGroupOpen]}>
                <Text style={s.markerGroupEmoji}>⚡</Text>
                <Text style={s.markerGroupCount}>{group.member_count}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      )}

      {/* Stats bar */}
      <View style={s.statsBar}>
        <Text style={s.statsText}>👥 {nearbyUsers.length} people · ⚡ {nearbyGroups.length} trybes nearby</Text>
        <TouchableOpacity onPress={() => myLocation && userId && loadNearby(myLocation.lat, myLocation.lon, userId)}>
          <Text style={s.refreshBtn}>↻ Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* User detail modal */}
      <Modal visible={!!selectedUser} transparent animationType="slide" onRequestClose={() => setSelectedUser(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            {selectedUser && (
              <>
                <View style={s.modalUserAvatar}>
                  <Text style={{ fontSize: 36 }}>{selectedUser.avatar_char || (selectedUser.identity_mode === 'ghost' ? '👻' : selectedUser.display_name?.[0] || '?')}</Text>
                </View>
                <Text style={s.modalName}>
                  {selectedUser.identity_mode === 'ghost' ? 'Anonymous' : (selectedUser.display_name || selectedUser.username)}
                </Text>
                <Text style={s.modalDist}>
                  {selectedUser.distance_m < 1000 ? `${Math.round(selectedUser.distance_m)}m away` : `${(selectedUser.distance_m / 1000).toFixed(1)}km away`}
                </Text>
                {selectedUser.is_agent && <Text style={s.agentLabel}>🤖 AI Agent</Text>}

                <View style={s.modalActions}>
                  <TouchableOpacity style={s.modalBtn} onPress={() => {
                    setSelectedUser(null)
                    router.push({ pathname: '/dm', params: { userId: selectedUser.id, userName: selectedUser.display_name || selectedUser.username, myMode, myAvatar: '📡', isAgent: selectedUser.is_agent ? '1' : '0' } })
                  }}>
                    <Text style={s.modalBtnText}>💬 Message</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.modalBtn, s.modalBtnPurple]} onPress={() => {
                    toggleSelectUser(selectedUser.id)
                    setSelectedUser(null)
                  }}>
                    <Text style={s.modalBtnText}>{selectedForGroup.has(selectedUser.id) ? '✓ Selected' : '⚡ Add to group'}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={s.modalClose} onPress={() => setSelectedUser(null)}>
                  <Text style={s.modalCloseText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Group detail modal */}
      <Modal visible={!!selectedGroup} transparent animationType="slide" onRequestClose={() => setSelectedGroup(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            {selectedGroup && (
              <>
                <Text style={s.modalGroupEmoji}>{selectedGroup.status === 'open' ? '🟢' : '🟣'}</Text>
                <Text style={s.modalName}>{selectedGroup.name}</Text>
                <Text style={s.modalDist}>{selectedGroup.member_count} people · {selectedGroup.distance_m < 1000 ? `${Math.round(selectedGroup.distance_m)}m away` : `${(selectedGroup.distance_m / 1000).toFixed(1)}km away`}</Text>
                <View style={s.modalActions}>
                  <TouchableOpacity style={s.modalBtn} onPress={() => {
                    setSelectedGroup(null)
                    if (selectedGroup.status === 'open') {
                      router.push({ pathname: '/chat', params: { id: selectedGroup.id, name: selectedGroup.name, members: selectedGroup.member_count.toString() } })
                    } else {
                      router.push({ pathname: '/lobby', params: { id: selectedGroup.id, name: selectedGroup.name } })
                    }
                  }}>
                    <Text style={s.modalBtnText}>{selectedGroup.status === 'open' ? '⚡ Enter Chat' : '🟣 View Lobby'}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={s.modalClose} onPress={() => setSelectedGroup(null)}>
                  <Text style={s.modalCloseText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 14, color: GRAY },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  back: { fontSize: 32, color: GREEN, lineHeight: 36, marginTop: -4 },
  title: { fontSize: 18, fontWeight: '700', color: '#2C2C2A' },
  modeToggle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center' },
  modeToggleGhost: { backgroundColor: '#EEEDFE' },
  modeToggleText: { fontSize: 18 },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  radiusLabel: { fontSize: 12, color: GRAY, fontWeight: '600' },
  radiusBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1EFE8' },
  radiusBtnActive: { backgroundColor: GREEN },
  radiusBtnText: { fontSize: 12, color: GRAY, fontWeight: '600' },
  radiusBtnTextActive: { color: '#fff' },
  createGroupBar: { backgroundColor: PURPLE, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  createGroupBarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  map: { flex: 1 },
  statsBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  statsText: { fontSize: 13, color: GRAY },
  refreshBtn: { fontSize: 14, color: GREEN, fontWeight: '600' },
  markerUser: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  markerGhost: { backgroundColor: '#F1EFE8', borderColor: '#B4B2A9' },
  markerAgent: { backgroundColor: '#FFF0EB', borderColor: '#FF6B35' },
  markerSelected: { borderColor: GREEN, borderWidth: 3, backgroundColor: '#E1F5EE' },
  markerEmoji: { fontSize: 20 },
  markerGroup: { backgroundColor: '#EEEDFE', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 2, borderColor: PURPLE, alignItems: 'center' },
  markerGroupOpen: { backgroundColor: '#E1F5EE', borderColor: GREEN },
  markerGroupEmoji: { fontSize: 14 },
  markerGroupCount: { fontSize: 10, fontWeight: '700', color: '#2C2C2A' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, alignItems: 'center' },
  modalUserAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  modalGroupEmoji: { fontSize: 40, marginBottom: 12 },
  modalName: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 6 },
  modalDist: { fontSize: 14, color: GRAY, marginBottom: 8 },
  agentLabel: { fontSize: 13, color: '#FF6B35', fontWeight: '600', marginBottom: 8 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16, width: '100%' },
  modalBtn: { flex: 1, backgroundColor: GREEN, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  modalBtnPurple: { backgroundColor: PURPLE },
  modalBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  modalClose: { marginTop: 16 },
  modalCloseText: { fontSize: 15, color: GRAY },
})
