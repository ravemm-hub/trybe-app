import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Pressable, Image, Alert, Modal, StatusBar,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
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

type Message = {
  id: string
  user_id: string | null
  type: string
  content: string | null
  media_url: string | null
  reply_to_id: string | null
  reply_preview: string | null
  created_at: string
  deleted?: boolean
  edited?: boolean
  sender_mode?: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

export default function ChatScreen() {
  const { id, name, members } = useLocalSearchParams<{ id: string; name: string; members: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState(parseInt(members || '0'))
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null)
  const [editingMsg, setEditingMsg] = useState<Message | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAgentSettings, setShowAgentSettings] = useState(false)
  const [agentEnabled, setAgentEnabled] = useState(true)
  const [agentInstructions, setAgentInstructions] = useState('')
  const [savingAgent, setSavingAgent] = useState(false)
  const [senderMode, setSenderMode] = useState<'lit' | 'ghost'>('lit')
  const [blockedUsers, setBlockedUsers] = useState<string[]>([])
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
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      const { data: member } = await supabase.from('group_members').select('role').eq('group_id', id).eq('user_id', user.id).single()
      if (member?.role === 'admin') setIsAdmin(true)
      const { data: blocks } = await supabase.from('group_blocks').select('blocked_user_id').eq('group_id', id)
      if (blocks) setBlockedUsers(blocks.map((b: any) => b.blocked_user_id))
    })
    loadMessages()
    loadAgentSettings()
  }, [loadMessages])

  const loadAgentSettings = async () => {
    const { data } = await supabase.from('group_agents').select('*').eq('group_id', id).single()
    if (data) { setAgentEnabled(data.enabled); setAgentInstructions(data.instructions || '') }
  }

  const saveAgentSettings = async () => {
    setSavingAgent(true)
    await supabase.from('group_agents').upsert({ group_id: id, enabled: agentEnabled, instructions: agentInstructions.trim() || null }, { onConflict: 'group_id' })
    setSavingAgent(false)
    setShowAgentSettings(false)
    Alert.alert('✓ Saved', 'Agent settings updated.')
  }

  useEffect(() => {
    const channel = supabase.channel(`chat:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${id}` },
        async (payload) => {
          const newMsg = payload.new as Message
          const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', newMsg.user_id).single()
          setMessages(prev => [...prev, { ...newMsg, profile: profile || undefined }])
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `group_id=eq.${id}` },
        (payload) => setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m)))
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
      sender_mode: senderMode,
      reply_to_id: replyTo?.id || null,
      reply_preview: replyTo?.content ? replyTo.content.slice(0, 60) : null,
    })
    setReplyTo(null)
  }

  const reportMessage = async (msg: Message) => {
    if (!userId) return
    const { error } = await supabase.from('message_reports').insert({ message_id: msg.id, reporter_id: userId, group_id: id, reason: 'inappropriate' })
    if (error?.code === '23505') Alert.alert('Already reported', 'You already reported this message.')
    else Alert.alert('✓ Reported', 'Admins will review this.')
    setShowMenu(false); setSelectedMsg(null)
  }

  const blockUser = async (targetUserId: string) => {
    await supabase.from('group_blocks').insert({ group_id: id, blocked_user_id: targetUserId, blocked_by: userId })
    await supabase.from('group_members').delete().eq('group_id', id).eq('user_id', targetUserId)
    setBlockedUsers(prev => [...prev, targetUserId])
    setShowMenu(false); setSelectedMsg(null)
    Alert.alert('✓ Blocked', 'User removed from group.')
  }

  const deleteMessage = async (msg: Message) => {
    await supabase.from('messages').update({ content: null, deleted: true }).eq('id', msg.id)
    setShowMenu(false); setSelectedMsg(null)
  }

  const startEdit = (msg: Message) => {
    setEditingMsg(msg); setEditDraft(msg.content || '')
    setShowMenu(false); setSelectedMsg(null)
  }

  const saveEdit = async () => {
    if (!editingMsg || !editDraft.trim()) return
    await supabase.from('messages').update({ content: editDraft.trim(), edited: true }).eq('id', editingMsg.id)
    setEditingMsg(null); setEditDraft('')
  }

  const pickImage = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return
    const result = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 })
    if (result.canceled || !result.assets?.[0]) return
    setUploading(true)
    try {
      const asset = result.assets[0]
      const ext = asset.uri.split('.').pop() || 'jpg'
      const filename = `${Date.now()}.${ext}`
      const formData = new FormData()
      formData.append('file', { uri: asset.uri, type: `image/${ext}`, name: filename } as any)
      await supabase.storage.from('chat-media').upload(`groups/${id}/${filename}`, formData)
      const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(`groups/${id}/${filename}`)
      await supabase.from('messages').insert({ group_id: id, user_id: userId, type: 'image', media_url: publicUrl, sender_mode: senderMode })
    } catch (err: any) { Alert.alert('Upload failed', err.message) }
    finally { setUploading(false) }
  }

  const showImageOptions = () => {
    Alert.alert('Add photo', '', [
      { text: '📷 Camera', onPress: () => pickImage(true) },
      { text: '🖼️ Gallery', onPress: () => pickImage(false) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  const isAgentMsg = (uid: string | null) => uid && AGENT_IDS.includes(uid)
  const canEdit = (msg: Message) => msg.user_id === userId && Date.now() - new Date(msg.created_at).getTime() < 15 * 60 * 1000 && !msg.deleted

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.headerName} numberOfLines={1}>{name}</Text>
          <Text style={s.headerSub}>{memberCount} people · LIVE</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity style={s.settingsBtn} onPress={() => setShowAgentSettings(true)}>
            <Text style={s.settingsBtnText}>⚙️</Text>
          </TouchableOpacity>
        )}
        <View style={s.liveDot} />
      </View>

      {/* Agent Settings Modal */}
      <Modal visible={showAgentSettings} animationType="slide" onRequestClose={() => setShowAgentSettings(false)}>
        <View style={[s.agentModal, { paddingTop: insets.top }]}>
          <View style={s.agentModalHeader}>
            <TouchableOpacity onPress={() => setShowAgentSettings(false)}><Text style={s.agentModalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.agentModalTitle}>Group Agent ✦</Text>
            <TouchableOpacity onPress={saveAgentSettings} disabled={savingAgent}>
              {savingAgent ? <ActivityIndicator color={GREEN} /> : <Text style={s.agentModalSave}>Save</Text>}
            </TouchableOpacity>
          </View>
          <View style={s.agentModalBody}>
            <View style={s.agentToggleRow}>
              <View>
                <Text style={s.agentToggleTitle}>AI Agent Active</Text>
                <Text style={s.agentToggleSub}>Agent participates in group chat</Text>
              </View>
              <TouchableOpacity style={[s.toggle, agentEnabled && s.toggleOn]} onPress={() => setAgentEnabled(!agentEnabled)}>
                <View style={[s.toggleThumb, agentEnabled && s.toggleThumbOn]} />
              </TouchableOpacity>
            </View>
            <Text style={s.agentInstructionsLabel}>AGENT INSTRUCTIONS</Text>
            <TextInput style={s.agentInstructionsInput} value={agentInstructions} onChangeText={setAgentInstructions} placeholder="e.g. Speak only English, welcome new members..." placeholderTextColor="#B4B2A9" multiline maxLength={500} />
            <Text style={s.agentPresetsLabel}>QUICK PRESETS</Text>
            {[
              { label: '🏘️ Neighborhood', text: 'Help neighbors with local info, businesses, and services. Keep a friendly tone.' },
              { label: '🎵 Event/Party', text: 'Share schedule, answer logistics questions, keep the energy high!' },
              { label: '🎓 Study Group', text: 'Help with questions, share reminders, keep discussions on topic.' },
              { label: '💼 Work Team', text: 'Professional tone. Help with task coordination.' },
            ].map(preset => (
              <TouchableOpacity key={preset.label} style={s.presetBtn} onPress={() => setAgentInstructions(preset.text)}>
                <Text style={s.presetBtnText}>{preset.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Message action menu */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <Pressable style={s.menuOverlay} onPress={() => setShowMenu(false)}>
          <View style={[s.menu, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity style={s.menuItem} onPress={() => { setReplyTo(selectedMsg!); setShowMenu(false); setSelectedMsg(null) }}>
              <Text style={s.menuItemText}>↩ Reply</Text>
            </TouchableOpacity>
            {selectedMsg && canEdit(selectedMsg) && (
              <TouchableOpacity style={s.menuItem} onPress={() => startEdit(selectedMsg)}>
                <Text style={s.menuItemText}>✏️ Edit</Text>
              </TouchableOpacity>
            )}
            {selectedMsg?.user_id === userId && !selectedMsg?.deleted && (
              <TouchableOpacity style={s.menuItem} onPress={() => deleteMessage(selectedMsg)}>
                <Text style={[s.menuItemText, { color: '#E24B4A' }]}>🗑️ Delete</Text>
              </TouchableOpacity>
            )}
            {selectedMsg?.user_id !== userId && (
              <TouchableOpacity style={s.menuItem} onPress={() => reportMessage(selectedMsg!)}>
                <Text style={[s.menuItemText, { color: '#FF6B35' }]}>🚩 Report</Text>
              </TouchableOpacity>
            )}
            {isAdmin && selectedMsg?.user_id !== userId && selectedMsg?.user_id && !AGENT_IDS.includes(selectedMsg.user_id) && (
              <TouchableOpacity style={s.menuItem} onPress={() => {
                Alert.alert('Block user', 'Remove from group?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Block', style: 'destructive', onPress: () => blockUser(selectedMsg.user_id!) }
                ])
              }}>
                <Text style={[s.menuItemText, { color: '#E24B4A' }]}>🚫 Block from group</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.menuItem} onPress={() => setShowMenu(false)}>
              <Text style={[s.menuItemText, { color: '#888' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 56}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages.filter(m => !blockedUsers.includes(m.user_id || ''))}
            keyExtractor={m => m.id}
            contentContainerStyle={s.messageList}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<View style={s.center}><Text style={s.emptyText}>No messages yet — say hi! 👋</Text></View>}
            renderItem={({ item }) => {
              const isMe = item.user_id === userId
              const isSystem = item.type === 'system'
              const agent = isAgentMsg(item.user_id)
              const isGhost = item.sender_mode === 'ghost'
              const displayName = isGhost && !isMe ? '👻 Anonymous' : (item.profile?.display_name || item.profile?.username || 'Unknown')
              const avatarChar = isGhost && !isMe ? '👻' : (item.profile?.avatar_char || displayName[0] || '?')

              if (isSystem) return <View style={s.systemMsg}><Text style={s.systemText}>{item.content}</Text></View>

              if (item.deleted) return (
                <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                  <View style={s.deletedMsg}><Text style={s.deletedText}>🚫 Message deleted</Text></View>
                </View>
              )

              return (
                <Pressable onLongPress={() => { setSelectedMsg(item); setShowMenu(true) }} style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
                  {!isMe && (
                    <View style={[s.avatar, agent && s.avatarAgent, isGhost && s.avatarGhost]}>
                      <Text style={s.avatarText}>{avatarChar}</Text>
                    </View>
                  )}
                  <View style={s.bubbleCol}>
                    {!isMe && (
                      <View style={s.senderRow}>
                        <Text style={[s.senderName, isGhost && s.senderNameGhost]}>{displayName}</Text>
                        {agent && <View style={s.agentBadge}><Text style={s.agentBadgeText}>AI</Text></View>}
                        {isGhost && !agent && <View style={s.ghostBadge}><Text style={s.ghostBadgeText}>anon</Text></View>}
                      </View>
                    )}
                    {isMe && isGhost && <Text style={s.myGhostLabel}>👻 sent anonymously</Text>}
                    {item.reply_preview && (
                      <View style={[s.replyPreview, isMe && s.replyPreviewMe]}>
                        <Text style={s.replyPreviewText} numberOfLines={1}>↩ {item.reply_preview}</Text>
                      </View>
                    )}
                    <View style={[s.bubble, isMe ? (isGhost ? s.bubbleMeGhost : s.bubbleMe) : agent ? s.bubbleAgent : s.bubbleThem]}>
                      {item.type === 'image' && item.media_url
                        ? <Image source={{ uri: item.media_url }} style={s.msgImage} resizeMode="cover" />
                        : <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextThem]}>{item.content}</Text>
                      }
                    </View>
                    <View style={[s.msgMeta, isMe && s.msgMetaMe]}>
                      <Text style={s.timeText}>{formatTime(item.created_at)}</Text>
                      {item.edited && <Text style={s.editedTag}>· edited</Text>}
                    </View>
                  </View>
                </Pressable>
              )
            }}
          />
        )}

        {replyTo && (
          <View style={s.replyBar}>
            <Text style={s.replyBarText} numberOfLines={1}>↩ {replyTo.content}</Text>
            <TouchableOpacity onPress={() => setReplyTo(null)}><Text style={s.replyBarClose}>✕</Text></TouchableOpacity>
          </View>
        )}

        {editingMsg ? (
          <View style={[s.editBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <Text style={s.editBarLabel}>✏️ Editing</Text>
            <TextInput style={s.editInput} value={editDraft} onChangeText={setEditDraft} autoFocus multiline />
            <View style={s.editActions}>
              <TouchableOpacity onPress={() => setEditingMsg(null)} style={s.editCancel}><Text style={s.editCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveEdit} style={s.editSave}><Text style={s.editSaveText}>Save</Text></TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TouchableOpacity style={s.mediaBtn} onPress={showImageOptions} disabled={uploading}>
              {uploading ? <ActivityIndicator color={GREEN} size="small" /> : <Text style={s.mediaBtnText}>📷</Text>}
            </TouchableOpacity>
            <TextInput
              style={s.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={senderMode === 'ghost' ? '👻 Anonymous message...' : 'Message...'}
              placeholderTextColor="#B4B2A9"
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[s.modeToggle, senderMode === 'ghost' && s.modeToggleGhost]}
              onPress={() => setSenderMode(senderMode === 'lit' ? 'ghost' : 'lit')}
            >
              <Text style={s.modeToggleText}>{senderMode === 'lit' ? '🔥' : '👻'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.sendBtn, !draft.trim() && s.sendBtnOff]} onPress={sendMessage} disabled={!draft.trim()}>
              <Text style={s.sendIcon}>↑</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  )
}

const GREEN = '#1D9E75'
const ORANGE = '#FF6B35'
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
  headerSub: { fontSize: 11, color: GRAY },
  settingsBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  settingsBtnText: { fontSize: 18 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E24B4A' },
  agentModal: { flex: 1, backgroundColor: '#fff' },
  agentModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  agentModalCancel: { fontSize: 16, color: GRAY },
  agentModalTitle: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  agentModalSave: { fontSize: 16, fontWeight: '700', color: GREEN },
  agentModalBody: { padding: 20 },
  agentToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, backgroundColor: '#F1EFE8', borderRadius: 14, padding: 16 },
  agentToggleTitle: { fontSize: 15, fontWeight: '600', color: '#2C2C2A' },
  agentToggleSub: { fontSize: 12, color: GRAY, marginTop: 2 },
  toggle: { width: 48, height: 28, borderRadius: 14, backgroundColor: '#E0DED8', padding: 2 },
  toggleOn: { backgroundColor: GREEN },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  toggleThumbOn: { transform: [{ translateX: 20 }] },
  agentInstructionsLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 10 },
  agentInstructionsInput: { backgroundColor: '#F1EFE8', borderRadius: 14, padding: 14, fontSize: 14, color: '#2C2C2A', minHeight: 100, textAlignVertical: 'top', marginBottom: 20 },
  agentPresetsLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 10 },
  presetBtn: { backgroundColor: '#EEEDFE', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 8 },
  presetBtnText: { fontSize: 14, color: PURPLE, fontWeight: '500' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  menu: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8 },
  menuItem: { paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 0.5, borderColor: '#F1EFE8' },
  menuItemText: { fontSize: 16, color: '#2C2C2A' },
  messageList: { padding: 16, gap: 10, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  avatarAgent: { backgroundColor: '#FFF0EB', borderWidth: 1.5, borderColor: ORANGE },
  avatarGhost: { backgroundColor: '#F1EFE8', borderWidth: 1.5, borderColor: '#B4B2A9' },
  avatarText: { fontSize: 15 },
  bubbleCol: { maxWidth: '75%' },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3, marginLeft: 4 },
  senderName: { fontSize: 11, color: GRAY, fontWeight: '500' },
  senderNameGhost: { color: '#B4B2A9', fontStyle: 'italic' },
  agentBadge: { backgroundColor: ORANGE, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  agentBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  ghostBadge: { backgroundColor: '#F1EFE8', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 0.5, borderColor: '#B4B2A9' },
  ghostBadgeText: { fontSize: 9, color: '#888', fontStyle: 'italic' },
  myGhostLabel: { fontSize: 10, color: '#B4B2A9', marginBottom: 3, textAlign: 'right' },
  replyPreview: { backgroundColor: '#F1EFE8', borderLeftWidth: 3, borderLeftColor: PURPLE, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 3 },
  replyPreviewMe: { borderLeftColor: '#fff' },
  replyPreviewText: { fontSize: 11, color: GRAY },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, overflow: 'hidden' },
  bubbleMe: { backgroundColor: GREEN, borderBottomRightRadius: 4 },
  bubbleMeGhost: { backgroundColor: '#888780', borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 0.5, borderColor: '#E0DED8' },
  bubbleAgent: { backgroundColor: '#FFF8F5', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#FFD4C2' },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: '#fff' },
  bubbleTextThem: { color: '#2C2C2A' },
  msgImage: { width: 220, height: 220, borderRadius: 12 },
  msgMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, marginLeft: 4 },
  msgMetaMe: { flexDirection: 'row-reverse', marginLeft: 0, marginRight: 4 },
  timeText: { fontSize: 10, color: GRAY },
  editedTag: { fontSize: 10, color: GRAY },
  systemMsg: { alignItems: 'center', marginVertical: 8 },
  systemText: { fontSize: 12, color: GRAY, backgroundColor: '#F1EFE8', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
  deletedMsg: { paddingHorizontal: 12, paddingVertical: 8 },
  deletedText: { fontSize: 13, color: GRAY, fontStyle: 'italic' },
  replyBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1EFE8', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 0.5, borderColor: '#E0DED8' },
  replyBarText: { flex: 1, fontSize: 12, color: PURPLE },
  replyBarClose: { fontSize: 16, color: GRAY, paddingLeft: 8 },
  editBar: { backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8', padding: 12 },
  editBarLabel: { fontSize: 11, color: GRAY, marginBottom: 6 },
  editInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#2C2C2A', marginBottom: 8 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  editCancel: { paddingHorizontal: 16, paddingVertical: 8 },
  editCancelText: { fontSize: 14, color: GRAY },
  editSave: { backgroundColor: GREEN, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16 },
  editSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 0.5, borderColor: '#E0DED8' },
  mediaBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center' },
  mediaBtnText: { fontSize: 20 },
  input: { flex: 1, minHeight: 40, maxHeight: 100, backgroundColor: '#F1EFE8', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#2C2C2A' },
  modeToggle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center' },
  modeToggleGhost: { backgroundColor: '#F1EFE8' },
  modeToggleText: { fontSize: 20 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
