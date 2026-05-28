import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, ScrollView, Alert, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { supabase } from '../src/lib/supabase'
import { askClaude } from '../src/lib/claude'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../src/constants'

type GroupType = 'open' | 'private' | 'secret'

const GROUP_TYPES = [
  { type: 'open' as GroupType, emoji: '⚡', label: 'Open', desc: 'Anyone can join instantly. Auto-archived after 30 days with 1 member.' },
  { type: 'private' as GroupType, emoji: '🔒', label: 'Private', desc: 'Visible in Explore. Members need Admin approval to join.' },
  { type: 'secret' as GroupType, emoji: '🕵️', label: 'Secret', desc: 'Visible in Explore (member count only). Entry by invite code only.' },
]

function generateCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export default function CreateScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [groupType, setGroupType] = useState<GroupType>('open')
  const [locationName, setLocationName] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const [generatingName, setGeneratingName] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    getLocation()
  }, [])

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude })
      const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
      if (place) setLocationName([place.city, place.country].filter(Boolean).join(', '))
    } catch {}
  }

  const generateName = async () => {
    setGeneratingName(true)
    try {
      const context = locationName ? 'Location: ' + locationName + '. ' : ''
      const type = groupType === 'open' ? 'open social' : groupType === 'private' ? 'private' : 'secret'
      const result = await askClaude(
        context + 'Generate ONE creative, catchy group name for a ' + type + ' social group. Short (2-4 words max). Fun and modern. Just the name, nothing else.',
        undefined, 30
      )
      if (result) setName(result.trim().replace(/['"]/g, ''))
    } catch {}
    setGeneratingName(false)
  }

  const create = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Please enter a group name or generate one'); return }
    if (!userId) return
    setCreating(true)
    try {
      const inviteCode = groupType === 'secret' ? generateCode() : null
      const groupData: any = {
        name: name.trim(),
        description: description.trim() || null,
        status: 'open',
        is_private: groupType === 'private',
        is_secret: groupType === 'secret',
        invite_code: inviteCode,
        member_count: 0,
        created_by: userId,
        location_name: locationName || null,
        min_members: 1,
        archive_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      }
      if (coords) groupData.location = 'POINT(' + coords.lon + ' ' + coords.lat + ')'

      const { data: group, error } = await supabase.from('groups').insert(groupData).select().single()
      if (error || !group) throw error || new Error('Failed to create group')

      await supabase.from('group_members').insert({ group_id: group.id, user_id: userId, role: 'admin' })

      const go = () => router.replace({ pathname: '/group-settings', params: { id: group.id, name: group.name, new: '1' } })
      if (groupType === 'secret' && inviteCode) {
        Alert.alert(
          '🕵️ Secret Trybe Created!',
          'Invite Code: ' + inviteCode + '\n\nShare this code with people you want to invite.',
          [{ text: 'Got it', onPress: go }]
        )
      } else {
        go()
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create group')
    } finally { setCreating(false) }
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.title}>Create Trybe</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        <Text style={s.label}>TYPE</Text>
        {GROUP_TYPES.map(gt => (
          <TouchableOpacity key={gt.type} style={[s.typeCard, groupType === gt.type && s.typeCardActive]} onPress={() => setGroupType(gt.type)}>
            <View style={s.typeCardLeft}>
              <Text style={s.typeEmoji}>{gt.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.typeLabel, groupType === gt.type && { color: PRIMARY }]}>{gt.label}</Text>
                <Text style={s.typeDesc}>{gt.desc}</Text>
              </View>
            </View>
            <View style={[s.typeRadio, groupType === gt.type && s.typeRadioActive]}>
              {groupType === gt.type && <View style={s.typeRadioInner} />}
            </View>
          </TouchableOpacity>
        ))}

        <Text style={s.label}>NAME</Text>
        <View style={s.nameRow}>
          <TextInput style={[s.input, { flex: 1 }]} value={name} onChangeText={setName}
            placeholder="Group name..." placeholderTextColor={GRAY} maxLength={50} />
          <TouchableOpacity style={s.aiBtn} onPress={generateName} disabled={generatingName}>
            {generatingName
              ? <ActivityIndicator color={PRIMARY} size="small" />
              : <Text style={s.aiBtnText}>✦ AI</Text>}
          </TouchableOpacity>
        </View>

        <Text style={s.label}>DESCRIPTION</Text>
        <TextInput style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
          value={description} onChangeText={setDescription}
          placeholder="What's this Trybe about?" placeholderTextColor={GRAY} multiline maxLength={200} />

        {locationName ? (
          <View style={s.locationRow}>
            <Text style={{ fontSize: 18 }}>📍</Text>
            <Text style={s.locationText}>{locationName}</Text>
          </View>
        ) : null}

        {groupType === 'open' && <View style={s.infoCard}><Text style={s.infoText}>⚡ Opens immediately. Auto-archives after 30 days if no one joins.</Text></View>}
        {groupType === 'private' && <View style={s.infoCard}><Text style={s.infoText}>🔒 Visible in Explore with a lock icon. You approve join requests.</Text></View>}
        {groupType === 'secret' && <View style={[s.infoCard, { borderColor: PRIMARY }]}><Text style={s.infoText}>🕵️ A 6-digit invite code will be generated. Single-use per person.</Text></View>}

        <TouchableOpacity style={[s.createBtn, (!name.trim() || creating) && s.createBtnOff]} onPress={create} disabled={!name.trim() || creating}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={s.createBtnText}>
            {groupType === 'secret' ? '🕵️ Create Secret Trybe' : groupType === 'private' ? '🔒 Create Private Trybe' : '⚡ Create Trybe'}
          </Text>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 36, marginTop: -4 },
  title: { fontSize: 17, fontWeight: '700', color: TEXT },
  content: { padding: 20 },
  label: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8, marginTop: 20 },
  typeCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: BORDER },
  typeCardActive: { borderColor: PRIMARY, backgroundColor: '#F5F4FF' },
  typeCardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  typeEmoji: { fontSize: 24, marginTop: 2 },
  typeLabel: { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 2 },
  typeDesc: { fontSize: 12, color: GRAY, lineHeight: 16 },
  typeRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  typeRadioActive: { borderColor: PRIMARY },
  typeRadioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: PRIMARY },
  nameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: BORDER },
  aiBtn: { backgroundColor: '#EEF0FF', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: PRIMARY, minWidth: 60 },
  aiBtnText: { color: PRIMARY, fontWeight: '700', fontSize: 13 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: CARD, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER },
  locationText: { fontSize: 14, color: GRAY },
  infoCard: { backgroundColor: '#F5F4FF', borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: BORDER },
  infoText: { fontSize: 13, color: GRAY, lineHeight: 20 },
  createBtn: { backgroundColor: PRIMARY, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  createBtnOff: { opacity: 0.4 },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
