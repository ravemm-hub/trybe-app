import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'

type Message = {
  id: string
  user_id: string | null
  type: string
  content: string | null
  created_at: string
  profile?: { display_name: string | null; username: string }
}

export default function ChatScreen() {
  const { id, name, members } = useLocalSearchParams<{ id: string; name: string; members: string }>()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const listRef = useRef<FlatList>(null)

  // Load messages
  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*, profile:profiles(display_name, username)')
      .eq('group_id', id)
      .order('created_at', { ascending: true })
      .limit(80)
    if (data) setMessages(data)
    setLoading(false)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }, [id])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
    loadMessages()
  }, [loadMessages])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `group_id=eq.${id}`,
      }, async (payload) => {
        // Fetch with profile
        const { data } = await supabase
          .from('messages')
          .select('*, profile:profiles(display_name, username)')
          .eq('id', payload.new.id)
          .single()
        if (data) {
          setMessages(prev => [...prev, data])
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  const sendMessage = async () => {
    if (!draft.trim() || !userId) return
    const text = draft.trim()
    setDraft('')
    await supabase.from('messages').insert({
      group_id: id,
      user_id: userId,
      type: 'text',
      content: text,
    })
  }

  const formatTime = (ts: string) => {
    return new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.headerName} numberOfLines={1}>{name}</Text>
          <Text style={s.headerSub}>{members} אנשים פעילים</Text>
        </View>
        <View style={s.liveBadge}>
          <Text style={s.liveText}>LIVE</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={GREEN} size="large" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={s.messageList}
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.emptyText}>אין הודעות עדיין — היה הראשון! 👋</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isMe = item.user_id === userId
              const isSystem = item.type === 'system'
              const displayName = item.profile?.display_name || item.profile?.username || 'משתמש'

              if (isSystem) {
                return (
                  <View style={s.systemMsg}>
                    <Text style={s.systemText}>{item.content}</Text>
                  </View>
                )
              }

              return (
                <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                  {!isMe && (
                    <View style={s.avatar}>
                      <Text style={s.avatarText}>{displayName[0]}</Text>
                    </View>
                  )}
                  <View style={s.bubbleCol}>
                    {!isMe && <Text style={s.senderName}>{displayName}</Text>}
                    <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleThem]}>
                      <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextThem]}>
                        {item.content}
                      </Text>
                    </View>
                    <Text style={[s.timeText, isMe && s.timeTextMe]}>{formatTime(item.created_at)}</Text>
                  </View>
                </View>
              )
            }}
          />
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="כתוב הודעה..."
            placeholderTextColor="#B4B2A9"
            multiline
            maxLength={500}
            textAlign="right"
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
  headerSub: { fontSize: 12, color: GRAY },
  liveBadge: { backgroundColor: '#FCEBEB', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  liveText: { fontSize: 10, fontWeight: '700', color: '#A32D2D', letterSpacing: 0.5 },
  messageList: { padding: 16, gap: 10, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '600', color: PURPLE },
  bubbleCol: { maxWidth: '75%' },
  senderName: { fontSize: 11, color: GRAY, marginBottom: 3, marginLeft: 4 },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 },
  bubbleMe: { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#E0DED8' },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: '#fff' },
  bubbleTextThem: { color: '#2C2C2A' },
  timeText: { fontSize: 10, color: GRAY, marginTop: 3, marginLeft: 4 },
  timeTextMe: { textAlign: 'right', marginRight: 4 },
  systemMsg: { alignItems: 'center', marginVertical: 8 },
  systemText: { fontSize: 12, color: GRAY, backgroundColor: '#F1EFE8', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  input: { flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
