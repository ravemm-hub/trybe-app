import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Pressable, RefreshControl, ActivityIndicator,
  Alert, Linking, TextInput,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Contacts from 'expo-contacts'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

const INVITE_MSG = `Hey! Join me on Tryber — The Next Generation of SocialAIsing 🚀\nDownload: https://ravemm-hub.github.io/trybe-app`

type ChatItem = {
  id: string
  type: 'group' | 'dm'
  name: string
  avatar: string
  last_message: string | null
  last_message_at: string | null
  unread: number
  status?: string
  member_count?: number
  min_members?: number
  is_private?: boolean
  other_user_id?: string
}

type Contact = {
  id: string
  name: string
  phone: string
  initials: string
  onTryber: boolean
  tryberUserId?: string
  tryberUsername?: string
  avatar_char?: string
}

export default function ChatsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [activeTab, setActiveTab] = useState<'trybes' | 'chats'>('trybes')
  const [groups, setGroups] = useState<ChatItem[]>([])
  const [dms, setDms] = useState<ChatItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsLoaded, setContactsLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // My groups
      const { data: memberData } = await supabase
        .from('group_members').select('group_id, last_read_at, groups(*)').eq('user_id', user.id)

      const groupItems: ChatItem[] = []
      for (const m of memberData || []) {
        const g = (m as any).groups
        if (!g || g.status === 'archived') continue
        const { data: msgs } = await supabase.from('messages').select('content, created_at').eq('group_id', g.id).eq('type', 'text').order('created_at', { ascending: false }).limit(1)
        let unread = 0
        if (m.last_read_at) {
          const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('group_id', g.id).neq('user_id', user.id).gt('created_at', m.last_read_at)
          unread = count || 0
        }
        groupItems.push({
          id: g.id, type: 'group', name: g.name,
          avatar: g.is_private ? '🔒' : '⚡',
          last_message: msgs?.[0]?.content || null,
          last_message_at: msgs?.[0]?.created_at || g.created_at,
          unread, status: g.status, member_count: g.member_count,
          min_members: g.min_members, is_private: g.is_private,
        })
      }
      groupItems.sort((a, b) => new Date(b.last_message_at || '').getTime() - new Date(a.last_message_at || '').getTime())
      setGroups(groupItems)

      // DMs
      const { data: dmData } = await supabase.from('dm_messages').select('*').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).order('created_at', { ascending: false })
      const dmMap = new Map<string, any>()
      for (const dm of dmData || []) {
        const otherId = dm.sender_id === user.id ? dm.receiver_id : dm.sender_id
        if (!dmMap.has(otherId)) dmMap.set(otherId, dm)
      }
      const dmItems: ChatItem[] = []
      for (const [otherId, lastDm] of dmMap.entries()) {
        const { data: p } = await supabase.from('profiles').select('display_name, username, avatar_char').eq('id', otherId).single()
        const name = p?.display_name || p?.username || 'Unknown'
        dmItems.push({
          id: `dm_${otherId}`, type: 'dm', name,
          avatar: p?.avatar_char || name[0] || '?',
          last_message: lastDm.content, last_message_at: lastDm.created_at,
          unread: 0, other_user_id: otherId,
        })
      }
      setDms(dmItems)
    } catch (err: any) { console.error(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  const loadContacts = useCallback(async () => {
    if (contactsLoaded) return
    setContactsLoading(true)
    try {
      const { status } = await Contacts.requestPermissionsAsync()
      if (status !== 'granted') { setContactsLoading(false); return }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
        sort: Contacts.SortTypes.FirstName,
      })
      const contactList: Contact[] = []
      for (const c of data) {
        if (!c.phoneNumbers?.length || !c.name) continue
        const phone = c.phoneNumbers[0].number?.replace(/[\s\-\(\)]/g, '') || ''
        if (!phone) continue
        const initials = c.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
        contactList.push({ id: c.id || phone, name: c.name, phone, initials, onTryber: false })
      }
      const phones = contactList.map(c => c.phone)
      if (phones.length > 0) {
        const { data: tryberUsers } = await supabase.from('profiles').select('id, username, display_name, phone, avatar_char').in('phone', phones)
        const tryberMap = new Map((tryberUsers || []).map((u: any) => [u.phone, u]))
        const enriched = contactList.map(c => {
          const t = tryberMap.get(c.phone)
          return { ...c, onTryber: !!t, tryberUserId: t?.id, tryberUsername: t?.display_name || t?.username, avatar_char: t?.avatar_char }
        })
        enriched.sort((a, b) => a.onTryber === b.onTryber ? a.name.localeCompare(b.name) : a.onTryber ? -1 : 1)
        setContacts(enriched)
      } else {
        setContacts(contactList)
      }
      setContactsLoaded(true)
    } catch (e) { console.error(e) }
    finally { setContactsLoading(false) }
  }, [contactsLoaded])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    if (activeTab === 'chats') loadContacts()
  }, [activeTab])

  useEffect(() => {
    const channel = supabase.channel('chats-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => loadAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, () => loadAll())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadAll])
const markGroupRead = async (groupId: string) => {
  if (!userId) return
  await supabase.from('group_members').update({ last_read_at: new Date().toISOString() }).eq('group_id', groupId).eq('user_id', userId)
  setGroups(prev => prev.map(g => g.id === groupId ? { ...g, unread: 0 } : g))
}
  const leaveGroup = (item: ChatItem) => {
    Alert.alert('Leave group', `Leave "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        await supabase.from('group_members').delete().eq('group_id', item.id).eq('user_id', userId)
        setGroups(prev => prev.filter(g => g.id !== item.id))
      }}
    ])
  }

  const inviteContact = (contact: Contact) => {
    Alert.alert(`Invite ${contact.name}`, '', [
      { text: '💚 WhatsApp', onPress: () => Linking.openURL(`whatsapp://send?phone=${contact.phone}&text=${encodeURIComponent(INVITE_MSG)}`) },
      { text: '💬 SMS', onPress: () => Linking.openURL(`sms:${contact.phone}?body=${encodeURIComponent(INVITE_MSG)}`) },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  const formatTime = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
    return new Date(ts).toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  const totalUnread = groups.reduce((sum, i) => sum + i.unread, 0)
  const filteredContacts = contacts.filter(c =>
    !contactSearch.trim() ||
    c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.phone.includes(contactSearch)
  )

  const renderGroupRow = (item: ChatItem) => {
    const hasUnread = item.unread > 0
    const isOpen = item.status === 'open'
    return (
      <Pressable
        style={s.row}
        onPress={() => {
          markGroupRead(item.id)
          if (isOpen) router.push({ pathname: '/chat', params: { id: item.id, name: item.name, members: item.member_count?.toString() || '0' } })
          else router.push({ pathname: '/lobby', params: { id: item.id, name: item.name } })
        }}
        onLongPress={() => Alert.alert(item.name, '', [
          { text: '🚪 Leave group', style: 'destructive', onPress: () => leaveGroup(item) },
          { text: 'Cancel', style: 'cancel' }
        ])}
      >
        <View style={[s.avatar, s.avatarGroup]}>
          <Text style={s.avatarText}>{item.avatar}</Text>
        </View>
        <View style={s.rowInfo}>
          <View style={s.rowTop}>
            <Text style={[s.rowName, hasUnread && s.rowNameBold]} numberOfLines={1}>{item.name}</Text>
            {item.last_message_at && <Text style={[s.rowTime, hasUnread && { color: GREEN }]}>{formatTime(item.last_message_at)}</Text>}
          </View>
          <View style={s.rowBottom}>
            <Text style={[s.rowLastMsg, hasUnread && s.rowLastMsgBold]} numberOfLines={1}>
              {item.last_message || (isOpen ? '🟢 Live' : `🟣 ${item.member_count}/${item.min_members} to unlock`)}
            </Text>
            {hasUnread && <View style={s.unreadBadge}><Text style={s.unreadBadgeText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}
          </View>
        </View>
      </Pressable>
    )
  }

  const renderDMRow = (item: ChatItem) => {
    const hasUnread = item.unread > 0
    return (
      <Pressable style={s.row} onPress={() => router.push({ pathname: '/dm', params: { userId: item.other_user_id, userName: item.name, myMode: 'lit', myAvatar: '💬', isAgent: '0' } })}>
        <View style={[s.avatar, s.avatarDM]}>
          <Text style={s.avatarText}>{item.avatar}</Text>
        </View>
        <View style={s.rowInfo}>
          <View style={s.rowTop}>
            <Text style={[s.rowName, hasUnread && s.rowNameBold]} numberOfLines={1}>{item.name}</Text>
            {item.last_message_at && <Text style={s.rowTime}>{formatTime(item.last_message_at)}</Text>}
          </View>
          <Text style={[s.rowLastMsg, hasUnread && s.rowLastMsgBold]} numberOfLines={1}>{item.last_message || 'Start chatting'}</Text>
        </View>
      </Pressable>
    )
  }

  const renderContactRow = (item: Contact) => (
    <View style={s.contactRow}>
      <View style={[s.contactAvatar, item.onTryber && s.contactAvatarTryber]}>
        <Text style={s.contactInitials}>{item.avatar_char || item.initials}</Text>
        {item.onTryber && <View style={s.onTryberDot} />}
      </View>
      <View style={s.contactInfo}>
        <Text style={s.contactName}>{item.name}</Text>
        {item.onTryber
          ? <Text style={s.onTryberLabel}>✦ On Tryber</Text>
          : <Text style={s.contactPhone}>{item.phone}</Text>
        }
      </View>
      {item.onTryber ? (
        <TouchableOpacity style={s.messageBtn} onPress={() => router.push({ pathname: '/dm', params: { userId: item.tryberUserId, userName: item.tryberUsername || item.name, myMode: 'lit', myAvatar: '💬', isAgent: '0' } })}>
          <Text style={s.messageBtnText}>Message</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={s.inviteBtn} onPress={() => inviteContact(item)}>
          <Text style={s.inviteBtnText}>Invite</Text>
        </TouchableOpacity>
      )}
    </View>
  )

  // For chats tab — combine DMs + contacts into one list
  const chatsListData = [
    ...dms.map(d => ({ type: 'dm' as const, data: d })),
    { type: 'divider' as const },
    { type: 'search' as const },
    ...filteredContacts.map(c => ({ type: 'contact' as const, data: c })),
  ]

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.logo}>tryber</Text>
          {totalUnread > 0 && <View style={s.totalUnread}><Text style={s.totalUnreadText}>{totalUnread > 99 ? '99+' : totalUnread}</Text></View>}
        </View>
        <TouchableOpacity style={s.createBtn} onPress={() => router.push('/create')}>
          <Text style={s.createBtnText}>+ Trybe</Text>
        </TouchableOpacity>
      </View>

      {/* 2 Tabs */}
      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tabBtn, activeTab === 'trybes' && s.tabBtnActive]} onPress={() => setActiveTab('trybes')}>
          <Text style={[s.tabBtnText, activeTab === 'trybes' && s.tabBtnTextActive]}>⚡ Trybes {groups.length > 0 ? `(${groups.length})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, activeTab === 'chats' && s.tabBtnActive]} onPress={() => setActiveTab('chats')}>
          <Text style={[s.tabBtnText, activeTab === 'chats' && s.tabBtnTextActive]}>💬 Chats {dms.length > 0 ? `(${dms.length})` : ''}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
      ) : activeTab === 'trybes' ? (
        <FlatList
          data={groups}
          keyExtractor={i => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll() }} tintColor={GREEN} />}
          contentContainerStyle={groups.length === 0 ? s.listEmpty : undefined}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>⚡</Text>
              <Text style={s.emptyTitle}>No trybes yet</Text>
              <Text style={s.emptySub}>Join a Trybe on Explore or create your own</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(tabs)/explore')}>
                <Text style={s.emptyBtnText}>📡 Explore Trybes</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => renderGroupRow(item)}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      ) : (
        <FlatList
          data={chatsListData}
          keyExtractor={(item, i) => item.type === 'dm' ? item.data.id : item.type === 'contact' ? item.data.id : `${item.type}_${i}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll() }} tintColor={GREEN} />}
          renderItem={({ item }) => {
            if (item.type === 'dm') return renderDMRow(item.data)
            if (item.type === 'divider') return (
              <View style={s.sectionDivider}>
                <Text style={s.sectionDividerText}>
                  {contactsLoading ? 'Loading contacts...' : `Contacts · ${contacts.filter(c => c.onTryber).length} on Tryber`}
                </Text>
              </View>
            )
            if (item.type === 'search') return (
              <View style={s.searchRow}>
                <TextInput
                  style={s.searchInput}
                  value={contactSearch}
                  onChangeText={setContactSearch}
                  placeholder="Search contacts..."
                  placeholderTextColor="#B4B2A9"
                />
              </View>
            )
            if (item.type === 'contact') return renderContactRow(item.data)
            return null
          }}
          ItemSeparatorComponent={({ leadingItem }) => {
            if (leadingItem?.type === 'divider' || leadingItem?.type === 'search') return null
            return <View style={[s.separator, { marginLeft: 74 }]} />
          }}
          ListEmptyComponent={null}
        />
      )}
    </View>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { fontSize: 26, fontWeight: '800', color: GREEN, letterSpacing: -1 },
  totalUnread: { backgroundColor: '#E24B4A', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  totalUnreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  createBtn: { backgroundColor: GREEN, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  createBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F1EFE8', alignItems: 'center' },
  tabBtnActive: { backgroundColor: GREEN },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: GRAY },
  tabBtnTextActive: { color: '#fff' },
  listEmpty: { flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyEmoji: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#2C2C2A' },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center' },
  emptyBtn: { backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 20, width: '100%', alignItems: 'center' },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: '#fff' },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarGroup: { backgroundColor: '#E1F5EE' },
  avatarDM: { backgroundColor: '#EEEDFE' },
  avatarText: { fontSize: 22 },
  rowInfo: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  rowName: { fontSize: 15, fontWeight: '500', color: '#2C2C2A', flex: 1 },
  rowNameBold: { fontWeight: '700' },
  rowTime: { fontSize: 11, color: GRAY },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLastMsg: { fontSize: 13, color: GRAY, flex: 1 },
  rowLastMsgBold: { color: '#2C2C2A', fontWeight: '500' },
  unreadBadge: { backgroundColor: GREEN, borderRadius: 12, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  separator: { height: 0.5, backgroundColor: '#E0DED8', marginLeft: 78 },
  sectionDivider: { backgroundColor: '#F1EFE8', paddingHorizontal: 16, paddingVertical: 8 },
  sectionDividerText: { fontSize: 12, color: GRAY, fontWeight: '600' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 0.5, borderColor: '#E0DED8' },
  searchInput: { backgroundColor: '#F1EFE8', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#2C2C2A' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  contactAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F1EFE8', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  contactAvatarTryber: { backgroundColor: '#E1F5EE', borderWidth: 2, borderColor: GREEN },
  contactInitials: { fontSize: 16, fontWeight: '700', color: '#2C2C2A' },
  onTryberDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: GREEN, borderWidth: 2, borderColor: '#fff' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '600', color: '#2C2C2A', marginBottom: 2 },
  onTryberLabel: { fontSize: 12, color: GREEN, fontWeight: '500' },
  contactPhone: { fontSize: 12, color: GRAY },
  messageBtn: { backgroundColor: '#E1F5EE', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14 },
  messageBtnText: { fontSize: 12, color: GREEN, fontWeight: '600' },
  inviteBtn: { backgroundColor: '#EEEDFE', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14 },
  inviteBtnText: { fontSize: 12, color: PURPLE, fontWeight: '600' },
})
