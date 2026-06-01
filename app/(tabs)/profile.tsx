import { useState, useEffect } from 'react'
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, StatusBar, Alert, ActivityIndicator, Image } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { pickImageAsset, uploadMedia } from '../../src/lib/upload'
import { toE164 } from '../../src/lib/contacts'
import { getTeebyFabVisible, setTeebyFabVisible } from '../../src/components/TeebyFAB'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../../src/constants'

const AVATARS = ['🦊','🐺','🦁','🐯','🐻','🦝','🐼','🦄','🐲','👾','🤖','👽','🎭','🔮','⚡','🌊','🔥','🌙','🎸','🎵']

export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [phone, setPhone] = useState('')
  const [ghostName, setGhostName] = useState('')
  const [avatarChar, setAvatarChar] = useState('🦊')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [myGroups, setMyGroups] = useState<any[]>([])
  const [stats, setStats] = useState({ groups: 0, posts: 0, messages: 0 })
  const [credits, setCredits] = useState(20)
  const [birthDate, setBirthDate] = useState('')           // YYYY-MM-DD
  const [gender, setGender] = useState<string>('')
  const [location, setLocation] = useState('')
  const [photos, setPhotos] = useState<{ id: string; url: string; position: number }[]>([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [fabOn, setFabOn] = useState(true)
  useEffect(() => { getTeebyFabVisible().then(setFabOn) }, [])
  const toggleFab = async (v: boolean) => { setFabOn(v); await setTeebyFabVisible(v) }

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (p) {
      setDisplayName(p.display_name || ''); setUsername(p.username || ''); setBio(p.bio || '')
      setPhone(p.phone || ''); setGhostName(p.ghost_name || ''); setAvatarChar(p.avatar_char || '🦊')
      setAvatarUrl(p.avatar_url || null); setCredits(p.teeby_credits ?? 20)
      setBirthDate(p.birth_date || ''); setGender(p.gender || ''); setLocation(p.location || '')
    }
    // Load public photos (separate from chat-media — visible to anyone viewing this profile).
    const { data: ph } = await supabase.from('profile_photos')
      .select('id, url, position').eq('user_id', user.id).order('position', { ascending: true })
    setPhotos((ph || []) as any)
    const { data: groups } = await supabase.from('group_members').select('group_id, groups(name, status)').eq('user_id', user.id).limit(10)
    if (groups) setMyGroups(groups)
    const { count: msgCount } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    const { count: postCount } = await supabase.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    setStats({ groups: groups?.length || 0, posts: postCount || 0, messages: msgCount || 0 })
  }

  const save = async () => {
    if (!userId) return
    setSaving(true)
    // Canonicalize phone to E.164 so two different typings of the same number
    // never produce two profile rows — the DB enforces uniqueness on this form.
    const phoneCanon = phone.trim() ? toE164(phone.trim()) : null
    if (phone.trim() && !phoneCanon) {
      setSaving(false)
      Alert.alert('Invalid phone', 'Please enter a valid phone number (e.g. 0501234567).')
      return
    }
    // Validate birth_date roughly: YYYY-MM-DD and 18+ (or empty).
    let bd: string | null = null
    if (birthDate.trim()) {
      const m = birthDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!m) { setSaving(false); Alert.alert('Invalid date', 'Use YYYY-MM-DD, e.g. 1995-08-14.'); return }
      const d = new Date(birthDate.trim())
      const yrs = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
      if (yrs < 13 || yrs > 110) { setSaving(false); Alert.alert('Invalid age', 'Please enter a realistic birth date.'); return }
      bd = birthDate.trim()
    }
    const { error } = await supabase.from('profiles').update({
      display_name: displayName.trim(),
      bio: bio.trim() || null,
      avatar_char: avatarChar,
      phone: phoneCanon,
      ghost_name: ghostName.trim() || null,
      birth_date: bd,
      gender: gender || null,
      location: location.trim() || null,
    }).eq('id', userId)
    setSaving(false)
    if (error) {
      // 23505 = unique_violation — someone else already owns this number.
      const msg = error.code === '23505'
        ? 'This phone number is already used by another Tryber account.'
        : error.message
      Alert.alert('Could not save', msg)
      return
    }
    Alert.alert('✓ Saved', 'Profile updated!')
  }

  const pickAvatar = async () => {
    if (!userId) return
    const asset = await pickImageAsset()
    if (!asset) return
    setUploading(true)
    const url = await uploadMedia(asset.uri, 'image', asset.ext)
    if (url) {
      setAvatarUrl(url)
      try { await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId) } catch {}
    } else { Alert.alert('Upload failed', 'Could not upload the photo.') }
    setUploading(false)
  }

  // Add a public profile photo (stored separately from the avatar).
  const addProfilePhoto = async () => {
    if (!userId) return
    if (photos.length >= 6) { Alert.alert('Max reached', 'Up to 6 public photos.'); return }
    const asset = await pickImageAsset()
    if (!asset) return
    setUploadingPhoto(true)
    const url = await uploadMedia(asset.uri, 'image', asset.ext)
    if (url) {
      const { data } = await supabase.from('profile_photos')
        .insert({ user_id: userId, url, position: photos.length })
        .select('id, url, position').single()
      if (data) setPhotos(prev => [...prev, data as any])
    } else { Alert.alert('Upload failed', 'Could not upload the photo.') }
    setUploadingPhoto(false)
  }

  const removeProfilePhoto = async (id: string) => {
    await supabase.from('profile_photos').delete().eq('id', id)
    setPhotos(prev => prev.filter(p => p.id !== id))
  }

  const signOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await supabase.auth.signOut() } }
    ])
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.title}>My Profile</Text>
        <TouchableOpacity onPress={signOut}><Text style={s.signOut}>Sign out</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.avatarSection}>
          <TouchableOpacity onPress={pickAvatar} disabled={uploading} style={s.avatarWrap}>
            {uploading ? <View style={s.avatarCircle}><ActivityIndicator color={PRIMARY} /></View>
              : avatarUrl ? <Image source={{ uri: avatarUrl }} style={s.avatarImage} />
              : <View style={s.avatarCircle}><Text style={s.avatarEmoji}>{avatarChar}</Text></View>}
            <View style={s.editBadge}><Text style={{ fontSize: 14 }}>✏️</Text></View>
          </TouchableOpacity>
          <Text style={s.displayNameLarge}>{displayName || username}</Text>
          <Text style={s.usernameSub}>@{username}</Text>
          <TouchableOpacity onPress={() => setShowAvatarPicker(!showAvatarPicker)}>
            <Text style={s.changeEmoji}>Change emoji avatar</Text>
          </TouchableOpacity>
          {showAvatarPicker && (
            <View style={s.emojiGrid}>
              {AVATARS.map(a => (
                <TouchableOpacity key={a} style={[s.emojiOpt, avatarChar === a && s.emojiOptSelected]} onPress={() => { setAvatarChar(a); setShowAvatarPicker(false) }}>
                  <Text style={{ fontSize: 24 }}>{a}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={s.statsRow}>
          {[['Groups', stats.groups], ['Posts', stats.posts], ['Messages', stats.messages], ['✦ Credits', credits]].map(([label, val], i) => (
            <View key={label} style={s.stat}>
              <Text style={[s.statNum, label === '✦ Credits' && { color: PRIMARY }]}>{val}</Text>
              <Text style={s.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionLabel}>DISPLAY NAME</Text>
        <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={GRAY} maxLength={30} />

        <Text style={s.sectionLabel}>USERNAME</Text>
        <TextInput style={[s.input, { color: GRAY }]} value={'@' + username} editable={false} />

        <Text style={s.sectionLabel}>PHONE</Text>
        <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="0501234567" placeholderTextColor={GRAY} keyboardType="phone-pad" maxLength={20} />

        <Text style={s.sectionLabel}>👻 ANONYMOUS NAME (GHOST MODE)</Text>
        <TextInput style={s.input} value={ghostName} onChangeText={setGhostName} placeholder="e.g. Mystery Fox — shown when you're in ghost mode" placeholderTextColor={GRAY} maxLength={30} />

        <Text style={s.sectionLabel}>BIRTH DATE (YYYY-MM-DD)</Text>
        <TextInput style={s.input} value={birthDate} onChangeText={setBirthDate} placeholder="1995-08-14" placeholderTextColor={GRAY} maxLength={10} autoCapitalize="none" />

        <Text style={s.sectionLabel}>GENDER</Text>
        <View style={s.genderRow}>
          {[
            { val: 'male', label: '👨 Male' },
            { val: 'female', label: '👩 Female' },
            { val: 'nonbinary', label: '🧑 Non-binary' },
            { val: 'other', label: '✨ Other' },
            { val: 'prefer_not', label: '· Skip' },
          ].map(g => (
            <TouchableOpacity key={g.val} style={[s.genderChip, gender === g.val && s.genderChipActive]} onPress={() => setGender(gender === g.val ? '' : g.val)}>
              <Text style={[s.genderChipText, gender === g.val && { color: '#fff' }]}>{g.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.sectionLabel}>LOCATION (CITY)</Text>
        <TextInput style={s.input} value={location} onChangeText={setLocation} placeholder="Tel Aviv, Israel" placeholderTextColor={GRAY} maxLength={60} />

        <Text style={s.sectionLabel}>PUBLIC PHOTOS ({photos.length}/6)</Text>
        <Text style={s.subLabel}>Shown on your profile — visible to anyone who views you.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
          {photos.map(p => (
            <View key={p.id} style={s.photoCell}>
              <Image source={{ uri: p.url }} style={s.photoCellImg} resizeMode="cover" />
              <TouchableOpacity style={s.photoCellRemove} onPress={() => removeProfilePhoto(p.id)}>
                <Text style={s.photoCellRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < 6 && (
            <TouchableOpacity style={[s.photoCell, s.photoCellAdd]} onPress={addProfilePhoto} disabled={uploadingPhoto}>
              {uploadingPhoto ? <ActivityIndicator color={PRIMARY} /> : <Text style={{ fontSize: 32, color: PRIMARY }}>＋</Text>}
            </TouchableOpacity>
          )}
        </ScrollView>

        <Text style={s.sectionLabel}>BIO</Text>
        <TextInput style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} value={bio} onChangeText={setBio} placeholder="Tell people about yourself..." placeholderTextColor={GRAY} multiline maxLength={150} />

        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Profile</Text>}
        </TouchableOpacity>

        {/* Tryber Zone entry — discreet, no badge or status hint here.
            Inside the Zone the user manages alias, photos, matches, PIN. */}
        <TouchableOpacity style={s.zoneBtn} onPress={() => router.push('/tryber-zone')}>
          <Text style={s.zoneBtnText}>✦ Tryber Zone</Text>
        </TouchableOpacity>

        {/* Show / hide the floating ✦ Ask Teeby button across the app. */}
        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>Floating Ask Teeby button</Text>
            <Text style={s.toggleSub}>The ✦ button on every tab — turn off if it gets in the way.</Text>
          </View>
          <TouchableOpacity
            style={[s.toggleBtn, fabOn && s.toggleBtnOn]}
            onPress={() => toggleFab(!fabOn)}
          >
            <View style={[s.toggleKnob, fabOn && s.toggleKnobOn]} />
          </TouchableOpacity>
        </View>

        <View style={s.creditsCard}>
          <Text style={s.creditsTitle}>✦ Teeby Credits</Text>
          <Text style={s.creditsDesc}>{credits}/20 daily credits remaining</Text>
          <View style={s.creditsBar}><View style={[s.creditsFill, { width: ((credits / 20) * 100) + '%' as any }]} /></View>
          <Text style={s.creditsReset}>Resets every day at midnight</Text>
        </View>

        {myGroups.length > 0 && (
          <>
            <Text style={s.sectionLabel}>MY TRYBES ({myGroups.length})</Text>
            {myGroups.map((m: any) => (
              <TouchableOpacity key={m.group_id} style={s.groupRow} onPress={() => router.push({ pathname: '/chat', params: { id: m.group_id, name: m.groups?.name } })}>
                <View style={[s.groupDot, { backgroundColor: m.groups?.status === 'open' ? LIVE : PRIMARY }]} />
                <Text style={s.groupName} numberOfLines={1}>{m.groups?.name || 'Trybe'}</Text>
                <Text style={s.groupArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  title: { fontSize: 22, fontWeight: '800', color: TEXT },
  signOut: { fontSize: 14, color: '#FF3B30', fontWeight: '600' },
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatarCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: PRIMARY },
  avatarImage: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: PRIMARY },
  avatarEmoji: { fontSize: 48 },
  editBadge: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  displayNameLarge: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 4 },
  usernameSub: { fontSize: 14, color: GRAY, marginBottom: 8 },
  changeEmoji: { fontSize: 13, color: PRIMARY, fontWeight: '500' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' },
  emojiOpt: { width: 44, height: 44, borderRadius: 22, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  emojiOptSelected: { backgroundColor: '#EEF0FF', borderWidth: 2, borderColor: PRIMARY },
  statsRow: { flexDirection: 'row', backgroundColor: CARD, borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 0.5, borderColor: BORDER },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '800', color: TEXT },
  statLabel: { fontSize: 11, color: GRAY, marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: BORDER },
  saveBtn: { backgroundColor: LIVE, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: TEXT },
  toggleSub: { fontSize: 11, color: GRAY, marginTop: 2 },
  toggleBtn: { width: 44, height: 26, borderRadius: 13, backgroundColor: '#D9D7E8', justifyContent: 'center', paddingHorizontal: 3 },
  toggleBtnOn: { backgroundColor: PRIMARY },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: 'flex-start' },
  toggleKnobOn: { alignSelf: 'flex-end' },
  subLabel: { fontSize: 11, color: GRAY, marginBottom: 6, marginTop: -2 },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  genderChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  genderChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  genderChipText: { fontSize: 13, color: TEXT, fontWeight: '500' },
  photoCell: { width: 110, height: 110, borderRadius: 12, overflow: 'hidden', position: 'relative', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  photoCellImg: { width: '100%', height: '100%' },
  photoCellAdd: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' as any },
  photoCellRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  photoCellRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  zoneBtn: { backgroundColor: CARD, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: BORDER },
  zoneBtnText: { color: PRIMARY, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  creditsCard: { backgroundColor: '#EEF0FF', borderRadius: 16, padding: 16, marginTop: 20 },
  creditsTitle: { fontSize: 16, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  creditsDesc: { fontSize: 13, color: TEXT, marginBottom: 10 },
  creditsBar: { height: 6, backgroundColor: '#D0CFFF', borderRadius: 3, marginBottom: 6 },
  creditsFill: { height: 6, backgroundColor: PRIMARY, borderRadius: 3 },
  creditsReset: { fontSize: 11, color: GRAY },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: BORDER },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupName: { flex: 1, fontSize: 14, fontWeight: '500', color: TEXT },
  groupArrow: { fontSize: 18, color: GRAY },
})
