import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar, Switch, Alert, RefreshControl, ActivityIndicator, TextInput, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { supabase } from '../../src/lib/supabase'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE } from '../../src/constants'

type Tab = 'groups' | 'radar'

export default function ExploreScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('groups')
  const [userId, setUserId] = useState<string | null>(null)
  const [groups, setGroups] = useState<any[]>([])
  const [nearby, setNearby] = useState<any[]>([])
  const [myGroups, setMyGroups] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [radarOn, setRadarOn] = useState(false)
  const [myMode, setMyMode] = useState<'lit' | 'ghost'>('lit')
  const [loading, setLoading] = useState(true)
  const [radarLoading, setRadarLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeGroupId, setCodeGroupId] = useState<string | null>(null)
  const [codeLoading, setCodeLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      loadGroups(user.id)
    })
  }, [])

  const loadGroups = async (uid: string) => {
    const { data: allGroups } = await supabase.from('groups')
      .select('id, name, description, status, is_private, is_secret, member_count, location_name')
      .eq('status', 'open').order('member_count', { ascending: false }).limit(50)
    const { data: memberships } = await supabase.from('group_members').select('group_id').eq('user_id', uid)
    setMyGroups(new Set((memberships || []).map((m: any) => m.group_id)))
    const { data: reqs } = await supabase.from('join_requests').select('group_id').eq('user_id', uid).eq('status', 'pending')
    setPending(new Set((reqs || []).map((r: any) => r.group_id)))
    setGroups(allGroups || [])
    setLoading(false); setRefreshing(false)
  }

  const joinGroup = async (group: any) => {
    if (!userId) return
    if (myGroups.has(group.id)) {
      router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: group.member_count } })
      return
    }
    if (group.is_secret) {
      setCodeGroupId(group.id); setCodeInput(''); setShowCodeModal(true)
      return
    }
    if (group.is_private) {
      if (pending.has(group.id)) return
      try { await supabase.from('join_requests').insert({ group_id: group.id, user_id: userId, status: 'pending' }) } catch {}
      setPending(prev => new Set([...prev, group.id]))
      Alert.alert('✓ Request sent', 'Waiting for Admin approval')
      return
    }
    // Open — join immediately
    const { error } = await supabase.from('group_members').insert({ group_id: group.id, user_id: userId, role: 'member' })
    if (!error) {
      // member_count is maintained by the member_count_trigger on group_members; just clear the archive timer.
      await supabase.from('groups').update({ archive_at: null }).eq('id', group.id)
      setMyGroups(prev => new Set([...prev, group.id]))
      router.push({ pathname: '/chat', params: { id: group.id, name: group.name, members: group.member_count + 1 } })
    }
  }

  const verifyCode = async () => {
    if (!codeGroupId || !userId || !codeInput.trim()) return
    setCodeLoading(true)
    try {
      const { data: group } = await supabase.from('groups').select('invite_code, name, member_count').eq('id', codeGroupId).single()
      if (!group || group.invite_code?.toUpperCase() !== codeInput.trim().toUpperCase()) {
        Alert.alert('❌ Invalid code', 'Please check the invite code and try again')
        setCodeLoading(false); return
      }
      await supabase.from('group_members').insert({ group_id: codeGroupId, user_id: userId, role: 'member' })
      await supabase.from('groups').update({ invite_code: null, archive_at: null }).eq('id', codeGroupId)
      setMyGroups(prev => new Set([...prev, codeGroupId]))
      setShowCodeModal(false)
      router.push({ pathname: '/chat', params: { id: codeGroupId, name: group.name, members: group.member_count + 1 } })
    } catch { Alert.alert('Error', 'Something went wrong') }
    finally { setCodeLoading(false) }
  }

  const toggleRadar = async (val: boolean) => {
    setRadarOn(val)
    if (!val || !userId) return
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { Alert.alert('Location needed', 'Radar needs your location'); setRadarOn(false); return }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const { latitude, longitude } = loc.coords
      await supabase.from('user_locations').upsert({ user_id: userId, location: 'POINT(' + longitude + ' ' + latitude + ')', radar_on: true, identity_mode: myMode, updated_at: new Date().toISOString() })
      // Seed nearby AI agents around the user so the radar isn't empty.
      await supabase.rpc('place_agents_near_user', { user_id_input: userId })
      loadNearby(latitude, longitude)
    } catch { setRadarOn(false) }
  }

  const loadNearby = async (lat: number, lon: number) => {
    setRadarLoading(true)
    try {
      const { data } = await supabase.rpc('nearby_users', { p_lat: lat, p_lon: lon, radius_m: 5000 })
      setNearby((data || []).filter((u: any) => u.id !== userId))
    } catch {} finally { setRadarLoading(false) }
  }

  const getGroupAction = (g: any) => {
    if (myGroups.has(g.id)) return { label: 'Enter →', color: LIVE }
    if (g.is_secret) return { label: '🕵️ Enter Code', color: '#9B59B6' }
    if (pending.has(g.id)) return { label: 'Pending...', color: GRAY }
    if (g.is_private) return { label: '🔒 Request', color: PRIMARY }
    return { label: 'Join ⚡', color: PRIMARY }
  }

  const getGroupIcon = (g: any) => {
    if (g.is_secret) return '🕵️'
    if (g.is_private) return '🔒'
    return '⚡'
  }

  if (loading) return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}><Text style={s.title}>Explore</Text></View>

      <View style={s.tabs}>
        {(['groups', 'radar'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive]}>{t === 'groups' ? '⚡ Trybes' : '📡 Radar'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'groups' && (
        <FlatList data={groups} keyExtractor={g => g.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); if (userId) loadGroups(userId) }} tintColor={PRIMARY} />}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>⚡</Text><Text style={s.emptyTitle}>No Trybes yet</Text><TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/create')}><Text style={s.emptyBtnText}>Create one</Text></TouchableOpacity></View>}
          renderItem={({ item: g }) => {
            const action = getGroupAction(g)
            return (
              <View style={[s.groupCard, myGroups.has(g.id) && s.groupCardActive]}>
                <View style={s.groupCardLeft}>
                  <View style={[s.groupAvatar, myGroups.has(g.id) && s.groupAvatarMember]}>
                    <Text style={s.groupAvatarText}>{getGroupIcon(g)}</Text>
                    <View style={[s.liveDot, { backgroundColor: LIVE }]} />
                  </View>
                  <View style={s.groupInfo}>
                    <Text style={s.groupName} numberOfLines={1}>{g.name}</Text>
                    <Text style={s.groupMeta}>
                      {g.member_count || 0} members{g.location_name ? ' · 📍' + g.location_name : ''}
                    </Text>
                    {!g.is_secret && g.description ? <Text style={s.groupDesc} numberOfLines={1}>{g.description}</Text> : null}
                    {g.is_secret && <Text style={s.secretNote}>🕵️ Invite code required</Text>}
                  </View>
                </View>
                <TouchableOpacity style={[s.actionBtn, { borderColor: action.color }]} onPress={() => joinGroup(g)}>
                  <Text style={[s.actionBtnText, { color: action.color }]}>{action.label}</Text>
                </TouchableOpacity>
              </View>
            )
          }}
        />
      )}

      {tab === 'radar' && (
        <View style={{ flex: 1 }}>
          <View style={s.radarControls}>
            <View style={s.radarToggleRow}>
              <Text style={s.radarLabel}>{radarOn ? '📡 Radar Active' : '📡 Radar Off'}</Text>
              <Switch value={radarOn} onValueChange={toggleRadar} trackColor={{ true: LIVE, false: '#E0DED8' }} thumbColor="#fff" />
            </View>
            {radarOn && (
              <View style={s.modeRow}>
                {(['lit', 'ghost'] as const).map(m => (
                  <TouchableOpacity key={m} style={[s.modeBtn, myMode === m && s.modeBtnActive]} onPress={() => setMyMode(m)}>
                    <Text style={s.modeBtnText}>{m === 'lit' ? '🔥 Lit' : '👻 Ghost'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          {!radarOn
            ? <View style={s.empty}><Text style={s.emptyEmoji}>📡</Text><Text style={s.emptyTitle}>Radar is off</Text><Text style={s.emptySub}>Turn on to see people nearby</Text><TouchableOpacity style={s.emptyBtn} onPress={() => toggleRadar(true)}><Text style={s.emptyBtnText}>Activate Radar</Text></TouchableOpacity></View>
            : radarLoading ? <ActivityIndicator color={PRIMARY} style={{ marginTop: 40 }} />
            : <FlatList data={nearby} keyExtractor={u => u.id}
                contentContainerStyle={{ padding: 12, gap: 10 }}
                ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>🔍</Text><Text style={s.emptyTitle}>No one nearby yet</Text></View>}
                ListHeaderComponent={nearby.length > 0 ? <Text style={s.nearbyCount}>{nearby.length} people nearby</Text> : null}
                renderItem={({ item: u }) => (
                  <TouchableOpacity style={s.userCard} onPress={() => router.push({ pathname: '/dm', params: { userId: u.id, userName: u.identity_mode === 'ghost' ? '👻 Ghost' : (u.display_name || u.username), myMode, myAvatar: '📡', isAgent: '0' } })}>
                    <View style={s.userAvatar}><Text style={s.userAvatarText}>{u.identity_mode === 'ghost' ? '👻' : (u.display_name?.[0] || '?')}</Text></View>
                    <View style={s.userInfo}>
                      <Text style={s.userName}>{u.identity_mode === 'ghost' ? 'Ghost' : (u.display_name || u.username)}</Text>
                      <Text style={s.userDist}>{u.distance_m < 1000 ? Math.round(u.distance_m) + 'm' : (u.distance_m / 1000).toFixed(1) + 'km'} away</Text>
                    </View>
                    <Text style={{ fontSize: 22 }}>💬</Text>
                  </TouchableOpacity>
                )}
              />
          }
        </View>
      )}

      {/* Invite Code Modal */}
      <Modal visible={showCodeModal} transparent animationType="fade" onRequestClose={() => setShowCodeModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>🕵️ Enter Invite Code</Text>
            <Text style={s.modalSub}>Enter the 6-character code you received</Text>
            <TextInput style={s.codeInput} value={codeInput} onChangeText={t => setCodeInput(t.toUpperCase())} placeholder="ABC123" placeholderTextColor={GRAY} maxLength={6} autoCapitalize="characters" autoFocus textAlign="center" />
            <TouchableOpacity style={[s.verifyBtn, (!codeInput.trim() || codeLoading) && { opacity: 0.4 }]} onPress={verifyCode} disabled={!codeInput.trim() || codeLoading}>
              {codeLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.verifyBtnText}>Verify & Join</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCodeModal(false)} style={{ marginTop: 12 }}>
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
  header: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  title: { fontSize: 22, fontWeight: '800', color: TEXT },
  tabs: { flexDirection: 'row', backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: PRIMARY },
  tabBtnText: { fontSize: 14, color: GRAY, fontWeight: '600' },
  tabBtnTextActive: { color: PRIMARY },
  groupCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderRadius: 16, padding: 14, borderWidth: 0.5, borderColor: BORDER },
  groupCardActive: { borderColor: LIVE, borderWidth: 1.5 },
  groupCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  groupAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: BORDER, position: 'relative' },
  groupAvatarMember: { borderColor: LIVE },
  groupAvatarText: { fontSize: 22 },
  liveDot: { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: CARD },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 2 },
  groupMeta: { fontSize: 12, color: GRAY },
  groupDesc: { fontSize: 12, color: GRAY, marginTop: 2 },
  secretNote: { fontSize: 11, color: '#9B59B6', marginTop: 2, fontWeight: '500' },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1.5 },
  actionBtnText: { fontSize: 12, fontWeight: '700' },
  radarControls: { backgroundColor: CARD, padding: 16, borderBottomWidth: 0.5, borderColor: BORDER },
  radarToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  radarLabel: { fontSize: 16, fontWeight: '700', color: TEXT },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: BG, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#EEF0FF', borderWidth: 1.5, borderColor: PRIMARY },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: TEXT },
  nearbyCount: { fontSize: 12, color: GRAY, fontWeight: '600', marginBottom: 8 },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, borderRadius: 16, padding: 14, borderWidth: 0.5, borderColor: BORDER },
  userAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { fontSize: 24 },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 3 },
  userDist: { fontSize: 12, color: GRAY },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: TEXT, marginBottom: 8 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 20 },
  emptyBtn: { backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard: { backgroundColor: CARD, borderRadius: 24, padding: 24, width: '100%' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: TEXT, textAlign: 'center', marginBottom: 6 },
  modalSub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 20 },
  codeInput: { backgroundColor: BG, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16, fontSize: 28, fontWeight: '800', color: TEXT, borderWidth: 2, borderColor: PRIMARY, letterSpacing: 8, marginBottom: 16 },
  verifyBtn: { backgroundColor: PRIMARY, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  verifyBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
