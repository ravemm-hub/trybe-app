import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, Alert, ScrollView, TextInput, Modal, FlatList,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'

type Member = {
  user_id: string
  role: string
  joined_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

type JoinRequest = {
  id: string
  user_id: string
  status: string
  answers: string | null
  created_at: string
  profile?: { display_name: string | null; username: string; avatar_char: string | null }
}

export default function LobbyScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [group, setGroup] = useState<any>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isMember, setIsMember] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const [myRequest, setMyRequest] = useState<JoinRequest | null>(null)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [answers, setAnswers] = useState('')
  const [showRequests, setShowRequests] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    const { data: groupData } = await supabase.from('groups').select('*').eq('id', id).single()
    if (groupData) setGroup(groupData)
    const { data: membersData } = await supabase.from('group_members').select('*, profile:profiles(display_name, username, avatar_char)').eq('group_id', id)
    if (membersData) {
      setMembers(membersData as Member[])
      const me = membersData.find((m: Member) => m.user_id === user.id)
      if (me) { setIsMember(true); if (me.role === 'admin') setIsAdmin(true) }
    }
    const { data: requests } = await supabase.from('join_requests').select('*').eq('group_id', id)
    if (requests) {
      const enriched = await Promise.all(requests.map(async (r: JoinRequest) => {
        const { data: profile } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', r.user_id).single()
        return { ...r, profile: profile || undefined }
      }))
      setJoinRequests(enriched)
      const myReq = enriched.find((r: JoinRequest) => r.user_id === user.id)
      if (myReq) setMyRequest(myReq)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase.channel(`lobby:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups', filter: `id=eq.${id}` }, (payload) => {
        setGroup(payload.new)
        if (payload.new.status === 'open') {
          router.replace({ pathname: '/chat', params: { id, name: payload.new.name, members: payload.new.member_count.toString() } })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'join_requests', filter: `group_id=eq.${id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, router, load])

  const joinPublic = async () => {
    if (!userId) return
    setJoining(true)
    await supabase.from('group_members').insert({ group_id: id, user_id: userId, role: 'member' })
    await supabase.from('groups').update({ member_count: (group?.member_count || 0) + 1 }).eq('id', id)
    setIsMember(true)
    setJoining(false)
  }

  const sendJoinRequest = async () => {
    if (!userId) return
    setJoining(true)
    await supabase.from('join_requests').insert({ group_id: id, user_id: userId, answers: answers.trim() || null })
    setShowRequestForm(false); setAnswers('')
    await load()
    setJoining(false)
  }

  const approveRequest = async (request: JoinRequest) => {
    await supabase.from('join_requests').update({ status: 'approved' }).eq('id', request.id)
    await supabase.from('group_members').insert({ group_id: id, user_id: request.user_id, role: 'member' })
    await supabase.from('groups').update({ member_count: (group?.member_count || 0) + 1 }).eq('id', id)
    await load()
  }

  const rejectRequest = async (request: JoinRequest) => {
    await supabase.from('join_requests').update({ status: 'rejected' }).eq('id', request.id)
    await load()
  }

  const togglePrivacy = async () => {
    const newValue = !group?.is_private
    await supabase.from('groups').update({ is_private: newValue }).eq('id', id)
    setGroup((prev: any) => ({ ...prev, is_private: newValue }))
    Alert.alert(newValue ? '🔒 Now Private' : '🌐 Now Public', newValue ? 'New members need approval.' : 'Anyone can join instantly.')
  }

  const openChat = () => {
    router.replace({ pathname: '/chat', params: { id, name: group?.name || name, members: group?.member_count?.toString() || '0' } })
  }

  if (loading) return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <ActivityIndicator color={GREEN} style={{ marginTop: 60 }} />
    </View>
  )

  const isPrivate = group?.is_private
  const pct = Math.min(100, Math.round(((group?.member_count || 0) / (group?.min_members || 20)) * 100))
  const pendingRequests = joinRequests.filter(r => r.status === 'pending')

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{group?.name || name}</Text>
        {isAdmin && pendingRequests.length > 0 && (
          <TouchableOpacity style={s.requestsBadge} onPress={() => setShowRequests(true)}>
            <Text style={s.requestsBadgeText}>{pendingRequests.length}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.statusCard}>
          <Text style={s.statusEmoji}>{isPrivate ? '🔒' : '🌐'}</Text>
          <Text style={s.statusTitle}>{isPrivate ? 'Private Trybe' : 'Public Trybe'}</Text>
          <Text style={s.statusSub}>{group?.status === 'open' ? 'Chat is LIVE! 🟢' : `Waiting for ${group?.min_members} people to unlock`}</Text>
        </View>

        {group?.status === 'open' ? (
          <TouchableOpacity style={s.openChatBtn} onPress={openChat}>
            <Text style={s.openChatBtnText}>🟢 Enter Chat →</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.progressCard}>
            <View style={s.progressBg}>
              <View style={[s.progressFill, { width: `${pct}%` as any }]} />
            </View>
            <Text style={s.progressText}>{group?.member_count || 0} / {group?.min_members || 20} people</Text>
          </View>
        )}

        {isAdmin && (
          <TouchableOpacity style={s.privacyToggleBtn} onPress={togglePrivacy}>
            <Text style={s.privacyToggleBtnText}>{isPrivate ? '🔒 Private — tap to make Public' : '🌐 Public — tap to make Private'}</Text>
          </TouchableOpacity>
        )}

        {!isMember && !myRequest && (
          <View style={s.joinSection}>
            {isPrivate ? (
              <>
                <Text style={s.joinTitle}>Request to join</Text>
                <Text style={s.joinSub}>The admin will review your request</Text>
                <TouchableOpacity style={s.joinBtn} onPress={() => setShowRequestForm(true)}>
                  <Text style={s.joinBtnText}>📨 Send Join Request</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={s.joinBtn} onPress={joinPublic} disabled={joining}>
                {joining ? <ActivityIndicator color="#fff" /> : <Text style={s.joinBtnText}>⚡ Join Lobby</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}

        {myRequest && !isMember && (
          <View style={s.requestStatus}>
            {myRequest.status === 'pending' && <Text style={s.requestStatusText}>⏳ Your request is pending approval</Text>}
            {myRequest.status === 'approved' && <Text style={[s.requestStatusText, { color: GREEN }]}>✓ Approved!</Text>}
            {myRequest.status === 'rejected' && <Text style={[s.requestStatusText, { color: '#E24B4A' }]}>✗ Request was declined</Text>}
          </View>
        )}

        {isAdmin && pendingRequests.length > 0 && (
          <TouchableOpacity style={s.adminAlert} onPress={() => setShowRequests(true)}>
            <Text style={s.adminAlertText}>📨 {pendingRequests.length} pending request{pendingRequests.length > 1 ? 's' : ''} — tap to review</Text>
          </TouchableOpacity>
        )}

        <Text style={s.membersTitle}>In the lobby ({members.length})</Text>
        {members.map(m => (
          <View key={m.user_id} style={s.memberRow}>
            <View style={s.memberAvatar}>
              <Text style={s.memberAvatarText}>{m.profile?.avatar_char || m.profile?.display_name?.[0] || '?'}</Text>
            </View>
            <Text style={s.memberName}>{m.profile?.display_name || m.profile?.username || 'Unknown'}</Text>
            {m.role === 'admin' && <View style={s.adminBadge}><Text style={s.adminBadgeText}>admin</Text></View>}
          </View>
        ))}
      </ScrollView>

      <Modal visible={showRequestForm} animationType="slide" onRequestClose={() => setShowRequestForm(false)}>
        <View style={[s.modalContainer, { paddingTop: insets.top }]}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowRequestForm(false)}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Join Request</Text>
            <TouchableOpacity onPress={sendJoinRequest} disabled={joining}>
              {joining ? <ActivityIndicator color={GREEN} /> : <Text style={s.modalSend}>Send</Text>}
            </TouchableOpacity>
          </View>
          <View style={s.modalBody}>
            <Text style={s.modalLabel}>WHY DO YOU WANT TO JOIN?</Text>
            <Text style={s.modalSub}>Introduce yourself briefly (optional)</Text>
            <TextInput style={s.modalInput} value={answers} onChangeText={setAnswers} placeholder="e.g. I live in this neighborhood..." placeholderTextColor="#B4B2A9" multiline maxLength={200} autoFocus />
          </View>
        </View>
      </Modal>

      <Modal visible={showRequests} animationType="slide" onRequestClose={() => setShowRequests(false)}>
        <View style={[s.modalContainer, { paddingTop: insets.top }]}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setShowRequests(false)}><Text style={s.modalCancel}>Close</Text></TouchableOpacity>
            <Text style={s.modalTitle}>Join Requests</Text>
            <View style={{ width: 60 }} />
          </View>
          <FlatList
            data={pendingRequests}
            keyExtractor={r => r.id}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: GRAY, padding: 32 }}>No pending requests</Text>}
            renderItem={({ item }) => (
              <View style={s.requestCard}>
                <View style={s.requestHeader}>
                  <View style={s.memberAvatar}><Text style={s.memberAvatarText}>{item.profile?.avatar_char || item.profile?.display_name?.[0] || '?'}</Text></View>
                  <Text style={s.memberName}>{item.profile?.display_name || item.profile?.username || 'Unknown'}</Text>
                </View>
                {item.answers && <Text style={s.requestAnswers}>"{item.answers}"</Text>}
                <View style={s.requestActions}>
                  <TouchableOpacity style={s.approveBtn} onPress={() => approveRequest(item)}>
                    <Text style={s.approveBtnText}>✓ Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.rejectBtn} onPress={() => rejectRequest(item)}>
                    <Text style={s.rejectBtnText}>✗ Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8', gap: 8 },
  back: { fontSize: 32, color: GREEN, lineHeight: 36, marginTop: -4 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  requestsBadge: { backgroundColor: '#E24B4A', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  requestsBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  content: { padding: 20, gap: 16 },
  statusCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 0.5, borderColor: '#E0DED8' },
  statusEmoji: { fontSize: 40, marginBottom: 8 },
  statusTitle: { fontSize: 18, fontWeight: '700', color: '#2C2C2A', marginBottom: 4 },
  statusSub: { fontSize: 14, color: GRAY, textAlign: 'center' },
  openChatBtn: { backgroundColor: GREEN, borderRadius: 14, padding: 16, alignItems: 'center' },
  openChatBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  progressCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: '#E0DED8' },
  progressBg: { height: 8, backgroundColor: '#F1EFE8', borderRadius: 4, marginBottom: 8 },
  progressFill: { height: 8, backgroundColor: PURPLE, borderRadius: 4, minWidth: 8 },
  progressText: { fontSize: 13, color: PURPLE, fontWeight: '600', textAlign: 'center' },
  privacyToggleBtn: { backgroundColor: '#F1EFE8', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#E0DED8' },
  privacyToggleBtnText: { fontSize: 14, fontWeight: '600', color: '#2C2C2A' },
  joinSection: { backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 0.5, borderColor: '#E0DED8', gap: 8 },
  joinTitle: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  joinSub: { fontSize: 13, color: GRAY, textAlign: 'center' },
  joinBtn: { backgroundColor: GREEN, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, alignItems: 'center', width: '100%' },
  joinBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  requestStatus: { backgroundColor: '#F1EFE8', borderRadius: 12, padding: 14, alignItems: 'center' },
  requestStatusText: { fontSize: 14, color: GRAY, fontWeight: '500' },
  adminAlert: { backgroundColor: '#FFF0EB', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FFD4C2' },
  adminAlertText: { fontSize: 14, color: '#CC5500', fontWeight: '600', textAlign: 'center' },
  membersTitle: { fontSize: 13, fontWeight: '700', color: GRAY, letterSpacing: 0.5 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#E0DED8' },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 16 },
  memberName: { flex: 1, fontSize: 14, fontWeight: '500', color: '#2C2C2A' },
  adminBadge: { backgroundColor: '#E1F5EE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  adminBadgeText: { fontSize: 11, color: GREEN, fontWeight: '700' },
  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  modalCancel: { fontSize: 16, color: GRAY },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  modalSend: { fontSize: 16, fontWeight: '700', color: GREEN },
  modalBody: { padding: 20 },
  modalLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginBottom: 6 },
  modalSub: { fontSize: 13, color: GRAY, marginBottom: 12 },
  modalInput: { backgroundColor: '#F1EFE8', borderRadius: 14, padding: 14, fontSize: 15, color: '#2C2C2A', minHeight: 120, textAlignVertical: 'top' },
  requestCard: { backgroundColor: '#F1EFE8', borderRadius: 14, padding: 14 },
  requestHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  requestAnswers: { fontSize: 13, color: '#444441', fontStyle: 'italic', marginBottom: 12, lineHeight: 20 },
  requestActions: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, backgroundColor: GREEN, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  rejectBtn: { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E0DED8' },
  rejectBtnText: { color: GRAY, fontWeight: '600', fontSize: 14 },
})
