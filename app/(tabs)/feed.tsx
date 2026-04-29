import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  TextInput, Alert, RefreshControl, StatusBar, Pressable, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

type Post = {
  id: string
  user_id: string
  content: string
  media_url: string | null
  likes: number
  is_anonymous: boolean
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
  liked?: boolean
  comment_count?: number
}

type Comment = {
  id: string
  user_id: string
  content: string
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

export default function FeedScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [posts, setPosts] = useState<Post[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState('')
  const [isAnon, setIsAnon] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentDraft, setCommentDraft] = useState('')
  const [commentAnon, setCommentAnon] = useState(false)
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); loadFeed(user.id) }
    })
  }, [])

  const loadFeed = useCallback(async (uid?: string) => {
    const myId = uid || userId
    try {
      const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(30)
      const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', myId || '')
      const followSet = new Set((follows || []).map((f: any) => f.following_id))
      setFollowingIds(followSet)

      const enriched = await Promise.all((data || []).map(async (p: Post) => {
        const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', p.user_id).single()
        const { count: commentCount } = await supabase.from('post_comments').select('id', { count: 'exact', head: true }).eq('post_id', p.id)
        return { ...p, profile: profile || undefined, liked: false, comment_count: commentCount || 0 }
      }))
      setPosts(enriched)
    } catch (e: any) { console.error(e) }
    finally { setRefreshing(false) }
  }, [userId])

  const likePost = async (post: Post) => {
    if (!userId) return
    const newLikes = post.liked ? post.likes - 1 : post.likes + 1
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, likes: newLikes, liked: !p.liked } : p))
    await supabase.from('posts').update({ likes: newLikes }).eq('id', post.id)
  }

  const followUser = async (targetId: string) => {
    if (!userId || targetId === userId) return
    const isFollowing = followingIds.has(targetId)
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', userId).eq('following_id', targetId)
      setFollowingIds(prev => { const n = new Set(prev); n.delete(targetId); return n })
    } else {
      await supabase.from('follows').insert({ follower_id: userId, following_id: targetId })
      setFollowingIds(prev => new Set([...prev, targetId]))
    }
  }

  const openComments = async (post: Post) => {
    setSelectedPost(post)
    const { data } = await supabase.from('post_comments').select('*, is_anonymous').eq('post_id', post.id).order('created_at', { ascending: true })
    const enriched = await Promise.all((data || []).map(async (c: Comment) => {
      const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', c.user_id).single()
      return { ...c, profile: profile || undefined }
    }))
    setComments(enriched)
  }

  const sendComment = async () => {
    if (!commentDraft.trim() || !userId || !selectedPost) return
    const text = commentDraft.trim()
    setCommentDraft('')
    await supabase.from('post_comments').insert({ post_id: selectedPost.id, user_id: userId, content: text, is_anonymous: commentAnon })
    await supabase.from('posts').update({ comment_count: (selectedPost.comment_count || 0) + 1 }).eq('id', selectedPost.id)
    await openComments(selectedPost)
    setPosts(prev => prev.map(p => p.id === selectedPost.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p))
  }

  const pickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) return
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 })
    if (result.canceled || !result.assets?.[0] || !userId) return
    setUploading(true)
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `post_${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)
      await supabase.storage.from('chat-media').upload(`posts/${filename}`, formData)
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(`posts/${filename}`)
      setMediaUrl(publicUrl)
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setUploading(false) }
  }

  const createPost = async () => {
    if (!draft.trim() && !mediaUrl) return
    if (!userId) return
    setPosting(true)
    try {
      await supabase.from('posts').insert({
        user_id: userId, content: draft.trim(),
        media_url: mediaUrl, likes: 0, is_anonymous: isAnon,
      })
      setDraft(''); setMediaUrl(null); setIsAnon(false); setShowCreate(false)
      await loadFeed()
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setPosting(false) }
  }

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
    return `${Math.floor(diff / 86400000)}d`
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <Text style={s.headerTitle}>Feed</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => setShowCreate(true)}>
          <Text style={s.createBtnText}>+ Post</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFeed() }} tintColor={GREEN} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🌍</Text>
            <Text style={s.emptyTitle}>No posts yet</Text>
            <Text style={s.emptySub}>Be the first to share something</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowCreate(true)}>
              <Text style={s.emptyBtnText}>+ Create Post</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          const isOwn = item.user_id === userId
          const isFollowing = followingIds.has(item.user_id)
          const displayName = item.is_anonymous ? 'Anonymous 👻' : (item.profile?.display_name || item.profile?.username || 'Unknown')
          const avatarChar = item.is_anonymous ? '👻' : (item.profile?.avatar_char || displayName[0] || '?')

          return (
            <View style={s.postCard}>
              {/* Header */}
              <View style={s.postHeader}>
                <View style={s.postAvatar}>
                  <Text style={s.postAvatarText}>{avatarChar}</Text>
                </View>
                <View style={s.postAuthorInfo}>
                  <Text style={s.postAuthor}>{displayName}</Text>
                  <Text style={s.postTime}>{formatTime(item.created_at)} ago</Text>
                </View>
                {!isOwn && !item.is_anonymous && (
                  <TouchableOpacity style={[s.followBtn, isFollowing && s.followingBtn]} onPress={() => followUser(item.user_id)}>
                    <Text style={[s.followBtnText, isFollowing && s.followingBtnText]}>{isFollowing ? '✓ Following' : '+ Follow'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Content */}
              {item.content ? <Text style={s.postContent}>{item.content}</Text> : null}
              {item.media_url && <Image source={{ uri: item.media_url }} style={s.postImage} resizeMode="cover" />}

              {/* Actions */}
              <View style={s.postActions}>
                <TouchableOpacity style={s.actionBtn} onPress={() => likePost(item)}>
                  <Text style={s.actionIcon}>{item.liked ? '❤️' : '🤍'}</Text>
                  <Text style={s.actionCount}>{item.likes}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn} onPress={() => openComments(item)}>
                  <Text style={s.actionIcon}>💬</Text>
                  <Text style={s.actionCount}>{item.comment_count || 0}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn}>
                  <Text style={s.actionIcon}>↗️</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        }}
      />

      {/* Create Post Modal */}
      <Modal visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={[s.createContainer, { paddingTop: insets.top }]}>
          <View style={s.createHeader}>
            <TouchableOpacity onPress={() => setShowCreate(false)}><Text style={s.createCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.createTitle}>New Post</Text>
            <TouchableOpacity onPress={createPost} disabled={posting || (!draft.trim() && !mediaUrl)}>
              {posting ? <ActivityIndicator color={GREEN} /> : <Text style={[s.createShare, (!draft.trim() && !mediaUrl) && { opacity: 0.4 }]}>Share</Text>}
            </TouchableOpacity>
          </View>

          <View style={s.createBody}>
            <TextInput
              style={s.createInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="What's on your mind?"
              placeholderTextColor="#B4B2A9"
              multiline
              autoFocus
              maxLength={500}
            />
            {mediaUrl && <Image source={{ uri: mediaUrl }} style={s.previewImage} resizeMode="cover" />}
          </View>

          <View style={s.createFooter}>
            <TouchableOpacity style={s.createFooterBtn} onPress={pickImage} disabled={uploading}>
              {uploading ? <ActivityIndicator color={GREEN} size="small" /> : <Text style={s.createFooterIcon}>🖼️</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.createFooterBtn, isAnon && s.createFooterBtnActive]} onPress={() => setIsAnon(!isAnon)}>
              <Text style={s.createFooterIcon}>👻</Text>
              <Text style={[s.createFooterText, isAnon && { color: PURPLE }]}>{isAnon ? 'Anonymous' : 'Anonymous?'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Comments Modal */}
      <Modal visible={!!selectedPost} animationType="slide" onRequestClose={() => setSelectedPost(null)}>
        <View style={[s.commentsContainer, { paddingTop: insets.top }]}>
          <View style={s.commentsHeader}>
            <TouchableOpacity onPress={() => setSelectedPost(null)}><Text style={s.commentsBack}>‹</Text></TouchableOpacity>
            <Text style={s.commentsTitle}>Comments</Text>
            <View style={{ width: 40 }} />
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
            <FlatList
              data={comments}
              keyExtractor={c => c.id}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              ListEmptyComponent={<Text style={{ textAlign: 'center', color: GRAY, marginTop: 40 }}>No comments yet — be first!</Text>}
              renderItem={({ item }) => (
                <View style={s.commentRow}>
                  <View style={s.commentAvatar}>
                    <Text style={{ fontSize: 16 }}>{item.profile?.avatar_char || item.profile?.display_name?.[0] || '?'}</Text>
                  </View>
                  <View style={s.commentBubble}>
                    <Text style={s.commentName}>{(item as any).is_anonymous ? '👻 Anonymous' : (item.profile?.display_name || item.profile?.username)}</Text>
                    <Text style={s.commentText}>{item.content}</Text>
                  </View>
                </View>
              )}
            />
            <View style={[s.commentInput, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              <TouchableOpacity style={[s.anonToggle, commentAnon && s.anonToggleOn]} onPress={() => setCommentAnon(!commentAnon)}>
                <Text style={s.anonToggleText}>{commentAnon ? '👻' : '🔥'}</Text>
              </TouchableOpacity>
              <TextInput
                style={s.commentTextInput}
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder="Add a comment..."
                placeholderTextColor="#B4B2A9"
                multiline
              />
              <TouchableOpacity style={[s.commentSendBtn, !commentDraft.trim() && { opacity: 0.4 }]} onPress={sendComment} disabled={!commentDraft.trim()}>
                <Text style={s.commentSendText}>↑</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.5 },
  createBtn: { backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, marginBottom: 24, textAlign: 'center' },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  postCard: { backgroundColor: '#fff', marginBottom: 8, borderBottomWidth: 0.5, borderColor: '#EEEDE8' },
  postHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  postAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  postAvatarText: { fontSize: 20 },
  postAuthorInfo: { flex: 1 },
  postAuthor: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  postTime: { fontSize: 12, color: GRAY },
  followBtn: { backgroundColor: '#F1EFE8', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#E0DED8' },
  followingBtn: { backgroundColor: '#E1F5EE', borderColor: GREEN },
  followBtnText: { fontSize: 12, fontWeight: '700', color: '#1A1A2E' },
  followingBtnText: { color: GREEN },
  postContent: { fontSize: 15, color: '#1A1A2E', lineHeight: 22, paddingHorizontal: 14, paddingBottom: 10 },
  postImage: { width: '100%', height: 300 },
  postActions: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 10, gap: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  actionIcon: { fontSize: 22 },
  actionCount: { fontSize: 14, color: '#1A1A2E', fontWeight: '600' },
  createContainer: { flex: 1, backgroundColor: '#fff' },
  createHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  createCancel: { fontSize: 16, color: GRAY },
  createTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  createShare: { fontSize: 16, fontWeight: '700', color: GREEN },
  createBody: { flex: 1, padding: 16 },
  createInput: { fontSize: 16, color: '#1A1A2E', lineHeight: 24, minHeight: 120, textAlignVertical: 'top' },
  previewImage: { width: '100%', height: 200, borderRadius: 12, marginTop: 12 },
  createFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderTopWidth: 0.5, borderColor: '#E0DED8' },
  createFooterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F1EFE8', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  createFooterBtnActive: { backgroundColor: '#EEEDFE' },
  createFooterIcon: { fontSize: 18 },
  createFooterText: { fontSize: 13, color: GRAY, fontWeight: '500' },
  commentsContainer: { flex: 1, backgroundColor: '#fff' },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  commentsBack: { fontSize: 32, color: GREEN, lineHeight: 36, marginTop: -4 },
  commentsTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  commentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  commentAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  commentBubble: { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 14, padding: 10 },
  commentName: { fontSize: 12, fontWeight: '700', color: '#1A1A2E', marginBottom: 3 },
  commentText: { fontSize: 14, color: '#2C2C2A', lineHeight: 20 },
  commentInput: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 0.5, borderColor: '#E0DED8', backgroundColor: '#fff' },
  commentTextInput: { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#1A1A2E', maxHeight: 80 },
  anonToggle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  anonToggleOn: { backgroundColor: '#EEEDFE' },
  anonToggleText: { fontSize: 18 },
  commentSendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  commentSendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
