import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, StatusBar, ActivityIndicator, Pressable, Linking, Alert, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { getContactName, getContactNameMap, normalizePhone, loadAndMatchContacts } from '../../src/lib/contacts'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, INVITE_MSG, AGENT_IDS } from '../../src/constants'

type Tab = 'trybes' | 'dms' | 'spaces'

export default function ChatsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('trybes')
  const [userId, setUserId] = useState<string | null>(null)
  const [groups, setGroups] = useState<any[]>([])
  const [dms, setDms] = useState<any[]>([])
  const [spaces, setSpaces] = useState<any[]>([])
  const [contactNames, setContactNames] = useState<Record<string, string>>({})
  const [nameMap, setNameMap] = useState<Record<string, string>>({})
  const [contacts, setContacts] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showSpaceModal, setShowSpaceModal] = useState(false)
  const [spaceTitle, setSpaceTitle] = useState('')
  const [spaceEmoji, setSpaceEmoji] = useState('✦')
  const [creatingSpace, setCreatingSpace] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      try { await loadAndMatchContacts(user.id) } catch {}
      getContactNameMap().then(setNameMap)
      loadAll(user.id)
    })
  }, [])

  // Refresh the lightweight lists when returning to this tab (unread counts, new Trybes/Spaces).
  useFocusEffect(useCallback(() => {
    if (userId) { loadGroups(userId); loadDMs(userId); loadSpaces(userId) }
  }, [userId]))

  // Search all users (to start a chat with anyone) when the search box has text.
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) { setSearchResults([]); return }
    let active = true
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase.from('profiles')
          .select('id, display_name, username, avatar_char')
          .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`)
          .neq('id', userId || '00000000-0000-0000-0000-000000000000')
          .limit(25)
        if (active) setSearchResults((data || []).filter((p: any) => !AGENT_IDS.includes(p.id)))
      } catch {}
    }, 300)
    return () => { active = false; clearTimeout(t) }
  }, [search, userId])

  const loadAll = async (uid: string) => {
    setLoading(true)
    await Promise.all([loadGroups(uid), loadDMs(uid), loadSpaces(uid), loadContacts(uid)])
    setLoading(false)
  }

  const loadGroups = async (uid: string) => {
    try {
      const { data: memberships } = await supabase.from('group_members')
        .select('group_id, last_read_at')
        .eq('user_id', uid)
      if (!memberships?.length) { setGroups([]); return }
      const groupIds = memberships.map((m: any) => m.group_id)
      const lastReadById: Record<string, string> = {}
      for (const m of memberships) lastReadById[m.group_id] = m.last_read_at || new Date(0).toISOString()

      const { data: groupRows } = await supabase.from('groups').select('*').in('id', groupIds)
      if (!groupRows?.length) { setGroups([]); return }

      const items = await Promise.all(groupRows.map(async (g: any) => {
        const lastRead = lastReadById[g.id] || new Date(0).toISOString()
        const { count: unread } = await supabase.from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', g.id).neq('user_id', uid).neq('type', 'system').gt('created_at', lastRead)
        const { data: lastMsg } = await supabase.from('messages')
          .select('content, created_at, type').eq('group_id', g.id)
          .neq('type', 'system').order('created_at', { ascending: false }).limit(1)
        return { ...g, unread: unread || 0, lastMsg: lastMsg?.[0] }
      }))
      items.sort((a, b) => new Date(b.lastMsg?.created_at || b.created_at || 0).getTime() - new Date(a.lastMsg?.created_at || a.created_at || 0).getTime())
      setGroups(items)
    } catch { setGroups([]) }
  }

  const loadSpaces = async (uid: string) => {
    try {
      const { data } = await supabase.from('teeby_spaces')
        .select('*').eq('user_id', uid).order('created_at', { ascending: false })
      setSpaces(data || [])
    } catch { setSpaces([]) }
  }

  const createSpace = async () => {
    if (!spaceTitle.trim() || !userId) return
    setCreatingSpace(true)
    try {
      const { data, error } = await supabase.from('teeby_spaces')
        .insert({ user_id: userId, title: spaceTitle.trim(), emoji: spaceEmoji.trim() || '✦' })
        .select().single()
      if (error || !data) throw error || new Error('Failed to create space')
      setSpaces(prev => [data, ...prev])
      setShowSpaceModal(false)
      setSpaceTitle(''); setSpaceEmoji('✦')
      router.push({ pathname: '/space', params: { id: data.id, title: data.title, emoji: data.emoji } })
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create space')
    } finally { setCreatingSpace(false) }
  }

  const loadDMs = async (uid: string) => {
    const { data } = await supabase.from('dm_messages')
      .select('sender_id, receiver_id, sender_mode, receiver_mode, content, created_at, media_type')
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .order('created_at', { ascending: false })
    if (!data) return
    const seen = new Set<string>()
    const items: any[] = []
    for (const msg of data) {
      const otherId = msg.sender_id === uid ? msg.receiver_id : msg.sender_id
      if (seen.has(otherId) || AGENT_IDS.includes(otherId)) continue
      seen.add(otherId)
      const { data: p } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', otherId).single()
      const { count: unread } = await supabase.from('dm_messages')
        .select('id', { count: 'exact', head: true }).eq('sender_id', otherId).eq('receiver_id', uid).is('read_at', null)
      items.push({ otherId, profile: p, lastMsg: msg, unread: unread || 0, myMode: msg.sender_id === uid ? msg.sender_mode : msg.receiver_mode })
    }
    const names: Record<string, string> = {}
    for (const d of items) { const cn = await getContactName(d.otherId); if (cn) names[d.otherId] = cn }
    setContactNames(names)
    setDms(items)
  }

  const loadContacts = async (uid: string) => {
    try {
      const Contacts = require('expo-contacts')
      const { status } = await Contacts.requestPermissionsAsync()
      if (status !== 'granted') return
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] })
      const list: any[] = []
      for (const c of data) {
        if (!c.name || !c.phoneNumbers?.length) continue
        const phone = c.phoneNumbers[0].number?.replace(/[\s\-\(\)]/g, '') || ''
        if (!phone) continue
        list.push({ id: c.id || phone, name: c.name, phone, initials: c.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase(), onTryber: false })
      }
      const allPhones = [...new Set(list.flatMap((c: any) => { const n = normalizePhone(c.phone); return [c.phone, n, '+972' + n.slice(1), '972' + n.slice(1)] }))]
      const { data: users } = await supabase.from('profiles').select('id, phone, display_name, username').in('phone', allPhones)
      const tryberMap = new Map()
      for (const u of users || []) {
        if (!u.phone) continue
        const n = normalizePhone(u.phone)
        tryberMap.set(u.phone, u); tryberMap.set(n, u); tryberMap.set('+972' + n.slice(1), u)
      }
      const enriched = list.map((c: any) => {
        const n = normalizePhone(c.phone)
        const u = tryberMap.get(c.phone) || tryberMap.get(n) || tryberMap.get('+972' + n.slice(1))
        return { ...c, onTryber: !!u, tryberUserId: u?.id, appName: u?.display_name || u?.username }
      }).sort((a: any, b: any) => (b.onTryber ? 1 : 0) - (a.onTryber ? 1 : 0) || a.name.localeCompare(b.name))
      setContacts(enriched)
    } catch {}
  }

  // Last-message preview that handles media (photo/voice/file) instead of showing blank.
  const preview = (m: any): string => {
    if (!m) return ''
    const t = m.type || m.media_type
    if (t === 'image') return '📷 Photo'
    if (t === 'audio') return '🎤 Voice message'
    if (t === 'file') return '📄 File'
    return m.content || ''
  }

  const fmt = (ts: string) => {
    if (!ts) return ''
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  // Contacts who are NOT on the app — shown at the bottom of Chats to invite.
  const inviteContacts = contacts.filter(c => !c.onTryber)
  const searching = !!search.trim()
  const groupMatches = searching ? groups.filter(g => (g.name || '').toLowerCase().includes(search.trim().toLowerCase())) : []

  if (loading) return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <Text style={s.logo}>tryber</Text>
        {tab === 'spaces'
          ? <TouchableOpacity style={s.createBtn} onPress={() => { setSpaceTitle(''); setSpaceEmoji('✦'); setShowSpaceModal(true) }}>
              <Text style={s.createBtnText}>+ Space</Text>
            </TouchableOpacity>
          : <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
              <Text style={s.createBtnText}>+ Trybe</Text>
            </TouchableOpacity>}
      </View>

      <View style={s.searchRow}>
        <TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="🔍 Search people or Trybes..." placeholderTextColor={GRAY} autoCapitalize="none" />
      </View>

      {!searching && (
        <View style={s.tabs}>
          {(['trybes', 'dms', 'spaces'] as Tab[]).map(t => (
            <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive]}>
                {t === 'trybes' ? `Trybes${groups.length > 0 ? ` (${groups.length})` : ''}`
                  : t === 'dms' ? `Chats${dms.length > 0 ? ` (${dms.length})` : ''}`
                  : `My Spaces${spaces.length > 0 ? ` (${spaces.length})` : ''}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {searching && (
        <FlatList
          data={searchResults}
          keyExtractor={p => p.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={groupMatches.length > 0 ? (
            <View>
              <View style={s.sectionHeader}><Text style={s.sectionHeaderText}>TRYBES</Text></View>
              {groupMatches.map(g => (
                <Pressable key={g.id} style={s.row} onPress={() => router.push({ pathname: '/chat', params: { id: g.id, name: g.name, members: String(g.member_count || 0) } })}>
                  <View style={s.groupAvatar}><Text style={s.groupAvatarText}>{g.name?.[0] || '⚡'}</Text></View>
                  <View style={s.rowInfo}><Text style={s.rowName} numberOfLines={1}>{g.name}</Text><Text style={s.rowSub}>{g.member_count || 0} members</Text></View>
                </Pressable>
              ))}
              <View style={s.sectionHeader}><Text style={s.sectionHeaderText}>PEOPLE</Text></View>
            </View>
          ) : (<View style={s.sectionHeader}><Text style={s.sectionHeaderText}>PEOPLE</Text></View>)}
          ListEmptyComponent={groupMatches.length === 0 ? <View style={s.empty}><Text style={s.emptySub}>No people found</Text></View> : null}
          renderItem={({ item: p }) => {
            const dn = nameMap[p.id] || p.display_name || p.username || 'User'
            return (
              <Pressable style={s.row} onPress={() => router.push({ pathname: '/dm', params: { userId: p.id, userName: dn, myMode: 'lit', myAvatar: '💬', isAgent: '0' } })}>
                <View style={s.dmAvatar}><Text style={s.dmAvatarText}>{p.avatar_char || dn[0] || '?'}</Text></View>
                <View style={s.rowInfo}><Text style={s.rowName} numberOfLines={1}>{dn}</Text><Text style={s.rowSub}>@{p.username || 'user'}</Text></View>
                <Text style={s.msgBtnText}>💬 Message</Text>
              </Pressable>
            )
          }}
        />
      )}

      {!searching && tab === 'trybes' && (
        <FlatList data={groups} keyExtractor={g => g.id}
          contentContainerStyle={groups.length === 0 ? { flex: 1 } : {}}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>⚡</Text><Text style={s.emptyTitle}>No Trybes yet</Text><TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/create')}><Text style={s.emptyBtnText}>Create a Trybe</Text></TouchableOpacity></View>}
          renderItem={({ item: g }) => (
            <Pressable style={s.row} onPress={() => router.push({ pathname: '/chat', params: { id: g.id, name: g.name, members: String(g.member_count || 0) } })}>
              <View style={[s.groupAvatar, g.status === 'open' && s.groupAvatarLive]}>
                <Text style={s.groupAvatarText}>{g.name?.[0] || '⚡'}</Text>
                {g.status === 'open' && <View style={s.liveDot} />}
              </View>
              <View style={s.rowInfo}>
                <View style={s.rowTop}>
                  <Text style={s.rowName} numberOfLines={1}>{g.name}</Text>
                  {g.lastMsg && <Text style={s.rowTime}>{fmt(g.lastMsg.created_at)}</Text>}
                </View>
                <Text style={s.rowSub} numberOfLines={1}>{preview(g.lastMsg) || `${g.member_count || 0} members`}</Text>
              </View>
              {g.unread > 0 && <View style={s.unread}><Text style={s.unreadText}>{g.unread > 99 ? '99+' : g.unread}</Text></View>}
            </Pressable>
          )} />
      )}

      {!searching && tab === 'dms' && (
        <FlatList data={dms} keyExtractor={d => d.otherId}
          contentContainerStyle={(dms.length === 0 && inviteContacts.length === 0) ? { flex: 1 } : {}}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>💬</Text><Text style={s.emptyTitle}>No chats yet</Text><Text style={s.emptySub}>Find people on Explore</Text></View>}
          ListFooterComponent={inviteContacts.length > 0 ? (
            <View>
              <View style={s.sectionHeader}><Text style={s.sectionHeaderText}>📇 Invite from your contacts</Text></View>
              {inviteContacts.slice(0, 100).map(c => (
                <View key={c.id} style={s.contactRow}>
                  <View style={s.cAvatar}><Text style={s.cInitials}>{c.initials}</Text></View>
                  <View style={s.cInfo}>
                    <Text style={s.cName}>{c.name}</Text>
                    <Text style={s.cPhone}>{c.phone}</Text>
                  </View>
                  <TouchableOpacity style={s.inviteBtn} onPress={() => Linking.openURL('whatsapp://send?phone=' + c.phone + '&text=' + encodeURIComponent(INVITE_MSG)).catch(() => {})}>
                    <Text style={s.inviteBtnText}>Invite</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
          renderItem={({ item: d }) => {
            const displayName = contactNames[d.otherId] || d.profile?.display_name || d.profile?.username || 'User'
            return (
              <Pressable style={s.row} onPress={() => router.push({ pathname: '/dm', params: { userId: d.otherId, userName: displayName, myMode: d.myMode || 'lit', myAvatar: '💬', isAgent: '0' } })}>
                <View style={s.dmAvatar}><Text style={s.dmAvatarText}>{d.profile?.avatar_char || displayName[0] || '?'}</Text></View>
                <View style={s.rowInfo}>
                  <View style={s.rowTop}>
                    <Text style={s.rowName} numberOfLines={1}>{displayName}</Text>
                    {d.lastMsg && <Text style={s.rowTime}>{fmt(d.lastMsg.created_at)}</Text>}
                  </View>
                  {contactNames[d.otherId] && contactNames[d.otherId] !== d.profile?.display_name && (
                    <Text style={s.rowAppName}>App: {d.profile?.display_name}</Text>
                  )}
                  <Text style={s.rowSub} numberOfLines={1}>{preview(d.lastMsg)}</Text>
                </View>
                {d.unread > 0 && <View style={s.unread}><Text style={s.unreadText}>{d.unread}</Text></View>}
              </Pressable>
            )
          }} />
      )}

      {!searching && tab === 'spaces' && (
        <FlatList data={spaces} keyExtractor={sp => sp.id}
          contentContainerStyle={spaces.length === 0 ? { flex: 1 } : {}}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>✦</Text>
              <Text style={s.emptyTitle}>No Spaces yet</Text>
              <Text style={s.emptySub}>Private topic-based chats with Teeby</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => { setSpaceTitle(''); setSpaceEmoji('✦'); setShowSpaceModal(true) }}>
                <Text style={s.emptyBtnText}>Create a Space</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item: sp }) => (
            <Pressable style={s.row} onPress={() => router.push({ pathname: '/space', params: { id: sp.id, title: sp.title, emoji: sp.emoji } })}>
              <View style={s.spaceAvatar}><Text style={s.spaceAvatarText}>{sp.emoji || '✦'}</Text></View>
              <View style={s.rowInfo}>
                <Text style={s.rowName} numberOfLines={1}>{sp.title}</Text>
                <Text style={s.rowSub} numberOfLines={1}>Chat with Teeby ✦</Text>
              </View>
            </Pressable>
          )} />
      )}


      <Modal visible={showSpaceModal} transparent animationType="fade" onRequestClose={() => setShowSpaceModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>✦ New Space</Text>
            <Text style={s.modalSub}>A private topic-based chat with Teeby</Text>
            <View style={s.spaceForm}>
              <TextInput style={s.emojiInput} value={spaceEmoji} onChangeText={t => setSpaceEmoji(t.slice(0, 2))} placeholder="✦" placeholderTextColor={GRAY} textAlign="center" />
              <TextInput style={s.titleInput} value={spaceTitle} onChangeText={setSpaceTitle} placeholder="Title (e.g. Trip planning)" placeholderTextColor={GRAY} maxLength={50} autoFocus />
            </View>
            <TouchableOpacity style={[s.verifyBtn, (!spaceTitle.trim() || creatingSpace) && { opacity: 0.4 }]} onPress={createSpace} disabled={!spaceTitle.trim() || creatingSpace}>
              {creatingSpace ? <ActivityIndicator color="#fff" /> : <Text style={s.verifyBtnText}>Create Space</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSpaceModal(false)} style={{ marginTop: 12 }}>
              <Text style={{ color: GRAY, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  logo: { fontSize: 28, fontWeight: '800', color: PRIMARY, letterSpacing: -0.5 },
  createBtn: { backgroundColor: PRIMARY, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  tabs: { flexDirection: 'row', backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: PRIMARY },
  tabBtnText: { fontSize: 13, color: GRAY, fontWeight: '500' },
  tabBtnTextActive: { color: PRIMARY, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  groupAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: BORDER, position: 'relative' },
  groupAvatarLive: { borderColor: LIVE },
  groupAvatarText: { fontSize: 22 },
  liveDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: LIVE, borderWidth: 2, borderColor: CARD },
  dmAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  dmAvatarText: { fontSize: 22 },
  spaceAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: PRIMARY },
  spaceAvatarText: { fontSize: 24 },
  rowInfo: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  rowName: { fontSize: 15, fontWeight: '600', color: TEXT, flex: 1, marginRight: 8 },
  rowTime: { fontSize: 11, color: GRAY },
  rowAppName: { fontSize: 11, color: GRAY, fontStyle: 'italic' },
  rowSub: { fontSize: 13, color: GRAY },
  unread: { minWidth: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadText: { fontSize: 10, color: PRIMARY, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: TEXT, marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY },
  emptyBtn: { backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20, marginTop: 16 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  searchRow: { padding: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  searchInput: { backgroundColor: BG, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: TEXT },
  statsBar: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#E8F5E9' },
  statsText: { fontSize: 13 },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8, backgroundColor: BG },
  sectionHeaderText: { fontSize: 12, fontWeight: '700', color: GRAY, letterSpacing: 0.5 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  cAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', position: 'relative', borderWidth: 1, borderColor: BORDER },
  cAvatarTryber: { backgroundColor: '#E8F5E9', borderColor: LIVE, borderWidth: 2 },
  cInitials: { fontSize: 16, fontWeight: '700', color: TEXT },
  onTryberDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: LIVE, borderWidth: 2, borderColor: CARD },
  cInfo: { flex: 1 },
  cName: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 1 },
  cAppName: { fontSize: 11, color: GRAY, fontStyle: 'italic', marginBottom: 1 },
  cPhone: { fontSize: 12, color: GRAY },
  msgBtn: { backgroundColor: '#E8F5E9', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  msgBtnText: { fontSize: 12, color: LIVE, fontWeight: '600' },
  inviteBtn: { backgroundColor: '#EEF0FF', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  inviteBtnText: { fontSize: 12, color: PRIMARY, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard: { backgroundColor: CARD, borderRadius: 24, padding: 24, width: '100%' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: TEXT, textAlign: 'center', marginBottom: 6 },
  modalSub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 20 },
  spaceForm: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  emojiInput: { width: 56, backgroundColor: BG, borderRadius: 14, paddingVertical: 14, fontSize: 24, color: TEXT, borderWidth: 1, borderColor: BORDER },
  titleInput: { flex: 1, backgroundColor: BG, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: BORDER },
  verifyBtn: { backgroundColor: PRIMARY, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  verifyBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
