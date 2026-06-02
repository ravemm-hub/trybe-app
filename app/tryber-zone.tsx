import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, Alert, Image, ScrollView, Switch, TextInput, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { PinPad } from '../src/components/PinPad'
import { pickImageAsset, uploadMedia } from '../src/lib/upload'
import {
  getMyZoneStatus, activateZone, setAlias, setAvailability,
  hasPinSet, setPin, verifyPin, clearPin, markSessionUnlocked, isSessionActive, endSession,
  listMatches, revealMatch, passMatch, MatchRow,
  listPrivatePhotos, addPrivatePhoto, deletePrivatePhoto,
  suggestAliases, ZoneStatus,
  listDiscoverable, DiscoverablePerson,
} from '../src/services/tryberZone'
import { ZoneSignalSheet } from '../src/components/ZoneSignalSheet'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER } from '../src/constants'

type Stage = 'loading' | 'paywall' | 'setPin' | 'confirmPin' | 'aliasSetup' | 'lock' | 'home'

export default function TryberZoneScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [status, setStatus] = useState<ZoneStatus | null>(null)
  const [stage, setStage] = useState<Stage>('loading')

  // Setup-PIN flow buffers
  const [firstPin, setFirstPin] = useState<string | null>(null)
  const [pinError, setPinError] = useState('')
  const [resetTick, setResetTick] = useState(0)
  const [aliasInput, setAliasInput] = useState('')
  const [aliasSuggestions, setAliasSuggestions] = useState<string[]>([])

  // Home tab
  const [tab, setTab] = useState<'people' | 'matches' | 'settings'>('people')
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [people, setPeople] = useState<DiscoverablePerson[]>([])
  const [photos, setPhotos] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [activating, setActivating] = useState(false)
  // Signal sheet target (when tapping a person row).
  const [signalTarget, setSignalTarget] = useState<DiscoverablePerson | null>(null)

  const bootstrap = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.back(); return }
    setUserId(user.id)
    // Sparks is free + zero-friction. We auto-activate on first visit so the
    // matches inbox is always available; if the user has set an optional PIN
    // we still gate behind it. Alias is also optional.
    let st = await getMyZoneStatus(user.id)
    if (!st.active) {
      try { await activateZone(user.id) } catch {}
      st = await getMyZoneStatus(user.id)
    }
    setStatus(st)
    const pinExists = await hasPinSet()
    if (pinExists) {
      const session = await isSessionActive()
      if (session) { setStage('home'); await loadHome(user.id) }
      else setStage('lock')
    } else {
      setStage('home')
      await loadHome(user.id)
    }
  }, [router])

  useEffect(() => { bootstrap() }, [bootstrap])
  // End PIN session on blur — only relevant if the user actually set a PIN.
  useFocusEffect(useCallback(() => {
    return () => { hasPinSet().then(has => { if (has) endSession() }) }
  }, []))

  const loadHome = async (uid: string) => {
    const [m, ph, pe] = await Promise.all([
      listMatches(),
      listPrivatePhotos(uid),
      listDiscoverable(uid),
    ])
    setMatches(m); setPhotos(ph); setPeople(pe)
  }

  // Re-load discoverable people after a successful signal so the chip
  // toggles to "Signaled ✓" without a full screen refresh.
  const refreshPeople = async () => {
    if (!userId) return
    setPeople(await listDiscoverable(userId))
  }

  // ── Paywall ──
  const onActivate = async () => {
    if (!userId) return
    setActivating(true)
    await activateZone(userId)
    setActivating(false)
    setStatus(await getMyZoneStatus(userId))
    setStage('setPin')
  }

  // ── PIN setup ──
  const onFirstPin = (pin: string) => { setFirstPin(pin); setPinError(''); setResetTick(t => t + 1); setStage('confirmPin') }
  const onConfirmPin = async (pin: string) => {
    if (pin !== firstPin) {
      setPinError("PINs don't match. Try again."); setFirstPin(null); setResetTick(t => t + 1); setStage('setPin'); return
    }
    await setPin(pin)
    await markSessionUnlocked()
    if (!status?.alias) { setStage('aliasSetup'); setAliasSuggestions(suggestAliases()) }
    else { setStage('home'); if (userId) loadHome(userId) }
  }

  // ── Lock screen ──
  const onUnlockPin = async (pin: string) => {
    if (await verifyPin(pin)) {
      await markSessionUnlocked()
      setStage('home')
      if (userId) loadHome(userId)
    } else {
      setPinError('Wrong PIN. Try again.'); setResetTick(t => t + 1)
    }
  }

  // ── Alias setup ──
  const onSaveAlias = async (a: string) => {
    if (!userId) return
    try { await setAlias(userId, a) } catch (e: any) { Alert.alert('Error', e.message); return }
    setStatus(s => s ? { ...s, alias: a.trim().slice(0, 40) } : s)
    setStage('home')
    loadHome(userId)
  }

  // ── Matches actions ──
  const onReveal = async (m: MatchRow) => {
    await revealMatch(m.match_id)
    if (userId) loadHome(userId)
  }
  const onPass = async (m: MatchRow) => {
    Alert.alert('Pass on this connection?', 'They will never know it was you.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Pass', style: 'destructive', onPress: async () => {
        await passMatch(m.match_id)
        if (userId) loadHome(userId)
      } }])
  }
  const openChat = (m: MatchRow) => {
    if (!m.both_revealed) return
    router.push({ pathname: '/dm', params: {
      userId: m.partner_id, userName: m.partner_display_name || m.partner_alias || 'Match',
      myMode: 'lit', theirMode: 'lit', myAvatar: '✦', isAgent: '0',
    } })
  }

  // ── Photos ──
  const onAddPhoto = async () => {
    if (!userId) return
    if (photos.length >= 4) { Alert.alert('Max reached', 'You can add up to 4 private photos.'); return }
    const asset = await pickImageAsset()
    if (!asset) return
    setUploading(true)
    const url = await uploadMedia(asset.uri, 'image', asset.ext)
    if (url) await addPrivatePhoto(userId, url)
    setUploading(false)
    setPhotos(await listPrivatePhotos(userId))
  }
  const onDeletePhoto = async (id: string) => {
    if (!userId) return
    await deletePrivatePhoto(id)
    setPhotos(await listPrivatePhotos(userId))
  }

  // ── Toggles ──
  const onToggleAvailable = async (v: boolean) => {
    if (!userId) return
    setStatus(s => s ? { ...s, available: v } : s)
    await setAvailability(userId, v)
  }

  // ────────────────────────────────────────────────────────────────────────

  const Header = ({ title, leftLabel = '‹' }: { title: string; leftLabel?: string }) => (
    <View style={s.header}>
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
        <Text style={s.backText}>{leftLabel}</Text>
      </TouchableOpacity>
      <Text style={s.title}>{title}</Text>
      <View style={{ width: 36 }} />
    </View>
  )

  if (stage === 'loading') {
    return <View style={[s.container, { paddingTop: insets.top }]}><ActivityIndicator color={PRIMARY} style={{ flex: 1 }} /></View>
  }

  // ── Paywall ──
  if (stage === 'paywall') return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <Header title="Tryber Zone ✦" />
      <ScrollView contentContainerStyle={s.paywall}>
        <Text style={s.paywallEmoji}>✦</Text>
        <Text style={s.paywallTitle}>Welcome to the Zone</Text>
        <Text style={s.paywallSub}>A private space for discreet, mutual-interest connections inside Tryber.</Text>
        {[
          ['🪶', 'Tap a tiny ✦ on any profile to signal interest — they never see it unless they signal back.'],
          ['🎭', 'Both signal positive → identities stay hidden until a final Reveal step. Either side can pass anonymously.'],
          ['🔒', 'PIN-locked from the rest of the app. Phone numbers are never shared. All chat stays in-app.'],
          ['🖼️', 'Up to 4 private photos that only unlock to fully revealed matches.'],
        ].map(([emoji, text]) => (
          <View key={text} style={s.bulletRow}>
            <Text style={s.bulletEmoji}>{emoji}</Text>
            <Text style={s.bulletText}>{text}</Text>
          </View>
        ))}
        <View style={s.priceCard}>
          <Text style={s.price}>₪5 <Text style={s.priceUnit}>/ month</Text></Text>
          <Text style={s.priceSub}>Cancel anytime. Renews monthly.</Text>
        </View>
        <TouchableOpacity style={s.cta} onPress={onActivate} disabled={activating}>
          {activating ? <ActivityIndicator color="#fff" /> : <Text style={s.ctaText}>Activate Tryber Zone</Text>}
        </TouchableOpacity>
        <Text style={s.legal}>Payments by Apple / Google App Store launch with v2 — until then activation is free for early users.</Text>
      </ScrollView>
    </View>
  )

  // ── Set PIN ──
  if (stage === 'setPin') return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Header title="Set your Zone PIN" />
      <View style={s.pinScreen}>
        <Text style={s.pinTitle}>Choose a 4-digit PIN</Text>
        <Text style={s.pinSub}>This locks the Zone whenever you leave it. Stored only on this device.</Text>
        {pinError ? <Text style={s.pinError}>{pinError}</Text> : null}
        <PinPad reset={resetTick} onComplete={onFirstPin} />
      </View>
    </View>
  )

  if (stage === 'confirmPin') return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Header title="Confirm PIN" />
      <View style={s.pinScreen}>
        <Text style={s.pinTitle}>Enter it again</Text>
        <PinPad reset={resetTick} onComplete={onConfirmPin} />
      </View>
    </View>
  )

  // ── Alias setup ──
  if (stage === 'aliasSetup') return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Header title="Pick your Zone alias" />
      <ScrollView contentContainerStyle={s.aliasScreen}>
        <Text style={s.aliasEmoji}>🎭</Text>
        <Text style={s.aliasTitle}>How should others see you?</Text>
        <Text style={s.aliasSub}>Your real name & avatar are hidden in the Zone until a mutual Reveal.</Text>
        <TextInput
          style={s.aliasInput}
          value={aliasInput}
          onChangeText={setAliasInput}
          placeholder="Type an alias…"
          placeholderTextColor={GRAY}
          maxLength={40}
          autoCapitalize="none"
        />
        <Text style={s.aliasHint}>Or pick one Teeby suggested:</Text>
        <View style={s.aliasOpts}>
          {aliasSuggestions.map(a => (
            <TouchableOpacity key={a} style={s.aliasOpt} onPress={() => setAliasInput(a)}>
              <Text style={s.aliasOptText}>{a}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => setAliasSuggestions(suggestAliases())} style={s.refreshBtn}>
          <Text style={s.refreshBtnText}>↻ Suggest more</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.cta, !aliasInput.trim() && { opacity: 0.4 }]}
          onPress={() => onSaveAlias(aliasInput.trim())}
          disabled={!aliasInput.trim()}>
          <Text style={s.ctaText}>Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )

  // ── Lock ──
  if (stage === 'lock') return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <Header title="Tryber Zone ✦" />
      <View style={s.pinScreen}>
        <Text style={s.pinEmoji}>🔒</Text>
        <Text style={s.pinTitle}>Enter your PIN</Text>
        {pinError ? <Text style={s.pinError}>{pinError}</Text> : null}
        <PinPad reset={resetTick} onComplete={onUnlockPin} />
        <TouchableOpacity onPress={async () => {
          Alert.alert('Reset PIN?', 'You will need to set a new PIN. Your matches and signals are preserved.',
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', style: 'destructive', onPress: async () => {
              await clearPin(); setStage('setPin')
            } }])
        }} style={{ marginTop: 18 }}>
          <Text style={{ color: PRIMARY, fontSize: 13 }}>Forgot PIN — reset</Text>
        </TouchableOpacity>
      </View>
    </View>
  )

  // ── Home (matches + settings) ──
  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <Header title="Tryber Zone ✦" />
      <View style={s.tabs}>
        {(['people', 'matches', 'settings'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive]}>
              {t === 'people'
                ? `People${people.length > 0 ? ` (${people.length})` : ''}`
                : t === 'matches'
                  ? `Matches${matches.length > 0 ? ` (${matches.length})` : ''}`
                  : 'Settings'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* PEOPLE — contacts on Tryber + members from my Trybes. Tap a row to
          open the signal sheet. Discreet "Signaled ✓" badge for rows you've
          already rated. */}
      {tab === 'people' && (
        <FlatList
          data={people}
          keyExtractor={p => p.id}
          contentContainerStyle={people.length === 0 ? { flex: 1 } : { padding: 12, gap: 8 }}
          ListEmptyComponent={(
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>👥</Text>
              <Text style={s.emptyTitle}>No people to discover yet</Text>
              <Text style={s.emptySub}>Join a Trybe or save people from your contacts. We'll surface them here so you can rate the vibe.</Text>
            </View>
          )}
          renderItem={({ item: p }) => {
            const dn = p.display_name || p.username || 'User'
            return (
              <TouchableOpacity style={s.personRow} onPress={() => setSignalTarget(p)}>
                <View style={s.personAvatar}>
                  {p.avatar_url
                    ? <Image source={{ uri: p.avatar_url }} style={{ width: '100%', height: '100%' }} />
                    : <Text style={{ fontSize: 22 }}>{p.avatar_char || dn[0] || '?'}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.personName} numberOfLines={1}>{dn}</Text>
                  <Text style={s.personSrc}>
                    {p.source === 'contact' ? '📇 In your contacts' : '👥 From your Trybes'}
                  </Text>
                </View>
                <View style={[s.personChip, p.has_signal && s.personChipDone]}>
                  <Text style={[s.personChipText, p.has_signal && s.personChipTextDone]}>
                    {p.has_signal ? '✓ Signaled' : '✦ Rate'}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          }}
        />
      )}

      {/* Signal sheet — opened from a People row. After closing, refresh so
          the "Signaled ✓" badge appears on the row. */}
      {userId && signalTarget && (
        <ZoneSignalSheet
          visible={!!signalTarget}
          onClose={() => { setSignalTarget(null); refreshPeople() }}
          myId={userId}
          targetId={signalTarget.id}
          targetAlias={signalTarget.display_name || signalTarget.username || null}
        />
      )}

      {tab === 'matches' && (
        <FlatList data={matches.filter(m => m.my_status !== 'passed' && m.their_status !== 'passed')}
          keyExtractor={m => m.match_id}
          contentContainerStyle={matches.length === 0 ? { flex: 1 } : { padding: 12, gap: 10 }}
          ListEmptyComponent={(
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>✦</Text>
              <Text style={s.emptyTitle}>No matches yet</Text>
              <Text style={s.emptySub}>Tap the ✦ on someone's profile to send a discreet signal. If they signal you back, you'll see a match here.</Text>
            </View>
          )}
          renderItem={({ item: m }) => {
            const revealed = m.both_revealed
            const iAmPending = m.my_status === 'pending'
            return (
              <View style={s.matchCard}>
                <View style={[s.matchAvatar, revealed && s.matchAvatarRevealed]}>
                  <Text style={s.matchAvatarText}>{revealed ? (m.partner_avatar || '✦') : '✦'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.matchName}>{revealed ? (m.partner_display_name || m.partner_alias) : m.partner_alias || 'Someone'}</Text>
                  <Text style={s.matchSub}>
                    {revealed ? '✨ Both revealed — you can chat!' :
                     iAmPending ? '✦ Mutual signal — reveal to continue' :
                     'Waiting for them to reveal…'}
                  </Text>
                </View>
                {revealed ? (
                  <TouchableOpacity style={s.matchChat} onPress={() => openChat(m)}>
                    <Text style={s.matchChatText}>💬 Chat</Text>
                  </TouchableOpacity>
                ) : iAmPending ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity style={s.matchPass} onPress={() => onPass(m)}>
                      <Text style={s.matchPassText}>Pass</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.matchReveal} onPress={() => onReveal(m)}>
                      <Text style={s.matchRevealText}>Reveal</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            )
          }} />
      )}

      {tab === 'settings' && (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={s.settingsRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.settingsLabel}>Available in Zone</Text>
              <Text style={s.settingsSub}>Off = you don't appear to others & can't be signaled.</Text>
            </View>
            <Switch value={status?.available !== false} onValueChange={onToggleAvailable}
              trackColor={{ true: LIVE, false: '#E0DED8' }} thumbColor="#fff" />
          </View>

          <Text style={s.settingsLabel}>Your alias</Text>
          <TextInput style={s.aliasInputSmall} value={status?.alias || ''}
            onChangeText={t => setStatus(s => s ? { ...s, alias: t } : s)}
            placeholder="alias" placeholderTextColor={GRAY} maxLength={40} />
          <TouchableOpacity style={s.smallBtn} onPress={() => status?.alias && onSaveAlias(status.alias)}>
            <Text style={s.smallBtnText}>Save alias</Text>
          </TouchableOpacity>

          <Text style={[s.settingsLabel, { marginTop: 22 }]}>Private photos ({photos.length}/4)</Text>
          <Text style={s.settingsSub}>Only visible to fully-revealed matches.</Text>
          <View style={s.photoGrid}>
            {photos.map((p: any) => (
              <View key={p.id} style={s.photoBox}>
                <Image source={{ uri: p.url }} style={s.photoImg} resizeMode="cover" />
                <TouchableOpacity style={s.photoRemove} onPress={() => onDeletePhoto(p.id)}>
                  <Text style={s.photoRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < 4 && (
              <TouchableOpacity style={[s.photoBox, s.photoAdd]} onPress={onAddPhoto} disabled={uploading}>
                {uploading ? <ActivityIndicator color={PRIMARY} /> : <Text style={s.photoAddPlus}>＋</Text>}
              </TouchableOpacity>
            )}
          </View>

          <Text style={[s.settingsLabel, { marginTop: 26 }]}>Security</Text>
          <TouchableOpacity style={[s.smallBtn, { backgroundColor: '#FFEEEE' }]} onPress={async () => {
            Alert.alert('Change PIN?', 'You will be asked to set a new PIN now.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Change', onPress: async () => {
                await clearPin(); setStage('setPin')
              } }])
          }}>
            <Text style={[s.smallBtnText, { color: DANGER }]}>Change PIN</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.smallBtn, { marginTop: 8 }]} onPress={async () => { await endSession(); setStage('lock') }}>
            <Text style={s.smallBtnText}>Lock Zone now</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4, width: 36 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 32, marginTop: -4 },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: TEXT, textAlign: 'center' },

  paywall: { padding: 24, alignItems: 'center' },
  paywallEmoji: { fontSize: 56, color: PRIMARY, marginBottom: 8 },
  paywallTitle: { fontSize: 26, fontWeight: '800', color: TEXT, marginBottom: 6 },
  paywallSub: { fontSize: 14, color: GRAY, textAlign: 'center', marginBottom: 26, lineHeight: 20, paddingHorizontal: 12 },
  bulletRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14, paddingHorizontal: 4 },
  bulletEmoji: { fontSize: 20, marginTop: 2 },
  bulletText: { flex: 1, fontSize: 14, color: TEXT, lineHeight: 20 },
  priceCard: { backgroundColor: CARD, borderRadius: 18, padding: 20, alignItems: 'center', marginTop: 18, marginBottom: 18, width: '100%', borderWidth: 1.5, borderColor: PRIMARY },
  price: { fontSize: 36, fontWeight: '800', color: PRIMARY },
  priceUnit: { fontSize: 16, color: GRAY, fontWeight: '600' },
  priceSub: { fontSize: 12, color: GRAY, marginTop: 4 },
  cta: { backgroundColor: PRIMARY, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 16, width: '100%', alignItems: 'center', marginBottom: 14 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  legal: { fontSize: 11, color: GRAY, textAlign: 'center', lineHeight: 16 },

  pinScreen: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 30, paddingHorizontal: 24 },
  pinEmoji: { fontSize: 44, marginBottom: 12 },
  pinTitle: { fontSize: 20, fontWeight: '700', color: TEXT, textAlign: 'center', marginBottom: 8 },
  pinSub: { fontSize: 13, color: GRAY, textAlign: 'center', marginBottom: 18 },
  pinError: { fontSize: 13, color: DANGER, marginBottom: 12 },

  aliasScreen: { padding: 24, alignItems: 'center' },
  aliasEmoji: { fontSize: 48, marginBottom: 8 },
  aliasTitle: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 6 },
  aliasSub: { fontSize: 13, color: GRAY, textAlign: 'center', marginBottom: 20, paddingHorizontal: 8, lineHeight: 18 },
  aliasInput: { width: '100%', backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, color: TEXT, borderWidth: 1.5, borderColor: PRIMARY, textAlign: 'center', fontWeight: '700' },
  aliasHint: { fontSize: 13, color: GRAY, marginTop: 22, marginBottom: 10 },
  aliasOpts: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  aliasOpt: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  aliasOptText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  refreshBtn: { marginTop: 12, marginBottom: 20 },
  refreshBtnText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },

  tabs: { flexDirection: 'row', backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: BORDER },
  personAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  personName: { fontSize: 15, fontWeight: '600', color: TEXT },
  personSrc: { fontSize: 11, color: GRAY, marginTop: 1 },
  personChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#EEF0FF', borderWidth: 1, borderColor: PRIMARY },
  personChipDone: { backgroundColor: '#E8F5E9', borderColor: LIVE },
  personChipText: { fontSize: 12, fontWeight: '700', color: PRIMARY },
  personChipTextDone: { color: LIVE },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: PRIMARY },
  tabBtnText: { fontSize: 13, color: GRAY, fontWeight: '500' },
  tabBtnTextActive: { color: PRIMARY, fontWeight: '700' },

  matchCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, borderRadius: 14, padding: 12, borderWidth: 0.5, borderColor: BORDER },
  matchAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: BORDER },
  matchAvatarRevealed: { borderColor: PRIMARY },
  matchAvatarText: { fontSize: 22 },
  matchName: { fontSize: 15, fontWeight: '700', color: TEXT },
  matchSub: { fontSize: 12, color: GRAY, marginTop: 2 },
  matchChat: { backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14 },
  matchChatText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  matchReveal: { backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14 },
  matchRevealText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  matchPass: { backgroundColor: BG, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: BORDER },
  matchPassText: { color: GRAY, fontSize: 13, fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 56, color: PRIMARY, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: TEXT, marginBottom: 6 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center', lineHeight: 20 },

  settingsLabel: { fontSize: 12, fontWeight: '700', color: GRAY, letterSpacing: 0.8, marginTop: 10, marginBottom: 6 },
  settingsSub: { fontSize: 12, color: GRAY, marginBottom: 8 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 14, marginBottom: 8 },
  aliasInputSmall: { backgroundColor: CARD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: BORDER },
  smallBtn: { backgroundColor: '#EEF0FF', paddingVertical: 10, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  smallBtnText: { color: PRIMARY, fontSize: 14, fontWeight: '700' },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  photoBox: { width: 100, height: 100, borderRadius: 12, overflow: 'hidden', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, position: 'relative' },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  photoRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  photoAdd: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' as any },
  photoAddPlus: { fontSize: 32, color: PRIMARY, fontWeight: '700' },
})
