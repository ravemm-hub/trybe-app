import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  TextInput, Alert, ActivityIndicator, Share, ScrollView,
} from 'react-native'
import { supabase } from '../../lib/supabase'

const AVATARS = ['🦊','🐺','🦁','🐯','🐻','🦝','🐼','🦄','🐲','👾','🤖','👽','🎭','🔮','⚡️','🌊','🔥','🌙']

export default function ProfileScreen() {
  const [profile, setProfile] = useState<any>(null)
  const [displayName, setDisplayName] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState('🦊')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => { loadProfile() }, [])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (data) {
      setProfile(data)
      setDisplayName(data.display_name || data.username || '')
      setSelectedAvatar(data.avatar_char || '🦊')
    }
    setLoading(false)
  }

  const saveProfile = async () => {
    if (!profile) return
    setSaving(true)
    await supabase.from('profiles').update({
      display_name: displayName,
      avatar_char: selectedAvatar,
    }).eq('id', profile.id)
    setSaving(false)
    setEditing(false)
    Alert.alert('Saved! ✓')
  }

  const inviteFriends = async () => {
    await Share.share({
      message: `Hey! Join me on Trybe — the app that creates live group chats wherever you are 🐦\n\nDownload: https://trybe.app`,
      title: 'Join me on Trybe',
    })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.header}>
          <Text style={s.headerTitle}>My Profile</Text>
          <TouchableOpacity onPress={() => setEditing(!editing)}>
            <Text style={s.editBtn}>{editing ? 'Cancel' : 'Edit'}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.avatarSection}>
          <View style={s.bigAvatar}>
            <Text style={s.bigAvatarText}>{selectedAvatar}</Text>
          </View>
          <Text style={s.username}>@{profile?.username}</Text>
        </View>

        {editing && (
          <View style={s.avatarGrid}>
            <Text style={s.sectionLabel}>GHOST AVATAR</Text>
            <View style={s.avatarRow}>
              {AVATARS.map(a => (
                <TouchableOpacity
                  key={a}
                  style={[s.avatarOption, selectedAvatar === a && s.avatarOptionSelected]}
                  onPress={() => setSelectedAvatar(a)}
                >
                  <Text style={s.avatarEmoji}>{a}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionLabel}>DISPLAY NAME</Text>
          {editing ? (
            <TextInput
              style={s.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#B4B2A9"
            />
          ) : (
            <Text style={s.fieldValue}>{displayName || '—'}</Text>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>IDENTITY MODES</Text>
          <View style={s.infoCard}>
            <Text style={s.infoRow}>🔥 <Text style={s.bold}>Lit</Text> — your real name & photo</Text>
            <Text style={s.infoRow}>👻 <Text style={s.bold}>Ghost</Text> — anonymous with your avatar</Text>
            <Text style={s.infoSub}>Switch modes when joining any trybe or chat</Text>
          </View>
        </View>

        {editing && (
          <TouchableOpacity style={s.saveBtn} onPress={saveProfile} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save changes</Text>}
          </TouchableOpacity>
        )}

        <TouchableOpacity style={s.inviteBtn} onPress={inviteFriends}>
          <Text style={s.inviteBtnText}>🐦  Invite friends to Trybe</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.signOutBtn} onPress={signOut}>
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  editBtn: { fontSize: 15, color: GREEN, fontWeight: '600' },
  avatarSection: { alignItems: 'center', marginBottom: 28 },
  bigAvatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  bigAvatarText: { fontSize: 48 },
  username: { fontSize: 15, color: GRAY, fontWeight: '500' },
  avatarGrid: { marginBottom: 20 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  avatarOption: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  avatarOptionSelected: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  avatarEmoji: { fontSize: 24 },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8 },
  input: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#2C2C2A' },
  fieldValue: { fontSize: 16, color: '#2C2C2A', paddingVertical: 4 },
  infoCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: '#E0DED8', gap: 6 },
  infoRow: { fontSize: 14, color: '#2C2C2A', lineHeight: 22 },
  infoSub: { fontSize: 12, color: GRAY, marginTop: 4 },
  bold: { fontWeight: '700' },
  saveBtn: { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  inviteBtn: { backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  inviteBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  signOutBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  signOutText: { fontSize: 15, color: GRAY },
})
