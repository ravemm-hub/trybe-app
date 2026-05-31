import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, Alert, Image, RefreshControl, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { pickImageAsset, uploadMedia } from '../../src/lib/upload'
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
  const [commentsPost, setCommentsPost] = useState<any | null>(null)
  const [comments, setComments] = useState<any[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [postingComment, setPostingComment] = useState(false)

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
    const asset = await pickImageAsset()
    if (!asset) return
    setUploadingMedia(true)
    const url = await uploadMedia(asset.uri, 'image', asset.ext)
    setUploadingMedia(false)
    if (url) setMediaUrl(url); else Alert.alert('Upload failed', 'Could not upload the image.')
  }

  const createPost = async () => {
    if (!draft.trim() && !mediaUrl) return
    if (BANNED.some(w => draft.toLowerCase().includes(w))) { Alert.alert('Content Policy', 'Inappropriate content detected.'); return }
    if (!userId) { Alert.alert('Sign in required', 'Your session expired — please sign in again.'); return }
    setPosting(true)
    const { error } = await supabase.from('posts').insert({ user_id: userId, content: draft.trim(), media_url: mediaUrl, is_anonymous: isAnon, likes: 0, dislikes: 0 })
    setPosting(false)
    if (error) { Alert.alert('Could not post', error.message); return }
    setDraft(''); setMediaUrl(null); setIsAnon(false)
    loadPosts()
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

  const openComments = async (post: any) => {
    setCommentsPost(post)
    setComments([])
    setCommentDraft('')
    setLoadingComments(true)
    try {
      const { data } = await supabase.from('post_comments')
        .select('*, profile:profiles(display_name, username, avatar_char)')
        .eq('post_id', post.id).order('created_at', { ascending: true })
      setComments(data || [])
    } catch {}
    setLoadingComments(false)
  }

  const addComment = async () => {
    if (!commentDraft.trim() || !userId || !commentsPost) return
    setPostingComment(true)
    try {
      const { data, error } = await supabase.from('post_comments')
        .insert({ post_id: commentsPost.id, user_id: userId, content: commentDraft.trim(), is_anonymous: false })
        .select('*, profile:profiles(display_name, username, avatar_char)').single()
      if (error) throw error
      if (data) setComments(prev => [...prev, data])
      setCommentDraft('')
      // reflect the new count locally (DB trigger keeps it authoritative)
      setPosts(prev => prev.map(p => p.id === commentsPost.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p))
    } catch (e: any) { Alert.alert('Error', e?.message || 'Could not post comment') }
    finally { setPostingComment(false) }
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
                  <TouchableOpacity style={s.dmBtn} onPress={() => router.push({ pathname: '/dm', params: { userId: p.user_id, userName: p.profile?.display_name || 'User', myMode: 'lit', theirMode: 'lit', myAvatar: '💬', isAgent: '0' } })}>
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
                <TouchableOpacity style={s.action} onPress={() => openComments(p)}>
                  <Text style={s.actionIcon}>💬</Text>
                  <Text style={s.actionCount}>{p.comment_count || 0}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        }}
      />

      <Modal visible={!!commentsPost} transparent animationType="slide" onRequestClose={() => setCommentsPost(null)}>
        <KeyboardAvoidingView style={s.cOverlay} behavior="padding" keyboardVerticalOffset={0}>
          <View style={[s.cSheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={s.cHeader}>
              <Text style={s.cTitle}>Comments</Text>
              <TouchableOpacity onPress={() => setCommentsPost(null)}><Text style={s.cClose}>✕</Text></TouchableOpacity>
            </View>
            {loadingComments
              ? <ActivityIndicator color={PRIMARY} style={{ paddingVertical: 24 }} />
              : <FlatList data={comments} keyExtractor={c => c.id}
                  style={{ maxHeight: 360 }}
                  contentContainerStyle={comments.length === 0 ? { paddingVertical: 24 } : { paddingVertical: 8 }}
                  ListEmptyComponent={<Text style={s.cEmpty}>No comments yet. Be the first!</Text>}
                  renderItem={({ item: c }) => {
                    const cn = c.is_anonymous ? '👻 Anonymous' : (c.profile?.display_name || c.profile?.username || 'User')
                    return (
                      <View style={s.cRow}>
                        <View style={s.cAvatar}><Text style={s.cAvatarText}>{c.is_anonymous ? '👻' : (c.profile?.avatar_char || cn[0] || '?')}</Text></View>
                        <View style={s.cBubble}>
                          <Text style={s.cName}>{cn} · <Text style={s.cTime}>{fmt(c.created_at)}</Text></Text>
                          <Text style={s.cContent}>{c.content}</Text>
                        </View>
                      </View>
                    )
                  }} />
            }
            <View style={s.cInputRow}>
              <TextInput style={s.cInput} value={commentDraft} onChangeText={setCommentDraft} placeholder="Add a comment..." placeholderTextColor={GRAY} multiline />
              <TouchableOpacity style={[s.cSend, (!commentDraft.trim() || postingComment) && { opacity: 0.4 }]} onPress={addComment} disabled={!commentDraft.trim() || postingComment}>
                {postingComment ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.cSendText}>↑</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  cOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  cSheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 12 },
  cHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: 0.5, borderColor: BORDER },
  cTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  cClose: { fontSize: 18, color: GRAY, paddingHorizontal: 6 },
  cEmpty: { fontSize: 14, color: GRAY, textAlign: 'center' },
  cRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  cAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  cAvatarText: { fontSize: 16 },
  cBubble: { flex: 1, backgroundColor: BG, borderRadius: 12, padding: 10 },
  cName: { fontSize: 12, fontWeight: '600', color: TEXT, marginBottom: 2 },
  cTime: { fontSize: 11, color: GRAY, fontWeight: '400' },
  cContent: { fontSize: 14, color: TEXT, lineHeight: 19 },
  cInputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingTop: 10, borderTopWidth: 0.5, borderColor: BORDER },
  cInput: { flex: 1, backgroundColor: BG, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: TEXT, maxHeight: 90, borderWidth: 1, borderColor: BORDER },
  cSend: { width: 38, height: 38, borderRadius: 19, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  cSendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
