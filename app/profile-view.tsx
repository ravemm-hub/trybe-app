import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, Image, Alert, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { followUser, unfollowUser, isFollowing, getProfileCounts, SocialCounts } from '../src/services/social'
import { getContactNameMap } from '../src/lib/contacts'
import { isTargetOpenInZone } from '../src/services/tryberZone'
import { blockUser, unblockUser, isUserBlocked } from '../src/services/moderation'
import { ReportSheet } from '../src/components/ReportSheet'
import { ZoneSignalSheet } from '../src/components/ZoneSignalSheet'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER, AGENT_IDS } from '../src/constants'

export default function ProfileViewScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<any>()
  const targetId = params?.userId || ''
  const [myId, setMyId] = useState<string | null>(null)
  const [profile, setProfile] = useState<any | null>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [counts, setCounts] = useState<SocialCounts>({ followers: 0, following: 0, posts_count: 0 })
  const [following, setFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [followBusy, setFollowBusy] = useState(false)
  const [contactName, setContactName] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [zoneVisible, setZoneVisible] = useState(false)   // show the ✦ button?
  const [zoneSheetOpen, setZoneSheetOpen] = useState(false)
  const [targetAlias, setTargetAlias] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [phone, setPhone] = useState<string | null>(null)
  const [phoneVerified, setPhoneVerified] = useState(false)

  const load = useCallback(async () => {
    if (!targetId) { router.back(); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMyId(user.id)
    const cmap = await getContactNameMap()
    setContactName(cmap[targetId] || null)
    const [{ data: p }, c, fol, { data: ps }, { data: photos }, theirOpen] = await Promise.all([
      supabase.from('profiles')
        .select('id, display_name, username, avatar_char, avatar_url, bio, ghost_name, tryber_zone_alias, birth_date, gender, location, phone, phone_verified')
        .eq('id', targetId).single(),
      getProfileCounts(targetId),
      isFollowing(user.id, targetId),
      supabase.from('posts').select('id, content, media_url, created_at, likes, dislikes, comment_count, is_anonymous')
        .eq('user_id', targetId).is('group_id', null)
        .order('created_at', { ascending: false }).limit(30),
      supabase.from('profile_photos').select('id, url, position').eq('user_id', targetId).order('position', { ascending: true }),
      isTargetOpenInZone(targetId),
    ])
    setProfile(p ? { ...p, photos: photos || [] } : null)
    if (p) {
      setPhone(p.phone || null)
      setPhoneVerified(p.phone_verified || false)
    }
    setCounts(c); setFollowing(fol); setPosts(ps || [])
    // Whether I'm currently blocking this user — drives the menu state.
    if (user.id !== targetId) setBlocked(await isUserBlocked(user.id, targetId))
    // The ✦ "spark" button is available to ANY user on ANY other user's
    // profile — no activation, no PIN, no opt-in needed. Your signal stays
    // private; only when the OTHER side also signals positively does Teeby
    // DM both of you ("mutual spark — want to chat?").  The button is only
    // hidden when (a) it's your own profile, (b) the target is an AI agent,
    // or (c) the target explicitly opted out via Tryber Zone settings.
    setZoneVisible(
      user.id !== targetId &&
      !AGENT_IDS.includes(targetId) &&
      theirOpen
    )
    setTargetAlias((p as any)?.tryber_zone_alias || null)
    setLoading(false)
  }, [targetId, router])

  useEffect(() => { load() }, [load])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const toggleFollow = async () => {
    if (!myId || !targetId || followBusy) return
    setFollowBusy(true)
    if (following) {
      // Optimistic — drop count first so UI feels instant.
      setFollowing(false); setCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) }))
      const { error } = await unfollowUser(myId, targetId)
      if (error) { setFollowing(true); setCounts(c => ({ ...c, followers: c.followers + 1 })); Alert.alert('Error', error.message) }
    } else {
      setFollowing(true); setCounts(c => ({ ...c, followers: c.followers + 1 }))
      const { error } = await followUser(myId, targetId)
      if (error) { setFollowing(false); setCounts(c => ({ ...c, followers: Math.max(0, c.followers - 1) })); Alert.alert('Error', error.message) }
    }
    setFollowBusy(false)
  }

  const openDM = () => {
    if (!profile) return
    router.push({ pathname: '/dm', params: { userId: profile.id, userName: displayName, myMode: 'lit', theirMode: 'lit', myAvatar: '💬', isAgent: '0' } })
  }

  if (loading) return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>
  if (!profile) return null

  const displayName = contactName || profile.display_name || profile.username || 'User'
  const isAgent = AGENT_IDS.includes(targetId)
  const isMe = myId === targetId

  const fmt = (ts: string) => {
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => phone && setDetailsOpen(true)}>
          <Text style={s.headerTitle} numberOfLines={1}>{displayName}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {zoneVisible && (
            <TouchableOpacity onPress={() => setZoneSheetOpen(true)} style={s.zoneStar}>
              <Text style={s.zoneStarText}>✦</Text>
            </TouchableOpacity>
          )}
          {!isMe && !isAgent && (
            <TouchableOpacity style={s.menuBtn} onPress={() => setMenuOpen(true)}>
              <Text style={s.menuDots}>⋯</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* … menu — Report / Block / Unblock */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={s.menuOverlay} onPress={() => setMenuOpen(false)} activeOpacity={1}>
          <View style={s.menuCard}>
            <TouchableOpacity style={s.menuItem} onPress={() => { setMenuOpen(false); setReportOpen(true) }}>
              <Text style={s.menuItemIcon}>🚩</Text>
              <Text style={s.menuItemText}>Report this user</Text>
            </TouchableOpacity>
            {!blocked
              ? <TouchableOpacity style={s.menuItem} onPress={() => {
                  setMenuOpen(false)
                  Alert.alert(
                    'Block ' + displayName + '?',
                    "They won't be able to message you, see your posts in real time, or appear in your Radar. You can unblock anytime.",
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Block', style: 'destructive', onPress: async () => { await blockUser(targetId); setBlocked(true) } },
                    ],
                  )
                }}>
                  <Text style={s.menuItemIcon}>🚫</Text>
                  <Text style={[s.menuItemText, { color: DANGER }]}>Block this user</Text>
                </TouchableOpacity>
              : <TouchableOpacity style={s.menuItem} onPress={async () => { setMenuOpen(false); await unblockUser(targetId); setBlocked(false) }}>
                  <Text style={s.menuItemIcon}>✓</Text>
                  <Text style={[s.menuItemText, { color: LIVE }]}>Unblock</Text>
                </TouchableOpacity>}
          </View>
        </TouchableOpacity>
      </Modal>

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        target={{ type: 'user', id: targetId }}
        targetLabel={displayName}
      />
      {myId && zoneVisible && (
        <ZoneSignalSheet
          visible={zoneSheetOpen}
          onClose={() => setZoneSheetOpen(false)}
          myId={myId}
          targetId={targetId}
          targetAlias={targetAlias}
        />
      )}

      {/* User details modal — shows phone when tapping header */}
      <Modal visible={detailsOpen} transparent animationType="fade" onRequestClose={() => setDetailsOpen(false)}>
        <TouchableOpacity style={s.modalOverlay} onPress={() => setDetailsOpen(false)} activeOpacity={1}>
          <View style={s.detailsCard}>
            <TouchableOpacity style={s.detailsClose} onPress={() => setDetailsOpen(false)}>
              <Text style={s.detailsCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={s.detailsTitle}>{displayName}</Text>
            {phone && (
              <View style={s.detailsRow}>
                <Text style={s.detailsLabel}>Phone</Text>
                <Text style={s.detailsValue}>
                  {isMe || phoneVerified ? phone : phone.replace(/\d(?=\d{4})/g, 'x')}
                </Text>
              </View>
            )}
            {!phone && (
              <Text style={s.detailsEmpty}>No phone on file</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <FlatList
        data={posts}
        keyExtractor={p => p.id}
        ListHeaderComponent={(
          <View style={s.profileCard}>
            <View style={[s.avatar, isAgent && s.avatarAgent]}>
              {profile.avatar_url
                ? <Image source={{ uri: profile.avatar_url }} style={{ width: '100%', height: '100%' }} />
                : <Text style={s.avatarText}>{profile.avatar_char || displayName[0] || '?'}</Text>}
            </View>
            <Text style={s.name}>{displayName}{isAgent ? ' ✦' : ''}</Text>
            {profile.username ? <Text style={s.username}>@{profile.username}</Text> : null}
            {(() => {
              const bits: string[] = []
              if (profile.birth_date) {
                const yrs = Math.floor((Date.now() - new Date(profile.birth_date).getTime()) / (365.25 * 24 * 3600 * 1000))
                if (yrs > 0 && yrs < 120) bits.push(yrs + ' yrs')
              }
              if (profile.gender && profile.gender !== 'prefer_not') bits.push(profile.gender)
              if (profile.location) bits.push('📍 ' + profile.location)
              return bits.length ? <Text style={s.metaLine}>{bits.join(' · ')}</Text> : null
            })()}
            {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}
            {profile.photos?.length > 0 && (
              <FlatList horizontal data={profile.photos} keyExtractor={(p: any) => p.id}
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 12, alignSelf: 'stretch' }}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
                renderItem={({ item }) => <Image source={{ uri: item.url }} style={s.galleryImg} resizeMode="cover" />}
              />
            )}

            <View style={s.statsRow}>
              <View style={s.statBox}>
                <Text style={s.statN}>{counts.posts_count}</Text>
                <Text style={s.statL}>Posts</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statN}>{counts.followers}</Text>
                <Text style={s.statL}>Followers</Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statN}>{counts.following}</Text>
                <Text style={s.statL}>Following</Text>
              </View>
            </View>

            {!isMe && !isAgent && (
              <>
                <View style={s.actionRow}>
                  <TouchableOpacity style={[s.followBtn, following && s.followingBtn]} onPress={toggleFollow} disabled={followBusy}>
                    {followBusy ? <ActivityIndicator color={following ? PRIMARY : '#fff'} size="small" />
                      : <Text style={[s.followBtnText, following && s.followingBtnText]}>{following ? '✓ Following' : '+ Follow'}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={s.dmBtn} onPress={openDM}><Text style={s.dmBtnText}>💬 Message</Text></TouchableOpacity>
                </View>
                {/* Prominent Zone button — discreet but visible. Only renders when
                    the target hasn't opted out of Zone (zoneVisible) — same gate
                    as the small ✦ in the header. */}
                {zoneVisible && (
                  <TouchableOpacity style={s.zoneBigBtn} onPress={() => setZoneSheetOpen(true)}>
                    <Text style={s.zoneBigBtnText}>✦ Rate the vibe</Text>
                    <Text style={s.zoneBigBtnSub}>Discreet — stays private until mutual</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {isMe && (
              <TouchableOpacity style={s.editBtn} onPress={() => router.push('/(tabs)/profile')}>
                <Text style={s.editBtnText}>Edit your profile</Text>
              </TouchableOpacity>
            )}
            <Text style={s.sectionHeader}>POSTS</Text>
          </View>
        )}
        ListEmptyComponent={<View style={s.emptyPosts}><Text style={s.emptySub}>No posts yet</Text></View>}
        renderItem={({ item: p }) => (
          <View style={s.postRow}>
            {p.content ? <Text style={s.postText}>{p.content}</Text> : null}
            {p.media_url ? <Image source={{ uri: p.media_url }} style={s.postImg} resizeMode="cover" /> : null}
            <View style={s.postMeta}>
              <Text style={s.postMetaText}>👍 {p.likes || 0}</Text>
              <Text style={s.postMetaText}>💬 {p.comment_count || 0}</Text>
              <Text style={s.postTime}>{fmt(p.created_at)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4, width: 36 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 32, marginTop: -4 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: TEXT, paddingHorizontal: 8 },
  zoneStar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF0FF', borderWidth: 1, borderColor: PRIMARY },
  zoneBigBtn: { marginTop: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: '#F5F4FF', borderWidth: 1.5, borderColor: PRIMARY, alignItems: 'center', width: '100%' },
  zoneBigBtnText: { fontSize: 15, fontWeight: '800', color: PRIMARY },
  zoneBigBtnSub: { fontSize: 11, color: GRAY, marginTop: 2 },
  menuBtn: { width: 32, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  menuDots: { fontSize: 22, color: TEXT, fontWeight: '700', marginTop: -8 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36 },
  menuCard: { backgroundColor: CARD, borderRadius: 14, width: '100%', overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderColor: BORDER },
  menuItemIcon: { fontSize: 18 },
  menuItemText: { fontSize: 15, color: TEXT, fontWeight: '500' },
  zoneStarText: { fontSize: 18, color: PRIMARY, fontWeight: '700' },
  profileCard: { backgroundColor: CARD, paddingHorizontal: 20, paddingVertical: 20, alignItems: 'center', borderBottomWidth: 0.5, borderColor: BORDER },
  avatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: BORDER, marginBottom: 12, overflow: 'hidden' },
  avatarAgent: { borderColor: PRIMARY, borderWidth: 3 },
  avatarText: { fontSize: 40 },
  name: { fontSize: 22, fontWeight: '800', color: TEXT },
  username: { fontSize: 14, color: GRAY, marginTop: 2 },
  bio: { fontSize: 14, color: TEXT, marginTop: 10, textAlign: 'center', lineHeight: 19 },
  metaLine: { fontSize: 13, color: GRAY, marginTop: 6, fontWeight: '500' },
  galleryImg: { width: 180, height: 220, borderRadius: 14, backgroundColor: '#EEE' },
  statsRow: { flexDirection: 'row', gap: 24, marginTop: 18, marginBottom: 12 },
  statBox: { alignItems: 'center' },
  statN: { fontSize: 18, fontWeight: '800', color: TEXT },
  statL: { fontSize: 12, color: GRAY, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 6, width: '100%' },
  followBtn: { flex: 1, backgroundColor: PRIMARY, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  followBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  followingBtn: { backgroundColor: '#EEF0FF', borderWidth: 1, borderColor: PRIMARY },
  followingBtnText: { color: PRIMARY },
  dmBtn: { flex: 1, backgroundColor: BG, paddingVertical: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  dmBtnText: { color: TEXT, fontSize: 15, fontWeight: '600' },
  editBtn: { backgroundColor: BG, paddingVertical: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: BORDER, marginTop: 6, width: '100%' },
  editBtnText: { color: TEXT, fontSize: 14, fontWeight: '600' },
  sectionHeader: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginTop: 18, marginBottom: -8 },
  emptyPosts: { padding: 32, alignItems: 'center' },
  emptySub: { fontSize: 14, color: GRAY },
  postRow: { backgroundColor: CARD, padding: 14, borderBottomWidth: 0.5, borderColor: BORDER },
  postText: { fontSize: 15, color: TEXT, lineHeight: 21 },
  postImg: { width: '100%', height: 200, borderRadius: 12, marginTop: 8 },
  postMeta: { flexDirection: 'row', gap: 14, marginTop: 8, alignItems: 'center' },
  postMetaText: { fontSize: 12, color: GRAY },
  postTime: { fontSize: 11, color: GRAY, marginLeft: 'auto' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36 },
  detailsCard: { backgroundColor: CARD, borderRadius: 14, width: '100%', paddingHorizontal: 16, paddingVertical: 18, position: 'relative' },
  detailsClose: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  detailsCloseText: { fontSize: 24, color: GRAY },
  detailsTitle: { fontSize: 18, fontWeight: '700', color: TEXT, marginBottom: 16 },
  detailsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 0.5, borderColor: BORDER },
  detailsLabel: { fontSize: 14, color: GRAY, fontWeight: '500' },
  detailsValue: { fontSize: 14, color: TEXT, fontWeight: '600' },
  detailsEmpty: { fontSize: 14, color: GRAY, fontStyle: 'italic', marginTop: 8 },
})
