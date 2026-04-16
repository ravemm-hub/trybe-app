import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, StatusBar, RefreshControl, Pressable, Image, TextInput, Alert,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

type Post = {
  id: string
  user_id: string
  content: string | null
  media_url: string | null
  group_id: string | null
  likes: number
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
  group?: { name: string } | null
}

export default function FeedScreen() {
  const router = useRouter()
  const [posts, setPosts] = useState<Post[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [showCompose, setShowCompose] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUserId(user.id); loadFeed(user.id) }
    })
  }, [])

  const loadFeed = useCallback(async (uid?: string) => {
    const { data } = await supabase
      .from('posts')
      .select('*, profile:profiles(display_name, username, avatar_char), group:groups(name)')
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setPosts(data as Post[])
    setRefreshing(false)
  }, [])

  useEffect(() => {
    const channel = supabase.channel('feed-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => loadFeed())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadFeed])

  const createPost = async () => {
    if (!draft.trim() || !userId) return
    setPosting(true)
    await supabase.from('posts').insert({ user_id: userId, content: draft.trim() })
    setDraft('')
    setShowCompose(false)
    setPosting(false)
  }

  const pickAndPost = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) return
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 })
    if (result.canceled || !result.assets?.[0] || !userId) return
    setPosting(true)
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)
      const { error } = await supabase.storage.from('chat-media').upload(`feed/${filename}`, formData)
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(`feed/${filename}`)
      await supabase.from('posts').insert({ user_id: userId, media_url: publicUrl, content: draft.trim() || null })
      setDraft('')
      setShowCompose(false)
    } catch (err: any) { Alert.alert('Error', err.message) }
    finally { setPosting(false) }
  }

  const likePost = async (postId: string, currentLikes: number) => {
    await supabase.from('posts').update({ likes: currentLikes + 1 }).eq('id', postId)
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: p.likes + 1 } : p))
  }

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
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
        <View style={s.composeBox}>
          <TextInput
            style={s.composeInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="What's happening near you?"
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={300}
            autoFocus
          />
          <View style={s.composeActions}>
            <TouchableOpacity style={s.photoBtn} onPress={pickAndPost}>
              <Text style={s.photoBtnText}>📷</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.postBtn, (!draft.trim() || posting) && s.postBtnOff]}
              onPress={createPost}
              disabled={!draft.trim() || posting}
            >
              <Text style={s.postBtnText}>{posting ? '...' : 'Post'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFeed() }} tintColor={GREEN} />}
        contentContainerStyle={[s.list, posts.length === 0 && s.listEmpty]}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>🌐</Text>
            <Text style={s.emptyTitle}>Feed is empty</Text>
            <Text style={s.emptySub}>Be the first to post something</Text>
          </View>
        }
        renderItem={({ item }) => {
          const displayName = item.profile?.display_name || item.profile?.username || 'Unknown'
          const avatar = item.profile?.avatar_char || displayName[0] || '?'
          const isMe = item.user_id === userId

          return (
            <View style={s.post}>
              <View style={s.postHeader}>
                <View style={s.postAvatar}>
                  <Text style={s.postAvatarText}>{avatar}</Text>
                </View>
                <View style={s.postMeta}>
                  <Text style={s.postName}>{displayName}</Text>
                  <View style={s.postMetaRow}>
                    <Text style={s.postTime}>{formatTime(item.created_at)}</Text>
                    {item.group && (
                      <>
                        <Text style={s.metaDot}>·</Text>
                        <Text style={s.postGroup}>⚡ {item.group.name}</Text>
                      </>
                    )}
                  </View>
                </View>
              </View>

              {item.content && <Text style={s.postContent}>{item.content}</Text>}

              {item.media_url && (
                <Image source={{ uri: item.media_url }} style={s.postImage} resizeMode="cover" />
              )}

              <View style={s.postActions}>
                <TouchableOpacity style={s.actionBtn} onPress={() => likePost(item.id, item.likes)}>
                  <Text style={s.actionIcon}>❤️</Text>
                  {item.likes > 0 && <Text style={s.actionCount}>{item.likes}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn}>
                  <Text style={s.actionIcon}>💬</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn}>
                  <Text style={s.actionIcon}>↗️</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
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
  list: { padding: 0 },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A', marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY },
  post: { backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8', padding: 16 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  postAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  postAvatarText: { fontSize: 18 },
  postMeta: { flex: 1 },
  postName: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  postMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  postTime: { fontSize: 12, color: GRAY },
  metaDot: { fontSize: 12, color: GRAY },
  postGroup: { fontSize: 12, color: PURPLE, fontWeight: '500' },
  postContent: { fontSize: 15, color: '#2C2C2A', lineHeight: 22, marginBottom: 10 },
  postImage: { width: '100%', height: 280, borderRadius: 12, marginBottom: 10 },
  postActions: { flexDirection: 'row', gap: 20, paddingTop: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionIcon: { fontSize: 18 },
  actionCount: { fontSize: 13, color: GRAY, fontWeight: '500' },
})
