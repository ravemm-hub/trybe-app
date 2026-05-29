import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, Alert, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { supabase } from '../src/lib/supabase'
import { getEnrichedContacts, EnrichedContact } from '../src/lib/contacts'
import { getGroupMembers, addMembers, leaveGroup, removeMemberAdmin, getJoinRequests, approveRequest, declineRequest } from '../src/services/members'
import { NearbyMap, MapUser } from '../src/components/NearbyMap'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER, INVITE_MSG, AGENT_IDS } from '../src/constants'

type Tab = 'contacts' | 'map' | 'requests' | 'members'
const RADII = [1, 3, 5, 10, 25]

export default function GroupSettingsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<any>()
  const groupId = params?.id || ''
  const groupName = params?.name || 'Trybe'
  const isNew = params?.new === '1'

  const [tab, setTab] = useState<Tab>('contacts')
  const [myId, setMyId] = useState<string | null>(null)
  const [myName, setMyName] = useState('')
  const [members, setMembers] = useState<any[]>([])
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set())
  const [requests, setRequests] = useState<any[]>([])
  const [contacts, setContacts] = useState<EnrichedContact[]>([])
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null)
  const [nearby, setNearby] = useState<MapUser[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [radiusKm, setRadiusKm] = useState(5)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!groupId) { router.back(); return }
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setMyId(user.id)
      const { data: p } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
      setMyName(p?.display_name || p?.username || 'Someone')
      await loadMembers()
      loadRequests()
      getEnrichedContacts().then(setContacts)
      loadNearby(user.id)
      setLoading(false)
    })
  }, [])

  const loadMembers = useCallback(async () => {
    const data = await getGroupMembers(groupId)
    setMembers(data)
    setMemberIds(new Set(data.map((m: any) => m.user_id)))
  }, [groupId])

  const loadRequests = useCallback(async () => {
    setRequests(await getJoinRequests(groupId))
  }, [groupId])

  const approve = async (req: any) => {
    setBusy(true)
    await approveRequest(groupId, groupName, req, myName)
    await loadRequests(); await loadMembers()
    setBusy(false)
  }
  const decline = async (req: any) => {
    setBusy(true)
    await declineRequest(req.id)
    await loadRequests()
    setBusy(false)
  }
  const removeMember = (m: any) => {
    Alert.alert('Remove member', 'Remove ' + (m.profile?.display_name || 'this member') + ' from ' + groupName + '?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await removeMemberAdmin(groupId, m.user_id); await loadMembers() } },
    ])
  }

  const loadNearby = async (uid: string) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setCenter({ lat: loc.coords.latitude, lon: loc.coords.longitude })
      const { data } = await supabase.rpc('nearby_users', { p_lat: loc.coords.latitude, p_lon: loc.coords.longitude, radius_m: 50000 })
      const list: MapUser[] = (data || [])
        .filter((u: any) => u.id !== uid && !AGENT_IDS.includes(u.id) && u.lat && u.lon)
        .map((u: any) => ({ id: u.id, name: u.identity_mode === 'ghost' ? 'Ghost' : (u.display_name || u.username || 'User'), lat: u.lat, lon: u.lon }))
      setNearby(list)
    } catch {}
  }

  const addOne = async (uid: string) => {
    setBusy(true)
    await addMembers(groupId, groupName, [uid], myName)
    await loadMembers()
    setBusy(false)
  }

  const addSelected = async () => {
    if (!selected.length) return
    setBusy(true)
    const n = await addMembers(groupId, groupName, selected, myName)
    await loadMembers()
    setSelected([])
    setBusy(false)
    Alert.alert('Added', n > 0 ? `${n} ${n > 1 ? 'people were' : 'person was'} added to ${groupName}.` : 'They are already members.')
  }

  const invite = (c: EnrichedContact) => {
    Linking.openURL('whatsapp://send?phone=' + c.phone + '&text=' + encodeURIComponent(INVITE_MSG)).catch(() => {})
  }

  const leave = () => {
    if (!myId) return
    Alert.alert('Leave Trybe', 'Are you sure you want to leave ' + groupName + '?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => { await leaveGroup(groupId, myId); router.replace('/(tabs)') } },
    ])
  }

  if (loading) return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => isNew ? router.replace({ pathname: '/chat', params: { id: groupId, name: groupName } }) : router.back()} style={s.backBtn}>
          <Text style={s.backText}>{isNew ? 'Skip' : '‹'}</Text>
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{isNew ? 'Add members' : groupName}</Text>
        {isNew
          ? <TouchableOpacity onPress={() => router.replace({ pathname: '/chat', params: { id: groupId, name: groupName } })}><Text style={s.doneText}>Done</Text></TouchableOpacity>
          : <View style={{ width: 44 }} />}
      </View>

      <View style={s.tabs}>
        {(['contacts', 'map', 'requests', 'members'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive]} numberOfLines={1}>
              {t === 'contacts' ? '👥' : t === 'map' ? '📍 Map' : t === 'requests' ? `Requests${requests.length ? ` (${requests.length})` : ''}` : `Members (${members.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'contacts' && (
        <FlatList data={contacts} keyExtractor={c => c.id}
          contentContainerStyle={contacts.length === 0 ? { flex: 1 } : {}}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>👥</Text><Text style={s.emptySub}>No contacts found (allow contacts access)</Text></View>}
          renderItem={({ item: c }) => {
            const inGroup = !!(c.tryberUserId && memberIds.has(c.tryberUserId))
            return (
              <View style={s.row}>
                <View style={[s.avatar, c.onTryber && s.avatarTryber]}><Text style={s.initials}>{c.initials}</Text></View>
                <View style={s.info}>
                  <Text style={s.name}>{c.name}</Text>
                  <Text style={s.sub}>{c.onTryber ? 'On Tryber' : c.phone}</Text>
                </View>
                {inGroup
                  ? <Text style={s.inGroup}>✓ In group</Text>
                  : c.onTryber
                    ? <TouchableOpacity style={s.addBtn} disabled={busy} onPress={() => addOne(c.tryberUserId!)}><Text style={s.addBtnText}>+ Add</Text></TouchableOpacity>
                    : <TouchableOpacity style={s.inviteBtn} onPress={() => invite(c)}><Text style={s.inviteBtnText}>Invite</Text></TouchableOpacity>}
              </View>
            )
          }} />
      )}

      {tab === 'map' && (
        <View style={{ flex: 1 }}>
          {!center
            ? <View style={s.empty}><Text style={s.emptyEmoji}>📍</Text><Text style={s.emptySub}>Enable location to see people nearby on the map</Text></View>
            : <>
                <View style={s.radiusRow}>
                  {RADII.map(km => (
                    <TouchableOpacity key={km} style={[s.radChip, radiusKm === km && s.radChipActive]} onPress={() => setRadiusKm(km)}>
                      <Text style={[s.radChipText, radiusKm === km && { color: '#fff' }]}>{km}km</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flex: 1 }}>
                  <NearbyMap center={center} users={nearby} radiusM={radiusKm * 1000} onSelection={setSelected} />
                </View>
                <View style={[s.mapFooter, { paddingBottom: Math.max(insets.bottom, 10) }]}>
                  <TouchableOpacity style={[s.addSelBtn, (!selected.length || busy) && { opacity: 0.4 }]} disabled={!selected.length || busy} onPress={addSelected}>
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.addSelText}>Add {selected.length || ''} selected to Trybe</Text>}
                  </TouchableOpacity>
                </View>
              </>}
        </View>
      )}

      {tab === 'requests' && (
        <FlatList data={requests} keyExtractor={r => r.id}
          contentContainerStyle={requests.length === 0 ? { flex: 1 } : {}}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>📨</Text><Text style={s.emptySub}>No pending join requests</Text></View>}
          renderItem={({ item: r }) => (
            <View style={s.row}>
              <View style={s.avatar}><Text style={s.initials}>{r.profile?.avatar_char || (r.profile?.display_name || '?')[0]}</Text></View>
              <View style={s.info}>
                <Text style={s.name}>{r.profile?.display_name || r.profile?.username || 'User'}</Text>
                <Text style={s.sub}>wants to join</Text>
              </View>
              <TouchableOpacity style={s.addBtn} disabled={busy} onPress={() => approve(r)}><Text style={s.addBtnText}>Approve</Text></TouchableOpacity>
              <TouchableOpacity style={s.declineBtn} disabled={busy} onPress={() => decline(r)}><Text style={s.declineText}>✕</Text></TouchableOpacity>
            </View>
          )} />
      )}

      {tab === 'members' && (
        <FlatList data={members} keyExtractor={m => m.user_id}
          renderItem={({ item: m }) => (
            <View style={s.row}>
              <View style={s.avatar}><Text style={s.initials}>{m.profile?.avatar_char || (m.profile?.display_name || '?')[0]}</Text></View>
              <View style={s.info}>
                <Text style={s.name}>{m.profile?.display_name || m.profile?.username || 'User'}{m.user_id === myId ? ' (you)' : ''}</Text>
                <Text style={s.sub}>{m.role === 'admin' ? '👑 Admin' : 'Member'}</Text>
              </View>
              {m.user_id !== myId && m.role !== 'admin' && (
                <TouchableOpacity style={s.declineBtn} onPress={() => removeMember(m)}><Text style={s.declineText}>Remove</Text></TouchableOpacity>
              )}
            </View>
          )}
          ListFooterComponent={
            <TouchableOpacity style={s.leaveBtn} onPress={leave}><Text style={s.leaveText}>Leave Trybe</Text></TouchableOpacity>
          } />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { minWidth: 44, paddingVertical: 4 } as any,
  backText: { fontSize: 17, color: PRIMARY, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '700', color: TEXT, flex: 1, textAlign: 'center' },
  doneText: { fontSize: 16, color: PRIMARY, fontWeight: '700', minWidth: 44, textAlign: 'right' },
  tabs: { flexDirection: 'row', backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: PRIMARY },
  tabBtnText: { fontSize: 13, color: GRAY, fontWeight: '600' },
  tabBtnTextActive: { color: PRIMARY },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  avatarTryber: { backgroundColor: '#E8F5E9', borderColor: LIVE, borderWidth: 2 },
  initials: { fontSize: 16, fontWeight: '700', color: TEXT },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: TEXT },
  sub: { fontSize: 12, color: GRAY, marginTop: 1 },
  addBtn: { backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  inviteBtn: { backgroundColor: '#EEF0FF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  inviteBtnText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  declineBtn: { backgroundColor: 'rgba(255,59,48,0.08)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  declineText: { color: DANGER, fontSize: 13, fontWeight: '700' },
  inGroup: { fontSize: 12, color: LIVE, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyEmoji: { fontSize: 48 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center' },
  radiusRow: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER, justifyContent: 'center' },
  radChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  radChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  radChipText: { fontSize: 13, color: TEXT, fontWeight: '600' },
  mapFooter: { padding: 10, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: BORDER },
  addSelBtn: { backgroundColor: PRIMARY, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addSelText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  leaveBtn: { margin: 16, paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,59,48,0.08)', alignItems: 'center' },
  leaveText: { color: DANGER, fontSize: 15, fontWeight: '700' },
})
