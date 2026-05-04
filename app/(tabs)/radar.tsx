import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, StatusBar, Switch, Alert, Pressable,
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

export default function RadarScreen() {
  const router = useRouter()
  const [radarOn, setRadarOn] = useState(false)
  const [myMode, setMyMode] = useState<'lit' | 'ghost'>('lit')
  const [myAvatar, setMyAvatar] = useState('🦊')
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  const updateRadarStatus = async (on: boolean, mode: 'lit' | 'ghost') => {
    if (!userId) return
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Location needed', 'Radar needs your location to work'); return }
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
    if (on) loadNearbyUsers(latitude, longitude)
  }

  const loadNearbyUsers = useCallback(async (lat?: number, lon?: number) => {
    setLoading(true)
    try {
      let latitude = lat, longitude = lon
      if (!latitude || !longitude) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        latitude = loc.coords.latitude
        longitude = loc.coords.longitude
      }
      const { data, error } = await supabase.rpc('nearby_users', {
        p_lat: latitude, p_lon: longitude, radius_m: 10000
      })
      if (error) throw error
      setNearbyUsers((data || []).filter((u: NearbyUser) => u.id !== userId))
    } catch (err: any) {
      console.log('radar error:', err.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  const toggleRadar = async (val: boolean) => {
    setRadarOn(val)
    await updateRadarStatus(val, myMode)
  }

  const switchMode = async (mode: 'lit' | 'ghost') => {
    setMyMode(mode)
    if (radarOn) await updateRadarStatus(true, mode)
  }

  const openChat = (user: NearbyUser) => {
    router.push({
      pathname: '/dm',
      params: {
        userId: user.id,
        userName: user.identity_mode === 'ghost' ? (user.avatar_char || '👻') : (user.display_name || user.username),
        myMode,
        myAvatar,
      }
    })
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <Text style={s.title}>Radar 📡</Text>
        <View style={s.radarToggle}>
          <Text style={s.radarLabel}>{radarOn ? 'Active' : 'Off'}</Text>
          <Switch
            value={radarOn}
            onValueChange={toggleRadar}
            trackColor={{ true: GREEN, false: '#E0DED8' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {radarOn && (
        <View style={s.modeBar}>
          <Text style={s.modeLabel}>Appear as:</Text>
          <View style={s.modeBtns}>
            <TouchableOpacity
              style={[s.modeBtn, myMode === 'lit' && s.modeBtnActive]}
              onPress={() => switchMode('lit')}
            >
              <Text style={s.modeBtnText}>🔥 Lit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeBtn, myMode === 'ghost' && s.modeBtnGhostActive]}
              onPress={() => switchMode('ghost')}
            >
              <Text style={s.modeBtnText}>👻 Ghost</Text>
            </TouchableOpacity>
          </View>
          {myMode === 'ghost' && (
            <TouchableOpacity style={s.avatarPicker} onPress={() => setShowAvatarPicker(!showAvatarPicker)}>
              <Text style={s.avatarPickerText}>Your avatar: {myAvatar} — change</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {showAvatarPicker && (
        <View style={s.avatarGrid}>
          {AVATARS.map(a => (
            <TouchableOpacity
              key={a}
              style={[s.avatarOption, myAvatar === a && s.avatarOptionSelected]}
              onPress={() => { setMyAvatar(a); setShowAvatarPicker(false) }}
            >
              <Text style={s.avatarEmoji}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!radarOn ? (
        <View style={s.offState}>
          <Text style={s.offEmoji}>📡</Text>
          <Text style={s.offTitle}>Radar is off</Text>
          <Text style={s.offSub}>Turn on to discover people near you and let them find you</Text>
          <TouchableOpacity style={s.offBtn} onPress={() => toggleRadar(true)}>
            <Text style={s.offBtnText}>Activate Radar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={nearbyUsers}
          keyExtractor={u => u.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <Text style={s.nearbyCount}>
              {nearbyUsers.length > 0
                ? `${nearbyUsers.length} people nearby`
                : loading ? 'Scanning...' : 'No one nearby yet'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable style={s.userCard} onPress={() => openChat(item)}>
              <View style={s.userAvatar}>
                <Text style={s.userAvatarText}>
                  {item.identity_mode === 'ghost'
                    ? (item.avatar_char || '👻')
                    : (item.display_name?.[0] || item.username?.[0] || '?')}
                </Text>
              </View>
              <View style={s.userInfo}>
                <Text style={s.userName}>
                  {item.identity_mode === 'ghost'
                    ? 'Ghost'
                    : (item.display_name || item.username)}
                </Text>
                <Text style={s.userDist}>
                  {item.identity_mode === 'ghost' ? '👻 Anonymous' : '🔥 Lit'} · {
                    item.distance_m < 1000
                      ? `${Math.round(item.distance_m)}m away`
                      : `${(item.distance_m/1000).toFixed(1)}km away`
                  }
                </Text>
              </View>
              <Text style={s.chatArrow}>💬</Text>
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
  title: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  radarToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radarLabel: { fontSize: 13, color: GRAY, fontWeight: '500' },
  modeBar: { backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  modeLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8 },
  modeBtns: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F1EFE8', alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#E1F5EE', borderWidth: 1.5, borderColor: GREEN },
  modeBtnGhostActive: { backgroundColor: '#EEEDFE', borderWidth: 1.5, borderColor: PURPLE },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  avatarPicker: { marginTop: 8 },
  avatarPickerText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, backgroundColor: '#fff', gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  avatarOption: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  avatarOptionSelected: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  avatarEmoji: { fontSize: 24 },
  offState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  offEmoji: { fontSize: 64, marginBottom: 16 },
  offTitle: { fontSize: 22, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  offSub: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  offBtn: { backgroundColor: GREEN, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 24 },
  offBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  list: { padding: 16, gap: 10 },
  nearbyCount: { fontSize: 12, fontWeight: '600', color: GRAY, letterSpacing: 0.5, marginBottom: 8 },
  userCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 0.5, borderColor: '#E0DED8', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  userAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { fontSize: 26 },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', marginBottom: 3 },
  userDist: { fontSize: 12, color: GRAY },
  chatArrow: { fontSize: 22 },
})