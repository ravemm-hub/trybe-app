import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, Alert, Image, RefreshControl, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../../src/lib/supabase'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER } from '../../src/constants'

const BANNED = ['spam', 'hate', 'violence', 'xxx', 'porn']

export default function FeedScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [posts, setPosts] = useState<any[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isAnon, setIsAnon] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    loadPosts()
  }, [])

  const loadPosts = async () => {
    const { data } = await supabase.from('posts').select('*, profile:profiles(id,display_name,username,avatar_char)')
      .order('created_at', { ascending: false }).limit(50)
    if (data) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: reactions } = await supabase.from('post_reactions').select('post_id, reaction').eq('user_id', user.id)
        const reactMap: Record<string, string> = {}
        for (const r of reactions || []) reactMap[r.post_id] = r.reaction
        setPosts(data.map(p => ({ ...p, my_reaction: reactMap[p.id] || null })))
      } else setPosts(data)
    }
    setLoading(false); setRefreshing(false)
  }

  const pickMedia = async () => {
    if (!userId) return
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) { Alert.alert('Permission needed', 'Allow photo access to attach an image.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images })
    if (result.canceled || !result.assets?.[0]) return
    setUploadingMedia(true)
    try {
      const asset = result.assets[0]
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase()
      const filename = 'post_' + userId + '_' + Date.now() + '.' + ext
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: 'image/' + ext, name: filename } as any)
      const { error } = await supabase.storage.from('chat-media').upload('posts/' + filename, formData, { upsert: true })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl('posts/' + filename)
      setMediaUrl(publicUrl)
    } catch (e: any) { Alert.alert('Upload failed', e?.message || 'Could not upload image') }
    finally { setUploadingMedia(false) }
  }

  const createPost = async () => {
    if (!draft.trim() && !mediaUrl) return
    if (BANNED.some(w => draft.toLowerCase().includes(w))) { Alert.alert('Content Policy', 'Inappropriate content detected.'); return }
    if (!userId) return
    setPosting(true)
    try {
      await supabase.from('posts').insert({ user_id: userId, content: draft.trim(), media_url: mediaUrl, is_anonymous: isAnon, likes: 0, dislikes: 0 })
      setDraft(''); setMediaUrl(null); setIsAnon(false)
      loadPosts()
    } catch {} finally { setPosting(false) }
  }

  const react = async (postId: string, reaction: 'like' | 'dislike', currentReaction: string | null) => {
    if (!userId) return
    const newReaction = currentReaction === reaction ? null : reaction
    if (newReaction) {
      await supabase.from('post_reactions').upsert({ post_id: postId, user_id: userId, reaction: newReaction }, { onConflict: 'post_id,user_id' })
    } else {
      await supabase.from('post_reactions').delete().eq('post_id', postId).eq('user_id', userId)
    }
    await supabase.rpc('update_post_counts', { p_post_id: postId })
    loadPosts()
  }

  const fmt = (ts: string) => {
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  if (loading) return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}><Text style={s.title}>Feed</Text></View>

      <FlatList data={posts} keyExtractor={p => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPosts() }} tintColor={PRIMARY} />}
        ListHeaderComponent={(
          <View style={s.composer}>
            <TextInput style={s.composerInput} value={draft} onChangeText={setDraft} placeholder="What's happening nearby?" placeholderTextColor={GRAY} multiline maxLength={500} />
            {mediaUrl && (
              <View style={s.mediaPreview}>
                <Image source={{ uri: mediaUrl }} style={s.mediaThumb} resizeMode="cover" />
                <TouchableOpacity style={s.mediaRemove} onPress={() => setMediaUrl(null)}>
                  <Text style={s.mediaRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={s.composerFooter}>
              <View style={s.composerLeft}>
                <TouchableOpacity style={s.iconBtn} onPress={pickMedia} disabled={uploadingMedia}>
                  {uploadingMedia ? <ActivityIndicator color={PRIMARY} size="small" /> : <Text style={s.iconBtnText}>📷</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.anonBtn, isAnon && s.anonBtnActive]} onPress={() => setIsAnon(!isAnon)}>
                  <Text style={[s.anonBtnText, isAnon && { color: PRIMARY }]}>{isAnon ? '👻 Anonymous' : 'Anonymous?'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[s.postBtn, (posting || uploadingMedia || (!draft.trim() && !mediaUrl)) && s.postBtnOff]} onPress={createPost} disabled={posting || uploadingMedia || (!draft.trim() && !mediaUrl)}>
                {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.postBtnText}>Post</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
        renderItem={({ item: p }) => {
          const displayName = p.is_anonymous ? '👻 Anonymous' : (p.profile?.display_name || p.profile?.username || 'User')
          const isOwn = p.user_id === userId
          return (
            <View style={s.post}>
              <View style={s.postHeader}>
                <View style={s.postAvatar}>
                  <Text style={s.postAvatarText}>{p.is_anonymous ? '👻' : (p.profile?.avatar_char || displayName[0] || '?')}</Text>
                </View>
                <View style={s.postHeaderInfo}>
                  <Text style={s.postName}>{displayName}</Text>
                  <Text style={s.postTime}>{fmt(p.created_at)}</Text>
                </View>
                {!isOwn && !p.is_anonymous && (
                  <TouchableOpacity style={s.dmBtn} onPress={() => router.push({ pathname: '/dm', params: { userId: p.user_id, userName: p.profile?.display_name || 'User', myMode: 'lit', myAvatar: '💬', isAgent: '0' } })}>
                    <Text style={s.dmBtnText}>💬 DM</Text>
                  </TouchableOpacity>
                )}
              </View>
              {p.content ? <Text style={s.postContent}>{p.content}</Text> : null}
              {p.media_url ? <Image source={{ uri: p.media_url }} style={s.postImage} resizeMode="cover" /> : null}
              <View style={s.postActions}>
                <TouchableOpacity style={s.action} onPress={() => react(p.id, 'like', p.my_reaction)}>
                  <Text style={[s.actionIcon, p.my_reaction === 'like' && s.liked]}>👍</Text>
                  <Text style={[s.actionCount, p.my_reaction === 'like' && { color: PRIMARY }]}>{p.likes || 0}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.action} onPress={() => react(p.id, 'dislike', p.my_reaction)}>
                  <Text style={[s.actionIcon, p.my_reaction === 'dislike' && s.disliked]}>👎</Text>
                  <Text style={[s.actionCount, p.my_reaction === 'dislike' && { color: DANGER }]}>{p.dislikes || 0}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.action}>
                  <Text style={s.actionIcon}>💬</Text>
                  <Text style={s.actionCount}>{p.comment_count || 0}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        }}
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  title: { fontSize: 22, fontWeight: '800', color: TEXT },
  composer: { backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER, padding: 16 },
  composerInput: { fontSize: 15, color: TEXT, minHeight: 60, textAlignVertical: 'top', marginBottom: 12 },
  composerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  composerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 36, height: 32, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { fontSize: 18 },
  mediaPreview: { position: 'relative', marginBottom: 12, alignSelf: 'flex-start' },
  mediaThumb: { width: 120, height: 120, borderRadius: 12 },
  mediaRemove: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  mediaRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  anonBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
  anonBtnActive: { borderColor: PRIMARY, backgroundColor: '#EEF0FF' },
  anonBtnText: { fontSize: 13, color: GRAY, fontWeight: '500' },
  postBtn: { backgroundColor: PRIMARY, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  postBtnOff: { opacity: 0.4 },
  postBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  post: { backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingBottom: 8 },
  postAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  postAvatarText: { fontSize: 20 },
  postHeaderInfo: { flex: 1 },
  postName: { fontSize: 14, fontWeight: '600', color: TEXT },
  postTime: { fontSize: 11, color: GRAY },
  dmBtn: { backgroundColor: BG, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
  dmBtnText: { fontSize: 12, color: PRIMARY, fontWeight: '600' },
  postContent: { fontSize: 15, color: TEXT, lineHeight: 22, paddingHorizontal: 14, paddingBottom: 10 },
  postImage: { width: '100%', height: 220 },
  postActions: { flexDirection: 'row', gap: 0, paddingHorizontal: 14, paddingVertical: 10 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 20 },
  actionIcon: { fontSize: 18, opacity: 0.5 },
  actionCount: { fontSize: 13, color: GRAY, fontWeight: '500' },
  liked: { opacity: 1 },
  disliked: { opacity: 1 },
})
