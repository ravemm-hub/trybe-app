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
  const [contacts, setContacts] = useState<any[]>([])
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set())
  const [contactSearch, setContactSearch] = useState('')
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null)
  const [createdGroupName, setCreatedGroupName] = useState('')

  useEffect(() => { getLocation() }, [])

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

  const handleCreate = async () => {
    if (!name.trim()) { Alert.alert('Name required'); return }
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const lat = coords?.lat ?? 32.0853
      const lon = coords?.lon ?? 34.7818

      const { data, error } = await supabase.from('groups').insert({
        name: name.trim(),
        location_name: locationName.trim() || null,
        location: `POINT(${lon} ${lat})`,
        min_members: 1,
        member_count: 1,
        status: 'open',
        type: 'manual',
        group_type: 'live',
        is_private: isPrivate,
        created_by: user.id,
      }).select().single()

      if (error) throw error

      await supabase.from('group_members').insert({ group_id: data.id, user_id: user.id, role: 'admin' })
      await supabase.from('group_agents').insert({ group_id: data.id, enabled: true })
      await supabase.from('messages').insert({
        group_id: data.id, type: 'system',
        content: `"${data.name}" created ${isPrivate ? '🔒' : '🌐'} — invite people to join!`
      })

      setCreatedGroupId(data.id)
      setCreatedGroupName(data.name)
      setShowInvite(true)
    } catch (err: any) { Alert.alert('Error', err.message) }
    finally { setLoading(false) }
  }

  const loadContacts = async () => {
    const { status } = await Contacts.requestPermissionsAsync()
    if (status !== 'granted') return
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      sort: Contacts.SortTypes.FirstName,
    })
    const list = data.filter(c => c.phoneNumbers?.length && c.name).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phoneNumbers![0].number?.replace(/[\s\-\(\)]/g, '') || '',
      initials: c.name!.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase(),
    }))
    setContacts(list)
  }

  const inviteSelected = async () => {
    if (!createdGroupId || selectedContacts.size === 0) {
      router.replace({ pathname: '/chat', params: { id: createdGroupId!, name: createdGroupName, members: '1' } })
      return
    }
    // Find Tryber users by phone
    const selectedList = contacts.filter(c => selectedContacts.has(c.id))
    const phones = selectedList.map(c => c.phone)
    const { data: tryberUsers } = await supabase.from('profiles').select('id, phone').in('phone', phones)

    for (const u of tryberUsers || []) {
      await supabase.from('group_members').insert({ group_id: createdGroupId, user_id: u.id, role: 'member' }).catch(() => {})
    }

    if ((tryberUsers?.length || 0) > 0) {
      await supabase.from('groups').update({ member_count: 1 + (tryberUsers?.length || 0) }).eq('id', createdGroupId)
    }

    router.replace({ pathname: '/chat', params: { id: createdGroupId, name: createdGroupName, members: (1 + (tryberUsers?.length || 0)).toString() } })
  }

  const filteredContacts = contacts.filter(c =>
    !contactSearch || c.name.toLowerCase().includes(contactSearch.toLowerCase())
  )

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
              <ActivityIndicator color={GREEN} size="small" />
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
              <Text style={[s.privacyBtnText, !isPrivate && { color: GREEN }]}>Public</Text>
              <Text style={s.privacyDesc}>Anyone can join</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.privacyBtn, isPrivate && s.privacyBtnActivePrivate]} onPress={() => setIsPrivate(true)}>
              <Text style={s.privacyEmoji}>🔒</Text>
              <Text style={[s.privacyBtnText, isPrivate && { color: PURPLE }]}>Private</Text>
              <Text style={s.privacyDesc}>Invite only</Text>
            </TouchableOpacity>
          </View>

          <View style={s.infoBox}>
            <Text style={s.infoText}>⚡ Your Trybe opens immediately — invite people from your contacts or let others find it on Explore</Text>
          </View>

          <TouchableOpacity
            style={[s.submitBtn, (loading || locLoading) && s.submitBtnDisabled]}
            onPress={handleCreate}
            disabled={loading || locLoading}
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
            <Text style={s.inviteSub}>Invite people from your contacts</Text>
          </View>

          <View style={s.searchRow}>
            <TextInput
              style={s.searchInput}
              value={contactSearch}
              onChangeText={setContactSearch}
              placeholder="Search contacts..."
              placeholderTextColor="#B4B2A9"
              onFocus={loadContacts}
            />
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
                <Pressable style={s.contactRow} onPress={() => {
                  setSelectedContacts(prev => {
                    const next = new Set(prev)
                    next.has(item.id) ? next.delete(item.id) : next.add(item.id)
                    return next
                  })
                }}>
                  <View style={[s.contactAvatar, selectedContacts.has(item.id) && s.contactAvatarSelected]}>
                    <Text style={s.contactInitials}>{item.initials}</Text>
                    {selectedContacts.has(item.id) && <View style={s.checkmark}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✓</Text></View>}
                  </View>
                  <Text style={s.contactName}>{item.name}</Text>
                </Pressable>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: '#E0DED8', marginLeft: 68 }} />}
            />
          )}

          <View style={[s.inviteFooter, { paddingBottom: insets.bottom + 8 }]}>
            <TouchableOpacity style={s.inviteSkipBtn} onPress={() => router.replace({ pathname: '/chat', params: { id: createdGroupId!, name: createdGroupName, members: '1' } })}>
              <Text style={s.inviteSkipText}>Skip for now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.inviteSendBtn, selectedContacts.size === 0 && { opacity: 0.5 }]} onPress={inviteSelected}>
              <Text style={s.inviteSendText}>Invite {selectedContacts.size > 0 ? `(${selectedContacts.size})` : ''} & Open →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const Pressable = TouchableOpacity
const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  cancel: { fontSize: 16, color: GRAY },
  title: { fontSize: 17, fontWeight: '700', color: '#2C2C2A' },
  form: { padding: 20 },
  label: { fontSize: 11, fontWeight: '700', color: GRAY, marginTop: 24, marginBottom: 8, letterSpacing: 0.8 },
  input: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#2C2C2A' },
  locBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E1F5EE', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  locText: { fontSize: 13, color: '#0F6E56' },
  privacyRow: { flexDirection: 'row', gap: 10 },
  privacyBtn: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: '#F1EFE8', alignItems: 'center', gap: 4 },
  privacyBtnActive: { backgroundColor: '#E1F5EE', borderWidth: 2, borderColor: GREEN },
  privacyBtnActivePrivate: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  privacyEmoji: { fontSize: 24 },
  privacyBtnText: { fontSize: 14, fontWeight: '700', color: '#2C2C2A' },
  privacyDesc: { fontSize: 11, color: GRAY },
  infoBox: { backgroundColor: '#E1F5EE', borderRadius: 12, padding: 14, marginTop: 20 },
  infoText: { fontSize: 13, color: '#0F6E56', lineHeight: 20 },
  submitBtn: { backgroundColor: GREEN, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  inviteContainer: { flex: 1, backgroundColor: '#FAFAF8' },
  inviteHeader: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8', alignItems: 'center' },
  inviteTitle: { fontSize: 22, fontWeight: '800', color: '#2C2C2A', marginBottom: 4 },
  inviteSub: { fontSize: 14, color: GRAY },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  searchInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#2C2C2A' },
  loadContactsBtn: { margin: 32, backgroundColor: GREEN, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  loadContactsBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  contactAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  contactAvatarSelected: { backgroundColor: '#E1F5EE', borderWidth: 2, borderColor: GREEN },
  contactInitials: { fontSize: 15, fontWeight: '700', color: '#2C2C2A' },
  checkmark: { position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  contactName: { fontSize: 15, fontWeight: '500', color: '#2C2C2A', flex: 1 },
  inviteFooter: { flexDirection: 'row', gap: 10, padding: 16, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  inviteSkipBtn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: '#F1EFE8', alignItems: 'center' },
  inviteSkipText: { fontSize: 14, color: GRAY, fontWeight: '600' },
  inviteSendBtn: { flex: 1, backgroundColor: GREEN, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  inviteSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
