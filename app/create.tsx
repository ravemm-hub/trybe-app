import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import DateTimePicker from '@react-native-community/datetimepicker'
import { supabase } from '../lib/supabase'

const MIN_OPTIONS = [5, 10, 20, 50]
const RADIUS_OPTIONS = [
  { label: '100m', value: 100 },
  { label: '300m', value: 300 },
  { label: '500m', value: 500 },
  { label: '1km', value: 1000 },
]

export default function CreateScreen() {
  const router = useRouter()
  const [groupType, setGroupType] = useState<'live' | 'event'>('live')
  const [name, setName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [description, setDescription] = useState('')
  const [minMembers, setMinMembers] = useState(20)
  const [radius, setRadius] = useState(300)
  const [isPrivate, setIsPrivate] = useState(false)
  const [eventDate, setEventDate] = useState<Date>(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [loading, setLoading] = useState(false)
  const [locLoading, setLocLoading] = useState(true)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)

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
        radius_meters: radius,
        min_members: groupType === 'event' ? 0 : minMembers,
        member_count: 1,
        status: groupType === 'event' ? 'open' : 'lobby',
        type: 'manual',
        group_type: groupType,
        is_private: isPrivate,
        event_date: groupType === 'event' ? eventDate.toISOString() : null,
        event_description: groupType === 'event' ? description.trim() || null : null,
        created_by: user.id,
      }).select().single()

      if (error) throw error

      await supabase.from('group_members').insert({ group_id: data.id, user_id: user.id, role: 'admin' })
      await supabase.from('group_agents').insert({ group_id: data.id, enabled: true })

      const systemMsg = groupType === 'event'
        ? `"${data.name}" event created 🎉 on ${eventDate.toLocaleDateString('he-IL')} — invite your people!`
        : `"${data.name}" trybe created${isPrivate ? ' 🔒' : ' 🌐'} — waiting for ${minMembers} people`

      await supabase.from('messages').insert({ group_id: data.id, type: 'system', content: systemMsg })

      if (groupType === 'event') {
        router.replace({ pathname: '/chat', params: { id: data.id, name: data.name, members: '1' } })
      } else {
        router.replace({ pathname: '/lobby', params: { id: data.id, name: data.name } })
      }
    } catch (err: any) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.title}>Drop a Trybe</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Type selector */}
          <Text style={s.label}>TYPE</Text>
          <View style={s.typeRow}>
            <TouchableOpacity
              style={[s.typeBtn, groupType === 'live' && s.typeBtnActive]}
              onPress={() => setGroupType('live')}
            >
              <Text style={s.typeEmoji}>⚡️</Text>
              <Text style={[s.typeBtnText, groupType === 'live' && s.typeBtnTextActive]}>Live Trybe</Text>
              <Text style={s.typeBtnSub}>Right now, nearby</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.typeBtn, groupType === 'event' && s.typeBtnActiveEvent]}
              onPress={() => setGroupType('event')}
            >
              <Text style={s.typeEmoji}>📅</Text>
              <Text style={[s.typeBtnText, groupType === 'event' && s.typeBtnTextActive]}>Event Trybe</Text>
              <Text style={s.typeBtnSub}>Future date</Text>
            </TouchableOpacity>
          </View>

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

          {groupType === 'event' && (
            <>
              <Text style={s.label}>EVENT DATE & TIME</Text>
              <TouchableOpacity style={s.dateBtn} onPress={() => setShowDatePicker(true)}>
                <Text style={s.dateBtnText}>📅 {eventDate.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at {eventDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</Text>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={eventDate}
                  mode="datetime"
                  display="default"
                  minimumDate={new Date()}
                  onChange={(e, date) => { setShowDatePicker(false); if (date) setEventDate(date) }}
                />
              )}

              <Text style={s.label}>DESCRIPTION</Text>
              <TextInput
                style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
                value={description}
                onChangeText={setDescription}
                placeholder="Tell people what this event is about..."
                placeholderTextColor="#B4B2A9"
                multiline
                maxLength={300}
              />
            </>
          )}

          <Text style={s.label}>PRIVACY</Text>
          <View style={s.privacyRow}>
            <TouchableOpacity style={[s.privacyBtn, !isPrivate && s.privacyBtnActive]} onPress={() => setIsPrivate(false)}>
              <Text style={s.privacyEmoji}>🌐</Text>
              <Text style={[s.privacyBtnText, !isPrivate && s.privacyBtnTextActive]}>Public</Text>
              <Text style={s.privacyDesc}>Anyone can join</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.privacyBtn, isPrivate && s.privacyBtnActivePrivate]} onPress={() => setIsPrivate(true)}>
              <Text style={s.privacyEmoji}>🔒</Text>
              <Text style={[s.privacyBtnText, isPrivate && s.privacyBtnTextActive]}>Private</Text>
              <Text style={s.privacyDesc}>Admin approves</Text>
            </TouchableOpacity>
          </View>

          {groupType === 'live' && (
            <>
              <Text style={s.label}>SIGNAL RADIUS</Text>
              <View style={s.optionRow}>
                {RADIUS_OPTIONS.map(r => (
                  <TouchableOpacity key={r.value} style={[s.option, radius === r.value && s.optionSelected]} onPress={() => setRadius(r.value)}>
                    <Text style={[s.optionText, radius === r.value && s.optionTextSelected]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.label}>MIN CREW SIZE</Text>
              <View style={s.optionRow}>
                {MIN_OPTIONS.map(n => (
                  <TouchableOpacity key={n} style={[s.option, minMembers === n && s.optionSelected]} onPress={() => setMinMembers(n)}>
                    <Text style={[s.optionText, minMembers === n && s.optionTextSelected]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <TouchableOpacity
            style={[s.submitBtn, (loading || locLoading) && s.submitBtnDisabled]}
            onPress={handleCreate}
            disabled={loading || locLoading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.submitBtnText}>{groupType === 'event' ? '📅 Create Event Trybe' : '⚡ Drop the Trybe'}</Text>
            }
          </TouchableOpacity>

          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

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
  typeRow: { flexDirection: 'row', gap: 10 },
  typeBtn: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: '#F1EFE8', alignItems: 'center', gap: 4 },
  typeBtnActive: { backgroundColor: '#E1F5EE', borderWidth: 2, borderColor: GREEN },
  typeBtnActiveEvent: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  typeEmoji: { fontSize: 24 },
  typeBtnText: { fontSize: 14, fontWeight: '700', color: '#2C2C2A' },
  typeBtnTextActive: { color: '#2C2C2A' },
  typeBtnSub: { fontSize: 11, color: GRAY },
  dateBtn: { backgroundColor: '#F1EFE8', borderRadius: 14, padding: 14 },
  dateBtnText: { fontSize: 14, color: '#2C2C2A' },
  privacyRow: { flexDirection: 'row', gap: 10 },
  privacyBtn: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: '#F1EFE8', alignItems: 'center', gap: 4 },
  privacyBtnActive: { backgroundColor: '#E1F5EE', borderWidth: 2, borderColor: GREEN },
  privacyBtnActivePrivate: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  privacyEmoji: { fontSize: 24 },
  privacyBtnText: { fontSize: 14, fontWeight: '700', color: '#2C2C2A' },
  privacyBtnTextActive: { color: '#2C2C2A' },
  privacyDesc: { fontSize: 11, color: GRAY },
  optionRow: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#F1EFE8', alignItems: 'center' },
  optionSelected: { backgroundColor: PURPLE },
  optionText: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  optionTextSelected: { color: '#fff' },
  submitBtn: { backgroundColor: GREEN, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
})
