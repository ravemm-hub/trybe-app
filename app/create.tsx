import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, StatusBar, FlatList, Modal,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import * as Contacts from 'expo-contacts'
import { supabase } from '../lib/supabase'

const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'
const BG = '#F8F9FD'
const CARD = '#FFFFFF'
const TEXT = '#1A1A2E'
const GRAY = '#8A8A9A'

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
  lat?: number
  lon?: number
  is_agent?: boolean
}

export default function CreateScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [locLoading, setLocLoading] = useState(true)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [showRadarPicker, setShowRadarPicker] = useState(false)
  const [contacts, setContacts] = useState<any[]>([])
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [contactSearch, setContactSearch] = useState('')
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null)
  const [createdGroupName, setCreatedGroupName] = useState('')
  const [radius, setRadius] = useState(500)
  const [userId, setUserId] = useState<string | null>(null)
  const [inviteTab, setInviteTab] = useState<'radar' | 'contacts'>('radar')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    getLocation()
  }, [])

  const getLocation = async () => {
    setLocLoading(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { setLocLoading(false); return }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude })
      const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      if (place) {
        const placeName = [place.name, place.street, place.city].filter(Boolean).slice(0, 2).join(', ')
        setLocationName(placeName)
        const now = new Date()
        const hour = now.getHours()
        const time = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Night'
        setName(`${time} ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()]} — ${placeName}`)
      }
    } catch {}
    finally { setLocLoading(false) }
  }

  const loadNearbyUsers = async (r: number) => {
    if (!coords || !userId) return
    try {
      await supabase.rpc('place_agents_near_user', { user_id_input: userId })
      const { data } = await supabase.rpc('nearby_users', { p_lat: coords.lat, p_lon: coords.lon, radius_m: r })
      const users = ((data || []) as NearbyUser[])
        .filter(u => u.id !== userId)
        .map(u => ({ ...u, is_agent: AGENT_IDS.includes(u.id) }))
      setNearbyUsers(users)
    } catch {}
  }

  const handleCreate = async () => {
    if (!name.trim()) { Alert.alert('Name required'); return }
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const lat = coords?.lat ?? 32.0853
      const lon = coords?.lon ?? 34.7818

      const { data, error } = await supabase.from('groups').insert({
        name: name.trim(), location_name: locationName.trim() || null,
        location: `POINT(${lon} ${lat})`,
        min_members: 1, member_count: 1, status: 'open',
        type: 'manual', group_type: 'live', is_private: isPrivate,
        created_by: user.id,
      }).select().single()

      if (error) throw error

      await supabase.from('group_members').insert({ group_id: data.id, user_id: user.id, role: 'admin' })
      await supabase.from('group_agents').insert({ group_id: data.id, enabled: true })
      await supabase.from('messages').insert({ group_id: data.id, type: 'system', content: `"${data.name}" created ${isPrivate ? '🔒' : '🌐'}` })

      setCreatedGroupId(data.id)
      setCreatedGroupName(data.name)
      await loadNearbyUsers(radius)
      setShowInvite(true)
    } catch (err: any) { Alert.alert('Error', err.message) }
    finally { setLoading(false) }
  }

  const loadContacts = async () => {
    const { status } = await Contacts.requestPermissionsAsync()
    if (status !== 'granted') return
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name], sort: Contacts.SortTypes.FirstName })
    const list = data.filter(c => c.phoneNumbers?.length && c.name).map(c => ({
      id: c.id, name: c.name,
      phone: c.phoneNumbers![0].number?.replace(/[\s\-\(\)]/g, '') || '',
      initials: c.name!.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase(),
    }))
    setContacts(list)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const inviteAndOpen = async () => {
    if (!createdGroupId) return

    // Add selected nearby users (agents/real)
    for (const uid of selectedIds) {
      if (AGENT_IDS.includes(uid)) {
        await supabase.from('group_members').insert({ group_id: createdGroupId, user_id: uid, role: 'member' }).catch(() => {})
      } else {
        await supabase.from('group_members').insert({ group_id: createdGroupId, user_id: uid, role: 'member' }).catch(() => {})
      }
    }

    // Add selected contacts who are on Tryber
    const selectedContacts = contacts.filter(c => selectedIds.has(c.id))
    if (selectedContacts.length > 0) {
      const phones = selectedContacts.map(c => c.phone)
      const { data: tryberUsers } = await supabase.from('profiles').select('id, phone').in('phone', phones)
      for (const u of tryberUsers || []) {
        await supabase.from('group_members').insert({ group_id: createdGroupId, user_id: u.id, role: 'member' }).catch(() => {})
      }
    }

    const totalMembers = 1 + selectedIds.size
    await supabase.from('groups').update({ member_count: totalMembers }).eq('id', createdGroupId)

    router.replace({ pathname: '/chat', params: { id: createdGroupId, name: createdGroupName, members: totalMembers.toString() } })
  }

  const filteredContacts = contacts.filter(c => !contactSearch || c.name.toLowerCase().includes(contactSearch.toLowerCase()))

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Text style={s.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={s.title}>Drop a Trybe</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {locLoading && (
            <View style={s.locBanner}>
              <ActivityIndicator color={TEAL} size="small" />
              <Text style={s.locText}>Detecting location...</Text>
            </View>
          )}

          <Text style={s.label}>NAME</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="What's the vibe?" placeholderTextColor="#B4B2A9" maxLength={60} />

          <Text style={s.label}>LOCATION</Text>
          <TextInput style={s.input} value={locationName} onChangeText={setLocationName} placeholder="e.g. Barby Club, Tel Aviv" placeholderTextColor="#B4B2A9" maxLength={80} />

          <Text style={s.label}>PRIVACY</Text>
          <View style={s.privacyRow}>
            <TouchableOpacity style={[s.privacyBtn, !isPrivate && s.privacyBtnActive]} onPress={() => setIsPrivate(false)}>
              <Text style={s.privacyEmoji}>🌐</Text>
              <Text style={[s.privacyBtnText, !isPrivate && { color: TEAL }]}>Public</Text>
              <Text style={s.privacyDesc}>Anyone can join</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.privacyBtn, isPrivate && s.privacyBtnPrivate]} onPress={() => setIsPrivate(true)}>
              <Text style={s.privacyEmoji}>🔒</Text>
              <Text style={[s.privacyBtnText, isPrivate && { color: PRIMARY }]}>Private</Text>
              <Text style={s.privacyDesc}>Invite only</Text>
            </TouchableOpacity>
          </View>

          <View style={s.infoBox}>
            <Text style={s.infoText}>⚡ Your Trybe opens immediately — invite people from Radar or your contacts</Text>
          </View>

          <TouchableOpacity
            style={[s.submitBtn, (loading || locLoading) && s.submitBtnDisabled]}
            onPress={handleCreate} disabled={loading || locLoading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>⚡ Drop the Trybe</Text>}
          </TouchableOpacity>
          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Invite Modal */}
      <Modal visible={showInvite} animationType="slide" onRequestClose={() => setShowInvite(false)}>
        <View style={[s.inviteContainer, { paddingTop: insets.top }]}>
          <View style={s.inviteHeader}>
            <Text style={s.inviteTitle}>🎉 Trybe Created!</Text>
            <Text style={s.inviteSub}>Invite people to join</Text>
          </View>

          {/* Tabs */}
          <View style={s.inviteTabs}>
            <TouchableOpacity style={[s.inviteTab, inviteTab === 'radar' && s.inviteTabActive]} onPress={() => { setInviteTab('radar'); loadNearbyUsers(radius) }}>
              <Text style={[s.inviteTabText, inviteTab === 'radar' && s.inviteTabTextActive]}>📡 Radar Nearby</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.inviteTab, inviteTab === 'contacts' && s.inviteTabActive]} onPress={() => { setInviteTab('contacts'); loadContacts() }}>
              <Text style={[s.inviteTabText, inviteTab === 'contacts' && s.inviteTabTextActive]}>👥 Contacts</Text>
            </TouchableOpacity>
          </View>

          {inviteTab === 'radar' ? (
            <View style={{ flex: 1 }}>
              {/* Radius selector */}
              <View style={s.radiusRow}>
                <Text style={s.radiusLabel}>Radius:</Text>
                {[10, 50, 100, 500, 1000].map(r => (
                  <TouchableOpacity key={r} style={[s.radiusBtn, radius === r && s.radiusBtnActive]} onPress={() => { setRadius(r); loadNearbyUsers(r) }}>
                    <Text style={[s.radiusBtnText, radius === r && s.radiusBtnTextActive]}>{r < 1000 ? `${r}m` : `${r/1000}km`}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Nearby users map placeholder */}
              {coords && (
                <View style={s.radarPreview}>
                  <Text style={s.radarPreviewText}>📡 Showing users within {radius < 1000 ? `${radius}m` : `${radius/1000}km`}</Text>
                  <Text style={s.radarPreviewSub}>{nearbyUsers.length} people found nearby</Text>
                </View>
              )}

              {/* Nearby list */}
              <FlatList
                data={nearbyUsers}
                keyExtractor={u => u.id}
                style={{ maxHeight: 160 }}
                ListEmptyComponent={<Text style={s.emptyNearby}>No one nearby — try increasing the radius</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.nearbyRow} onPress={() => toggleSelect(item.id)}>
                    <View style={[s.nearbyAvatar, item.is_agent && { borderColor: PRIMARY, borderWidth: 2 }]}>
                      <Text style={{ fontSize: 20 }}>{item.avatar_char || '👤'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.nearbyName}>{item.identity_mode === 'ghost' ? '👻 Anonymous' : (item.display_name || item.username)}</Text>
                      <Text style={s.nearbyDist}>{item.distance_m < 1000 ? `${Math.round(item.distance_m)}m` : `${(item.distance_m/1000).toFixed(1)}km`} away{item.is_agent ? ' · AI Agent' : ''}</Text>
                    </View>
                    <View style={[s.checkbox, selectedIds.has(item.id) && s.checkboxSelected]}>
                      {selectedIds.has(item.id) && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <View style={s.searchRow}>
                <TextInput style={s.searchInput} value={contactSearch} onChangeText={setContactSearch} placeholder="Search contacts..." placeholderTextColor="#B4B2A9" onFocus={loadContacts} />
              </View>
              {contacts.length === 0 ? (
                <TouchableOpacity style={s.loadContactsBtn} onPress={loadContacts}>
                  <Text style={s.loadContactsBtnText}>📱 Load Contacts</Text>
                </TouchableOpacity>
              ) : (
                <FlatList
                  data={filteredContacts}
                  keyExtractor={c => c.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={s.nearbyRow} onPress={() => toggleSelect(item.id)}>
                      <View style={s.nearbyAvatar}>
                        <Text style={s.nearbyInitials}>{item.initials}</Text>
                      </View>
                      <Text style={[s.nearbyName, { flex: 1 }]}>{item.name}</Text>
                      <View style={[s.checkbox, selectedIds.has(item.id) && s.checkboxSelected]}>
                        {selectedIds.has(item.id) && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  )}
                />
              )}
            </View>
          )}

          <View style={[s.inviteFooter, { paddingBottom: insets.bottom + 8 }]}>
            <TouchableOpacity style={s.skipBtn} onPress={() => router.replace({ pathname: '/chat', params: { id: createdGroupId!, name: createdGroupName, members: '1' } })}>
              <Text style={s.skipBtnText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.inviteSendBtn, selectedIds.size === 0 && { opacity: 0.6 }]} onPress={inviteAndOpen}>
              <Text style={s.inviteSendText}>{selectedIds.size > 0 ? `Add ${selectedIds.size} & Open →` : 'Open Group →'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: CARD },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  cancel: { fontSize: 16, color: GRAY },
  title: { fontSize: 17, fontWeight: '700', color: TEXT },
  form: { padding: 20 },
  label: { fontSize: 11, fontWeight: '700', color: GRAY, marginTop: 24, marginBottom: 8, letterSpacing: 0.8 },
  input: { backgroundColor: BG, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: '#EBEBEB' },
  locBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E8F5F3', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  locText: { fontSize: 13, color: TEAL },
  privacyRow: { flexDirection: 'row', gap: 10 },
  privacyBtn: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: BG, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#EBEBEB' },
  privacyBtnActive: { backgroundColor: '#E8F5F3', borderColor: TEAL },
  privacyBtnPrivate: { backgroundColor: '#EEF0FF', borderColor: PRIMARY },
  privacyEmoji: { fontSize: 24 },
  privacyBtnText: { fontSize: 14, fontWeight: '700', color: TEXT },
  privacyDesc: { fontSize: 11, color: GRAY },
  infoBox: { backgroundColor: '#E8F5F3', borderRadius: 12, padding: 14, marginTop: 20 },
  infoText: { fontSize: 13, color: TEAL, lineHeight: 20 },
  submitBtn: { backgroundColor: TEAL, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  inviteContainer: { flex: 1, backgroundColor: BG },
  inviteHeader: { padding: 20, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB', alignItems: 'center' },
  inviteTitle: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 4 },
  inviteSub: { fontSize: 14, color: GRAY },
  inviteTabs: { flexDirection: 'row', backgroundColor: CARD, paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  inviteTab: { flex: 1, paddingVertical: 8, borderRadius: 12, backgroundColor: BG, alignItems: 'center' },
  inviteTabActive: { backgroundColor: PRIMARY },
  inviteTabText: { fontSize: 13, fontWeight: '600', color: GRAY },
  inviteTabTextActive: { color: '#fff' },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  radiusLabel: { fontSize: 12, color: GRAY, fontWeight: '600' },
  radiusBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: BG },
  radiusBtnActive: { backgroundColor: TEAL },
  radiusBtnText: { fontSize: 11, color: GRAY, fontWeight: '600' },
  radiusBtnTextActive: { color: '#fff' },
  radarPreview: { backgroundColor: '#E8F5F3', borderRadius: 12, padding: 14, marginHorizontal: 16, marginVertical: 8, alignItems: 'center' },
  radarPreviewText: { fontSize: 14, fontWeight: '600', color: TEAL },
  radarPreviewSub: { fontSize: 12, color: GRAY, marginTop: 4 },
  emptyNearby: { textAlign: 'center', color: GRAY, padding: 20, fontSize: 13 },
  nearbyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  nearbyAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  nearbyInitials: { fontSize: 16, fontWeight: '700', color: PRIMARY },
  nearbyName: { fontSize: 15, fontWeight: '600', color: TEXT },
  nearbyDist: { fontSize: 12, color: GRAY, marginTop: 2 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#EBEBEB', alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: TEAL, borderColor: TEAL },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  searchInput: { backgroundColor: BG, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: TEXT },
  loadContactsBtn: { margin: 32, backgroundColor: PRIMARY, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  loadContactsBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  inviteFooter: { flexDirection: 'row', gap: 10, padding: 16, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: '#EBEBEB' },
  skipBtn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: BG, alignItems: 'center' },
  skipBtnText: { fontSize: 14, color: GRAY, fontWeight: '600' },
  inviteSendBtn: { flex: 1, backgroundColor: TEAL, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  inviteSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
