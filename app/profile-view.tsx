import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, Image, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { followUser, unfollowUser, isFollowing, getProfileCounts, SocialCounts } from '../src/services/social'
import { getContactNameMap } from '../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, AGENT_IDS } from '../src/constants'

export default function ProfileViewScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<any>()
  const targetId = params?.userId || ''
  const [myId, setMyId] = useState<string | null>(null)
  const [profile, setProfile] = useState<any | null>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [counts, setCounts] = useState<SocialCounts>({ followers: 0, following: 0, posts_count: 0 })
  const [following, setFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [followBusy, setFollowBusy] = useState(false)
  const [contactName, setContactName] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!targetId) { router.back(); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMyId(user.id)
    const cmap = await getContactNameMap()
    setContactName(cmap[targetId] || null)
    const [{ data: p }, c, fol, { data: ps }] = await Promise.all([
      supabase.from('profiles').select('id, display_name, username, avatar_char, bio, ghost_name').eq('id', targetId).single(),
      getProfileCounts(targetId),
      isFollowing(user.id, targetId),
      supabase.from('posts').select('id, content, media_url, created_at, likes, dislikes, comment_count, is_anonymous')
        .eq('user_id', targetId).is('group_id', null)
        .order('created_at', { ascending: false }).limit(30),
    ])
    setProfile(p); setCounts(c); setFollowing(fol); setPosts(ps || [])
    setLoading(false)
  }, [targetId, router])

  useEffect(() => { load() }, [load])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const toggleFollow = async () => {
    if (!myId || !targetId || followBusy) return
    setFollowBusy(true)
    if (following) {
      // Optimistic — drop count first so UI feels instant.
      setFollowing(false); setCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) }))
      const { error } = await unfollowUser(myId, targetId)
      if (error) { setFollowing(true); setCounts(c => ({ ...c, followers: c.followers + 1 })); Alert.alert('Error', error.message) }
    } else {
      setFollowing(true); setCounts(c => ({ ...c, followers: c.followers + 1 }))
      const { error } = await followUser(myId, targetId)
      if (error) { setFollowing(false); setCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) })); Alert.alert('Error', error.message) }
    }
    setFollowBusy(false)
  }

  const openDM = () => {
    if (!profile) return
    router.push({ pathname: '/dm', params: { userId: profile.id, userName: displayName, myMode: 'lit', theirMode: 'lit', myAvatar: '💬', isAgent: '0' } })
  }

  if (loading) return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>
  if (!profile) return null

  const displayName = contactName || profile.display_name || profile.username || 'User'
  const isAgent = AGENT_IDS.includes(targetId)
  const isMe = myId === targetId

  const fmt = (ts: string) => {
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 32 }} />
      </View>

      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        ListHeaderComponent={(
          <View style={s.profileCard}>
            <View style={[s.avatar, isAgent && s.avatarAgent]}><Text style={s.avatarText}>{profile.avatar_char || displayName[0] || '?'}</Text></View>
            <Text style={s.name}>{displayName}{isAgent ? ' ✦' : ''}</Text>
            {profile.username ? <Text style={s.username}>@{profile.username}</Text> : null}
            {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}

            <View style={s.statsRow}>
              <View style={s.statBox}>
                <Text style={s.statN}>{counts.posts_count}</Text>
                <Text style={s.statL}>Posts</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statN}>{counts.followers}</Text>
                <Text style={s.statL}>Followers</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statN}>{counts.following}</Text>
                <Text style={s.statL}>Following</Text>
              </View>
            </View>

            {!isMe && !isAgent && (
              <View style={s.actionRow}>
                <TouchableOpacity style={[s.followBtn, following && s.followingBtn]} onPress={toggleFollow} disabled={followBusy}>
                  {followBusy ? <ActivityIndicator color={following ? PRIMARY : '#fff'} size="small" />
                    : <Text style={[s.followBtnText, following && s.followingBtnText]}>{following ? '✓ Following' : '+ Follow'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.dmBtn} onPress={openDM}><Text style={s.dmBtnText}>💬 Message</Text></TouchableOpacity>
              </View>
            )}
            {isMe && (
              <TouchableOpacity style={s.editBtn} onPress={() => router.push('/(tabs)/profile')}>
                <Text style={s.editBtnText}>Edit your profile</Text>
              </TouchableOpacity>
            )}
            <Text style={s.sectionHeader}>POSTS</Text>
          </View>
        )}
        ListEmptyComponent={<View style={s.emptyPosts}><Text style={s.emptySub}>No posts yet</Text></View>}
        renderItem={({ item: p }) => (
          <View style={s.postRow}>
            {p.content ? <Text style={s.postText}>{p.content}</Text> : null}
            {p.media_url ? <Image source={{ uri: p.media_url }} style={s.postImg} resizeMode="cover" /> : null}
            <View style={s.postMeta}>
              <Text style={s.postMetaText}>👍 {p.likes || 0}</Text>
              <Text style={s.postMetaText}>💬 {p.comment_count || 0}</Text>
              <Text style={s.postTime}>{fmt(p.created_at)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4, width: 36 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 32, marginTop: -4 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: TEXT },
  profileCard: { backgroundColor: CARD, paddingHorizontal: 20, paddingVertical: 20, alignItems: 'center', borderBottomWidth: 0.5, borderColor: BORDER },
  avatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: BORDER, marginBottom: 12 },
  avatarAgent: { borderColor: PRIMARY, borderWidth: 3 },
  avatarText: { fontSize: 40 },
  name: { fontSize: 22, fontWeight: '800', color: TEXT },
  username: { fontSize: 14, color: GRAY, marginTop: 2 },
  bio: { fontSize: 14, color: TEXT, marginTop: 10, textAlign: 'center', lineHeight: 19 },
  statsRow: { flexDirection: 'row', gap: 24, marginTop: 18, marginBottom: 12 },
  statBox: { alignItems: 'center' },
  statN: { fontSize: 18, fontWeight: '800', color: TEXT },
  statL: { fontSize: 12, color: GRAY, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 6, width: '100%' },
  followBtn: { flex: 1, backgroundColor: PRIMARY, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  followBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  followingBtn: { backgroundColor: '#EEF0FF', borderWidth: 1, borderColor: PRIMARY },
  followingBtnText: { color: PRIMARY },
  dmBtn: { flex: 1, backgroundColor: BG, paddingVertical: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  dmBtnText: { color: TEXT, fontSize: 15, fontWeight: '600' },
  editBtn: { backgroundColor: BG, paddingVertical: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: BORDER, marginTop: 6, width: '100%' },
  editBtnText: { color: TEXT, fontSize: 14, fontWeight: '600' },
  sectionHeader: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginTop: 18, marginBottom: -8 },
  emptyPosts: { padding: 32, alignItems: 'center' },
  emptySub: { fontSize: 14, color: GRAY },
  postRow: { backgroundColor: CARD, padding: 14, borderBottomWidth: 0.5, borderColor: BORDER },
  postText: { fontSize: 15, color: TEXT, lineHeight: 21 },
  postImg: { width: '100%', height: 200, borderRadius: 12, marginTop: 8 },
  postMeta: { flexDirection: 'row', gap: 14, marginTop: 8, alignItems: 'center' },
  postMetaText: { fontSize: 12, color: GRAY },
  postTime: { fontSize: 11, color: GRAY, marginLeft: 'auto' },
})
