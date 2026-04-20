import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView,
  StatusBar, RefreshControl, Image, TextInput, Alert,
  KeyboardAvoidingView, Platform, Modal, Share,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../../lib/supabase'

type Post = {
  id: string
  user_id: string
  content: string | null
  media_url: string | null
  likes: number
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

type Comment = {
  id: string
  post_id: string
  user_id: string
  content: string
  created_at: string
  profile?: { display_name: string | null; username: string }
}

export default function FeedScreen() {
  const [posts, setPosts] = useState<Post[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [commentModal, setCommentModal] = useState<Post | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentDraft, setCommentDraft] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); loadFeed() }
    })
  }, [])

  const loadFeed = useCallback(async () => {
    try {
      const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(30)
      const enriched = await Promise.all((data || []).map(async (post: Post) => {
        const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', post.user_id).single()
        return { ...post, profile: profile || undefined }
      }))
      setPosts(enriched)
    } catch (e: any) { console.error(e.message) }
    finally { setRefreshing(false) }
  }, [])

  useEffect(() => {
    const channel = supabase.channel('feed-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => loadFeed())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadFeed])

  const loadComments = async (postId: string) => {
    const { data } = await supabase.from('post_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true })
    if (!data) return
    const enriched = await Promise.all(data.map(async (c: Comment) => {
      const { data: profile } = await supabase.from('profiles').select('display_name, username').eq('id', c.user_id).single()
      return { ...c, profile: profile || undefined }
    }))
    setComments(enriched)
  }

  const openComments = async (post: Post) => {
    setCommentModal(post)
    await loadComments(post.id)
  }

  const addComment = async () => {
    if (!commentDraft.trim() || !userId || !commentModal) return
    await supabase.from('post_comments').insert({ post_id: commentModal.id, user_id: userId, content: commentDraft.trim() })
    setCommentDraft('')
    await loadComments(commentModal.id)
  }

  const createPost = async () => {
    if (!draft.trim() || !userId) return
    setPosting(true)
    await supabase.from('posts').insert({ user_id: userId, content: draft.trim() })
    setDraft(''); setShowCompose(false); loadFeed()
    setPosting(false)
  }

  const pickAndPost = async () => {
    if (!userId) return
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) return
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 })
    if (result.canceled || !result.assets?.[0]) return
    setPosting(true)
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `feed_${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)
      await supabase.storage.from('chat-media').upload(`feed/${filename}`, formData)
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(`feed/${filename}`)
      await supabase.from('posts').insert({ user_id: userId, media_url: publicUrl, content: draft.trim() || null })
      setDraft(''); setShowCompose(false); loadFeed()
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setPosting(false) }
  }

  const likePost = async (postId: string, currentLikes: number) => {
    await supabase.from('posts').update({ likes: currentLikes + 1 }).eq('id', postId)
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: p.likes + 1 } : p))
  }

  const sharePost = async (post: Post) => {
    try {
      await Share.share({
        message: `${post.content || ''}\n\nShared from Tryber 🐦`,
        url: post.media_url || undefined,
      })
    } catch {}
  }

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`
    return new Date(ts).toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.logo}>tryber</Text>
        <TouchableOpacity style={s.composeBtn} onPress={() => setShowCompose(!showCompose)}>
          <Text style={s.composeBtnText}>+ Post</Text>
        </TouchableOpacity>
      </View>

      {showCompose && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.composeBox}>
            <TextInput style={s.composeInput} value={draft} onChangeText={setDraft} placeholder="What's happening near you?" placeholderTextColor="#B4B2A9" multiline maxLength={300} autoFocus />
            <View style={s.composeActions}>
              <TouchableOpacity style={s.photoBtn} onPress={pickAndPost} disabled={posting}>
                <Text style={s.photoBtnText}>📷</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.postBtn, (!draft.trim() || posting) && s.postBtnOff]} onPress={createPost} disabled={!draft.trim() || posting}>
                <Text style={s.postBtnText}>{posting ? '...' : 'Post'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFeed() }} tintColor="#1D9E75" />}
        contentContainerStyle={posts.length === 0 ? s.listEmpty : s.list}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🌐</Text>
            <Text style={s.emptyTitle}>Feed is empty</Text>
            <Text style={s.emptySub}>Be the first to post something!</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowCompose(true)}>
              <Text style={s.emptyBtnText}>+ Create post</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          const displayName = item.profile?.display_name || item.profile?.username || 'Unknown'
          const avatar = item.profile?.avatar_char || displayName[0] || '?'
          return (
            <View style={s.post}>
              <View style={s.postHeader}>
                <View style={s.postAvatar}><Text style={s.postAvatarText}>{avatar}</Text></View>
                <View style={s.postMeta}>
                  <Text style={s.postName}>{displayName}</Text>
                  <Text style={s.postTime}>{formatTime(item.created_at)}</Text>
                </View>
              </View>
              {item.content ? <Text style={s.postContent}>{item.content}</Text> : null}
              {item.media_url ? <Image source={{ uri: item.media_url }} style={s.postImage} resizeMode="cover" /> : null}
              <View style={s.postActions}>
                <TouchableOpacity style={s.actionBtn} onPress={() => likePost(item.id, item.likes)}>
                  <Text style={s.actionIcon}>❤️</Text>
                  {item.likes > 0 && <Text style={s.actionCount}>{item.likes}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn} onPress={() => openComments(item)}>
                  <Text style={s.actionIcon}>💬</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn} onPress={() => sharePost(item)}>
                  <Text style={s.actionIcon}>↗️</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        }}
      />

      {/* Comments Modal */}
      <Modal visible={!!commentModal} animationType="slide" onRequestClose={() => setCommentModal(null)}>
        <SafeAreaView style={s.commentsContainer}>
          <View style={s.commentsHeader}>
            <TouchableOpacity onPress={() => setCommentModal(null)}>
              <Text style={s.commentsBack}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={s.commentsTitle}>Comments</Text>
            <View style={{ width: 60 }} />
          </View>
          <FlatList
            data={comments}
            keyExtractor={c => c.id}
            contentContainerStyle={s.commentsList}
            ListEmptyComponent={<View style={{ padding: 32, alignItems: 'center' }}><Text style={{ color: '#888', fontSize: 14 }}>No comments yet — be first!</Text></View>}
            renderItem={({ item }) => (
              <View style={s.comment}>
                <View style={s.commentAvatar}>
                  <Text style={{ fontSize: 14 }}>{item.profile?.display_name?.[0] || '?'}</Text>
                </View>
                <View style={s.commentBody}>
                  <Text style={s.commentName}>{item.profile?.display_name || item.profile?.username || 'Unknown'}</Text>
                  <Text style={s.commentText}>{item.content}</Text>
                </View>
              </View>
            )}
          />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={s.commentInput}>
              <TextInput style={s.commentInputField} value={commentDraft} onChangeText={setCommentDraft} placeholder="Add a comment..." placeholderTextColor="#B4B2A9" />
              <TouchableOpacity style={[s.commentSendBtn, !commentDraft.trim() && { opacity: 0.4 }]} onPress={addComment} disabled={!commentDraft.trim()}>
                <Text style={s.commentSendText}>↑</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  logo: { fontSize: 24, fontWeight: '800', color: GREEN, letterSpacing: -1 },
  composeBtn: { backgroundColor: GREEN, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  composeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  composeBox: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  composeInput: { backgroundColor: '#F1EFE8', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: '#2C2C2A', minHeight: 80, textAlignVertical: 'top', marginBottom: 10 },
  composeActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  photoBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  photoBtnText: { fontSize: 20 },
  postBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  postBtnOff: { opacity: 0.5 },
  postBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  list: { paddingBottom: 20 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 24 },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  post: { backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8', padding: 16 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  postAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  postAvatarText: { fontSize: 18 },
  postMeta: { flex: 1 },
  postName: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  postTime: { fontSize: 12, color: GRAY, marginTop: 1 },
  postContent: { fontSize: 15, color: '#2C2C2A', lineHeight: 22, marginBottom: 10 },
  postImage: { width: '100%', height: 280, borderRadius: 12, marginBottom: 10 },
  postActions: { flexDirection: 'row', gap: 24, paddingTop: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionIcon: { fontSize: 20 },
  actionCount: { fontSize: 13, color: GRAY, fontWeight: '500' },
  commentsContainer: { flex: 1, backgroundColor: '#FAFAF8' },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  commentsBack: { fontSize: 16, color: GREEN, fontWeight: '500' },
  commentsTitle: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  commentsList: { padding: 16, gap: 12 },
  comment: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  commentBody: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 0.5, borderColor: '#E0DED8' },
  commentName: { fontSize: 12, fontWeight: '600', color: '#2C2C2A', marginBottom: 3 },
  commentText: { fontSize: 14, color: '#444441', lineHeight: 20 },
  commentInput: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  commentInputField: { flex: 1, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  commentSendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  commentSendText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
