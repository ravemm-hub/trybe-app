import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, ScrollView, TextInput, Alert, ActivityIndicator, Image,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const PRIMARY = '#6C63FF'
const TEAL = '#00BFA6'
const BG = '#F8F9FD'
const CARD = '#FFFFFF'
const TEXT = '#1A1A2E'
const GRAY = '#8A8A9A'

const AVATARS = ['🦊','🐺','🦁','🐯','🐻','🦝','🐼','🦄','🐲','👾','🤖','👽','🎭','🔮','⚡️','🌊','🔥','🌙','🎸','🎵']

export default function ProfileScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarChar, setAvatarChar] = useState('🦊')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [myGroups, setMyGroups] = useState<any[]>([])
  const [myPosts, setMyPosts] = useState<any[]>([])
  const [stats, setStats] = useState({ groups: 0, posts: 0, messages: 0 })
  const [credits, setCredits] = useState(20)

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (profile) {
      setDisplayName(profile.display_name || '')
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setPhone(profile.phone || '')
      setAvatarChar(profile.avatar_char || '🦊')
      setAvatarUrl(profile.avatar_url || null)
      setCredits(profile.teeby_credits ?? 20)
    }
    const { data: groups } = await supabase.from('group_members').select('group_id, groups(name, status)').eq('user_id', user.id).limit(10)
    if (groups) setMyGroups(groups)
    const { data: posts } = await supabase.from('posts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(6)
    if (posts) setMyPosts(posts)
    const { count: msgCount } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    setStats({ groups: groups?.length || 0, posts: posts?.length || 0, messages: msgCount || 0 })
  }

  const saveProfile = async () => {
    if (!userId) return
    setSaving(true)
    await supabase.from('profiles').update({ display_name: displayName.trim(), bio: bio.trim() || null, avatar_char: avatarChar, phone: phone.trim() || null }).eq('id', userId)
    setSaving(false)
    Alert.alert('✓ Saved', 'Profile updated!')
  }

  const pickAvatar = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) return
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 })
    if (result.canceled || !result.assets?.[0] || !userId) return
    setUploading(true)
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `avatar_${userId}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)
      await supabase.storage.from('chat-media').upload(`avatars/${filename}`, formData, { upsert: true })
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(`avatars/${filename}`)
      setAvatarUrl(publicUrl)
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId)
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setUploading(false) }
  }

  const signOut = async () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await supabase.auth.signOut() } }
    ])
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleDateString('en', { day: 'numeric', month: 'short' })

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={CARD} />
      <View style={s.header}>
        <Text style={s.title}>My Profile</Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={s.signOutBtn}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={s.avatarSection}>
          <TouchableOpacity onPress={pickAvatar} disabled={uploading} style={s.avatarWrap}>
            {uploading ? (
              <View style={s.avatarCircle}><ActivityIndicator color={PRIMARY} /></View>
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImage} />
            ) : (
              <View style={s.avatarCircle}>
                <Text style={s.avatarEmoji}>{avatarChar}</Text>
              </View>
            )}
            <View style={s.avatarEditBadge}><Text style={s.avatarEditText}>✏️</Text></View>
          </TouchableOpacity>
          <Text style={s.displayNameLarge}>{displayName || username}</Text>
          <Text style={s.usernameSub}>@{username}</Text>
          <TouchableOpacity style={s.emojiPickerBtn} onPress={() => setShowAvatarPicker(!showAvatarPicker)}>
            <Text style={s.emojiPickerText}>Change emoji avatar</Text>
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

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statNum}>{stats.groups}</Text>
            <Text style={s.statLabel}>Trybes</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNum}>{stats.posts}</Text>
            <Text style={s.statLabel}>Posts</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNum}>{stats.messages}</Text>
            <Text style={s.statLabel}>Messages</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={[s.statNum, { color: PRIMARY }]}>{credits}</Text>
            <Text style={s.statLabel}>✦ Credits</Text>
          </View>
        </View>

        {/* Edit */}
        <Text style={s.sectionLabel}>DISPLAY NAME</Text>
        <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor="#B4B2A9" maxLength={30} />

        <Text style={s.sectionLabel}>USERNAME</Text>
        <TextInput style={[s.input, { color: GRAY }]} value={`@${username}`} editable={false} />

        <Text style={s.sectionLabel}>PHONE</Text>
        <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="+972..." placeholderTextColor="#B4B2A9" keyboardType="phone-pad" maxLength={20} />

        <Text style={s.sectionLabel}>BIO</Text>
        <TextInput style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} value={bio} onChangeText={setBio} placeholder="Tell people about yourself..." placeholderTextColor="#B4B2A9" multiline maxLength={150} />

        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={saveProfile} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Profile</Text>}
        </TouchableOpacity>

        {/* Teeby Credits */}
        <View style={s.creditsCard}>
          <Text style={s.creditsTitle}>✦ Teeby Credits</Text>
          <Text style={s.creditsDesc}>{credits}/20 daily credits remaining</Text>
          <View style={s.creditsBar}>
            <View style={[s.creditsFill, { width: `${(credits/20)*100}%` as any }]} />
          </View>
          <Text style={s.creditsReset}>Resets every day at midnight</Text>
        </View>

        {/* My Trybes */}
        {myGroups.length > 0 && (
          <>
            <Text style={s.sectionLabel}>MY TRYBES ({myGroups.length})</Text>
            {myGroups.map((m: any) => (
              <TouchableOpacity key={m.group_id} style={s.groupRow} onPress={() => {
                if (m.groups?.status === 'open') router.push({ pathname: '/chat', params: { id: m.group_id, name: m.groups?.name, members: '0' } })
                else router.push({ pathname: '/lobby', params: { id: m.group_id, name: m.groups?.name } })
              }}>
                <View style={[s.groupDot, { backgroundColor: m.groups?.status === 'open' ? TEAL : PRIMARY }]} />
                <Text style={s.groupName} numberOfLines={1}>{m.groups?.name || 'Trybe'}</Text>
                <Text style={s.groupArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* My Posts */}
        {myPosts.length > 0 && (
          <>
            <Text style={s.sectionLabel}>MY POSTS ({myPosts.length})</Text>
            <View style={s.postsGrid}>
              {myPosts.map((p: any) => (
                <View key={p.id} style={s.postCard}>
                  {p.media_url
                    ? <Image source={{ uri: p.media_url }} style={s.postImage} resizeMode="cover" />
                    : <View style={s.postTextCard}><Text style={s.postText} numberOfLines={3}>{p.content}</Text></View>
                  }
                  <Text style={s.postMeta}>{formatTime(p.created_at)} · ❤️ {p.likes}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: '#EBEBEB' },
  title: { fontSize: 22, fontWeight: '800', color: TEXT },
  signOutBtn: { fontSize: 14, color: '#FF3B30', fontWeight: '600' },
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatarCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: PRIMARY },
  avatarImage: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: PRIMARY },
  avatarEmoji: { fontSize: 48 },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EBEBEB' },
  avatarEditText: { fontSize: 14 },
  displayNameLarge: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 4 },
  usernameSub: { fontSize: 14, color: GRAY, marginBottom: 8 },
  emojiPickerBtn: { marginTop: 4 },
  emojiPickerText: { fontSize: 13, color: PRIMARY, fontWeight: '500' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' },
  emojiOpt: { width: 44, height: 44, borderRadius: 22, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  emojiOptSelected: { backgroundColor: '#EEF0FF', borderWidth: 2, borderColor: PRIMARY },
  statsRow: { flexDirection: 'row', backgroundColor: CARD, borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 0.5, borderColor: '#EBEBEB' },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '800', color: TEXT },
  statLabel: { fontSize: 11, color: GRAY, marginTop: 2 },
  statDivider: { width: 0.5, backgroundColor: '#EBEBEB' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: '#EBEBEB' },
  saveBtn: { backgroundColor: TEAL, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  creditsCard: { backgroundColor: '#EEF0FF', borderRadius: 16, padding: 16, marginTop: 20 },
  creditsTitle: { fontSize: 16, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  creditsDesc: { fontSize: 13, color: TEXT, marginBottom: 10 },
  creditsBar: { height: 6, backgroundColor: '#D0CFFF', borderRadius: 3, marginBottom: 6 },
  creditsFill: { height: 6, backgroundColor: PRIMARY, borderRadius: 3 },
  creditsReset: { fontSize: 11, color: GRAY },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: '#EBEBEB' },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupName: { flex: 1, fontSize: 14, fontWeight: '500', color: TEXT },
  groupArrow: { fontSize: 18, color: GRAY },
  postsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  postCard: { width: '47%' },
  postImage: { width: '100%', height: 120, borderRadius: 12 },
  postTextCard: { width: '100%', height: 120, borderRadius: 12, backgroundColor: CARD, padding: 10, borderWidth: 0.5, borderColor: '#EBEBEB', justifyContent: 'center' },
  postText: { fontSize: 12, color: TEXT, lineHeight: 18 },
  postMeta: { fontSize: 10, color: GRAY, marginTop: 4, marginLeft: 2 },
})
