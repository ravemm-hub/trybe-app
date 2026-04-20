import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  StatusBar, ScrollView, TextInput, Alert, ActivityIndicator, Image,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const AVATARS = ['🦊','🐺','🦁','🐯','🐻','🦝','🐼','🦄','🐲','👾','🤖','👽','🎭','🔮','⚡️','🌊','🔥','🌙','🎸','🎵']

export default function ProfileScreen() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [avatarChar, setAvatarChar] = useState('🦊')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [myGroups, setMyGroups] = useState<any[]>([])
  const [myPosts, setMyPosts] = useState<any[]>([])
  const [stats, setStats] = useState({ groups: 0, posts: 0, messages: 0 })

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
      setAvatarChar(profile.avatar_char || '🦊')
      setAvatarUrl(profile.avatar_url || null)
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
    await supabase.from('profiles').update({
      display_name: displayName.trim(),
      bio: bio.trim() || null,
      avatar_char: avatarChar,
    }).eq('id', userId)
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
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        await supabase.auth.signOut()
      }}
    ])
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.title}>My Profile</Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={s.signOutBtn}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Avatar */}
        <View style={s.avatarSection}>
          <TouchableOpacity onPress={pickAvatar} disabled={uploading}>
            {uploading ? (
              <View style={s.avatarCircle}><ActivityIndicator color={GREEN} /></View>
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImage} />
            ) : (
              <View style={s.avatarCircle}>
                <Text style={s.avatarEmoji}>{avatarChar}</Text>
              </View>
            )}
            <View style={s.avatarEditBadge}><Text style={s.avatarEditText}>✏️</Text></View>
          </TouchableOpacity>

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
        </View>

        {/* Edit profile */}
        <Text style={s.sectionLabel}>DISPLAY NAME</Text>
        <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor="#B4B2A9" maxLength={30} />

        <Text style={s.sectionLabel}>USERNAME</Text>
        <TextInput style={[s.input, { color: '#888' }]} value={`@${username}`} editable={false} />

        <Text style={s.sectionLabel}>BIO</Text>
        <TextInput
          style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
          value={bio}
          onChangeText={setBio}
          placeholder="Tell people about yourself..."
          placeholderTextColor="#B4B2A9"
          multiline
          maxLength={150}
        />

        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={saveProfile} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Save Profile</Text>}
        </TouchableOpacity>

        {/* My Trybes */}
        {myGroups.length > 0 && (
          <>
            <Text style={s.sectionLabel}>MY TRYBES ({myGroups.length})</Text>
            {myGroups.map((m: any) => (
              <TouchableOpacity key={m.group_id} style={s.groupRow} onPress={() => {
                if (m.groups?.status === 'open') router.push({ pathname: '/chat', params: { id: m.group_id, name: m.groups?.name, members: '0' } })
                else router.push({ pathname: '/lobby', params: { id: m.group_id, name: m.groups?.name } })
              }}>
                <View style={[s.groupDot, m.groups?.status === 'open' ? s.dotOpen : s.dotLobby]} />
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
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  title: { fontSize: 20, fontWeight: '700', color: '#2C2C2A' },
  signOutBtn: { fontSize: 14, color: '#E24B4A', fontWeight: '500' },
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatarCircle: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: PURPLE },
  avatarImage: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: PURPLE },
  avatarEmoji: { fontSize: 44 },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E0DED8' },
  avatarEditText: { fontSize: 14 },
  emojiPickerBtn: { marginTop: 10 },
  emojiPickerText: { fontSize: 13, color: PURPLE, fontWeight: '500' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' },
  emojiOpt: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  emojiOptSelected: { backgroundColor: '#EEEDFE', borderWidth: 2, borderColor: PURPLE },
  statsRow: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 0.5, borderColor: '#E0DED8' },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 24, fontWeight: '800', color: '#2C2C2A' },
  statLabel: { fontSize: 11, color: GRAY, marginTop: 2 },
  statDivider: { width: 0.5, backgroundColor: '#E0DED8' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#2C2C2A' },
  saveBtn: { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: '#E0DED8' },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  dotOpen: { backgroundColor: GREEN },
  dotLobby: { backgroundColor: PURPLE },
  groupName: { flex: 1, fontSize: 14, fontWeight: '500', color: '#2C2C2A' },
  groupArrow: { fontSize: 18, color: GRAY },
  postsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  postCard: { width: '47%' },
  postImage: { width: '100%', height: 120, borderRadius: 12 },
  postTextCard: { width: '100%', height: 120, borderRadius: 12, backgroundColor: '#fff', padding: 10, borderWidth: 0.5, borderColor: '#E0DED8', justifyContent: 'center' },
  postText: { fontSize: 12, color: '#2C2C2A', lineHeight: 18 },
  postMeta: { fontSize: 10, color: GRAY, marginTop: 4, marginLeft: 2 },
})
