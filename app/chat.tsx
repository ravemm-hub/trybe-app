import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, ActivityIndicator,
  Pressable, Image, Alert, ActionSheetIOS, Modal,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'

const AGENT_IDS = [
  'a1000001-0000-0000-0000-000000000001',
  'a1000001-0000-0000-0000-000000000002',
  'a1000001-0000-0000-0000-000000000003',
  'a1000001-0000-0000-0000-000000000019',
  'a1000001-0000-0000-0000-000000000020',
  'a1000001-0000-0000-0000-000000000026',
  'a1000001-0000-0000-0000-000000000029',
]

const QUICK_REACTIONS = ['❤️', '😂', '🔥', '👏', '😮', '🙏']

type Message = {
  id: string
  user_id: string | null
  type: string
  content: string | null
  media_url: string | null
  reply_to_id: string | null
  reply_preview: string | null
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

export default function ChatScreen() {
  const { id, name, members } = useLocalSearchParams<{ id: string; name: string; members: string }>()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState(parseInt(members || '0'))
  const [reactionTarget, setReactionTarget] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const listRef = useRef<FlatList>(null)

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*, profile:profiles(display_name, username, avatar_char)')
      .eq('group_id', id)
      .order('created_at', { ascending: true })
      .limit(100)
    if (data) setMessages(data as Message[])
    setLoading(false)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }, [id])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => { if (user) setUserId(user.id) })
    loadMessages()
  }, [loadMessages])

  useEffect(() => {
    const channel = supabase
      .channel(`chat:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${id}` },
        async (payload) => {
          const newMsg = payload.new as Message
          const { data: profile } = await supabase
            .from('profiles').select('display_name, username, avatar_char').eq('id', newMsg.user_id).single()
          setMessages(prev => [...prev, { ...newMsg, profile: profile || undefined }])
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${id}` },
        (payload) => setMemberCount(payload.new.member_count))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  const sendMessage = async () => {
    if (!draft.trim() || !userId) return
    const text = draft.trim()
    setDraft('')
    await supabase.from('messages').insert({
      group_id: id, user_id: userId, type: 'text', content: text,
      reply_to_id: replyTo?.id || null,
      reply_preview: replyTo?.content ? replyTo.content.slice(0, 60) : null,
    })
    setReplyTo(null)
  }

  const pickImage = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed'); return }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, base64: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: false })

    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    setUploading(true)

    try {
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)

      const { data: uploadData, error } = await supabase.storage
        .from('chat-media')
        .upload(`groups/${id}/${filename}`, formData)

      if (error) throw error

      const { data: { publicUrl } } = supabase.storage
        .from('chat-media')
        .getPublicUrl(`groups/${id}/${filename}`)

      await supabase.from('messages').insert({
        group_id: id, user_id: userId, type: 'image', media_url: publicUrl,
      })
    } catch (err: any) {
      Alert.alert('Upload failed', err.message)
    } finally {
      setUploading(false)
    }
  }

  const showImageOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Camera', 'Photo Library'], cancelButtonIndex: 0 },
        (idx) => { if (idx === 1) pickImage(true); if (idx === 2) pickImage(false) }
      )
    } else {
      Alert.alert('Add photo', '', [
        { text: 'Camera', onPress: () => pickImage(true) },
        { text: 'Photo Library', onPress: () => pickImage(false) },
        { text: 'Cancel', style: 'cancel' },
      ])
    }
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  const isAgent = (uid: string | null) => uid && AGENT_IDS.includes(uid)

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.headerName} numberOfLines={1}>{name}</Text>
          <Text style={s.headerSub}>{memberCount} people · LIVE</Text>
        </View>
        <View style={s.liveDot} />
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={s.messageList}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<View style={s.center}><Text style={s.emptyText}>No messages yet — say hi! 👋</Text></View>}
            renderItem={({ item }) => {
              const isMe = item.user_id === userId
              const isSystem = item.type === 'system'
              const agent = isAgent(item.user_id)
              const displayName = item.profile?.display_name || item.profile?.username || 'Unknown'
              const avatarChar = item.profile?.avatar_char || (agent ? '🤖' : displayName[0] || '?')

              if (isSystem) {
                return <View style={s.systemMsg}><Text style={s.systemText}>{item.content}</Text></View>
              }

              return (
                <Pressable
                  onLongPress={() => setReactionTarget(reactionTarget === item.id ? null : item.id)}
                  style={[s.bubbleRow, isMe && s.bubbleRowMe]}
                >
                  {!isMe && (
                    <View style={[s.avatar, agent && s.avatarAgent]}>
                      <Text style={s.avatarText}>{avatarChar}</Text>
                    </View>
                  )}
                  <View style={s.bubbleCol}>
                    {!isMe && (
                      <View style={s.senderRow}>
                        <Text style={s.senderName}>{displayName}</Text>
                        {agent && <View style={s.agentBadge}><Text style={s.agentBadgeText}>AI</Text></View>}
                      </View>
                    )}

                    {item.reply_preview && (
                      <View style={[s.replyPreview, isMe && s.replyPreviewMe]}>
                        <Text style={s.replyPreviewText} numberOfLines={1}>↩ {item.reply_preview}</Text>
                      </View>
                    )}

                    <View style={[s.bubble, isMe ? s.bubbleMe : agent ? s.bubbleAgent : s.bubbleThem]}>
                      {item.type === 'image' && item.media_url ? (
                        <Image source={{ uri: item.media_url }} style={s.msgImage} resizeMode="cover" />
                      ) : (
                        <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextThem]}>
                          {item.content}
                        </Text>
                      )}
                    </View>

                    <View style={[s.msgActions, isMe && s.msgActionsMe]}>
                      <Text style={s.timeText}>{formatTime(item.created_at)}</Text>
                      <TouchableOpacity onPress={() => setReplyTo(item)} style={s.replyBtn}>
                        <Text style={s.replyBtnText}>↩</Text>
                      </TouchableOpacity>
                    </View>

                    {reactionTarget === item.id && (
                      <View style={[s.reactionPicker, isMe && s.reactionPickerMe]}>
                        {QUICK_REACTIONS.map(r => (
                          <TouchableOpacity key={r} onPress={() => setReactionTarget(null)} style={s.reactionOpt}>
                            <Text style={s.reactionEmoji}>{r}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </Pressable>
              )
            }}
          />
        )}

        {replyTo && (
          <View style={s.replyBar}>
            <Text style={s.replyBarText} numberOfLines={1}>↩ Replying: {replyTo.content}</Text>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Text style={s.replyBarClose}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.inputRow}>
          <TouchableOpacity style={s.mediaBtn} onPress={showImageOptions} disabled={uploading}>
            {uploading
              ? <ActivityIndicator color={GREEN} size="small" />
              : <Text style={s.mediaBtnText}>📷</Text>
            }
          </TouchableOpacity>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message..."
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[s.sendBtn, !draft.trim() && s.sendBtnOff]}
            onPress={sendMessage}
            disabled={!draft.trim()}
          >
            <Text style={s.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const ORANGE = '#FF6B35'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 15, color: GRAY, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8', gap: 8 },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: GREEN, lineHeight: 36, marginTop: -4 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 15, fontWeight: '700', color: '#2C2C2A' },
  headerSub: { fontSize: 11, color: GRAY },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E24B4A' },
  messageList: { padding: 16, gap: 10, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  avatarAgent: { backgroundColor: '#FFF0EB', borderWidth: 1.5, borderColor: ORANGE },
  avatarText: { fontSize: 15 },
  bubbleCol: { maxWidth: '75%' },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3, marginLeft: 4 },
  senderName: { fontSize: 11, color: GRAY, fontWeight: '500' },
  agentBadge: { backgroundColor: ORANGE, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  agentBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  replyPreview: { backgroundColor: '#F1EFE8', borderLeftWidth: 3, borderLeftColor: PURPLE, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 3 },
  replyPreviewMe: { borderLeftColor: '#fff' },
  replyPreviewText: { fontSize: 11, color: GRAY },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, overflow: 'hidden' },
  bubbleMe: { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#E0DED8' },
  bubbleAgent: { backgroundColor: '#FFF8F5', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#FFD4C2' },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: '#fff' },
  bubbleTextThem: { color: '#2C2C2A' },
  msgImage: { width: 220, height: 220, borderRadius: 12 },
  msgActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, marginLeft: 4 },
  msgActionsMe: { flexDirection: 'row-reverse', marginLeft: 0, marginRight: 4 },
  timeText: { fontSize: 10, color: GRAY },
  replyBtn: { padding: 2 },
  replyBtnText: { fontSize: 14, color: GRAY },
  systemMsg: { alignItems: 'center', marginVertical: 8 },
  systemText: { fontSize: 12, color: GRAY, backgroundColor: '#F1EFE8', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  reactionPicker: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 20, padding: 6, gap: 4, marginTop: 4, borderWidth: 0.5, borderColor: '#E0DED8', elevation: 4 },
  reactionPickerMe: { alignSelf: 'flex-end' },
  reactionOpt: { padding: 4 },
  reactionEmoji: { fontSize: 20 },
  replyBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1EFE8', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 0.5, borderColor: '#E0DED8' },
  replyBarText: { flex: 1, fontSize: 12, color: PURPLE },
  replyBarClose: { fontSize: 16, color: GRAY, paddingLeft: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  mediaBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  mediaBtnText: { fontSize: 20 },
  input: { flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
