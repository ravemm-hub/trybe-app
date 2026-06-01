import { useState, useEffect, useRef, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, KeyboardAvoidingView, TextInput, ActivityIndicator, ScrollView, Alert, Platform, Animated, PanResponder, Dimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { emit, on } from '../lib/events'
import { planTask, executeFindAndDM, executeAskInGroups, findMembersMatching, TaskAction } from '../services/teebyTasks'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER } from '../constants'

const FAB_EVENT = 'teeby_fab_visibility'

// Floating ✦ button visible on every tab. Tap → opens the Teeby task sheet.
// Long-press → choose to hide for this session or permanently. The user can
// re-enable it from Profile > Settings > "Show Teeby button".

const FAB_PREF_KEY = 'teeby_fab_visible_v1'
const FAB_POS_KEY = 'teeby_fab_pos_v1'        // { side: 'left'|'right', topPct: 0..1 }
const FAB_SIZE = 56
const EDGE_PAD = 10

type FabPos = { side: 'left' | 'right'; topPct: number }

export function TeebyFAB() {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(true)
  const screen = Dimensions.get('window')
  // Vertical bounds: under the status bar, above the tab bar (which is ~64+insets.bottom).
  const minY = insets.top + 8
  const maxY = screen.height - 64 - insets.bottom - FAB_SIZE - 12

  // Animated position. We track absolute x/y; release snaps x to the nearest
  // edge and persists {side, topPct} so the button "remembers" where the user
  // left it across screens AND across app launches.
  const pan = useRef(new Animated.ValueXY({ x: screen.width - FAB_SIZE - EDGE_PAD, y: maxY - 20 })).current
  const lastPos = useRef({ x: screen.width - FAB_SIZE - EDGE_PAD, y: maxY - 20 })
  const dragged = useRef(false)

  // Restore saved position on mount.
  useEffect(() => {
    AsyncStorage.getItem(FAB_POS_KEY).then(raw => {
      if (!raw) return
      try {
        const p: FabPos = JSON.parse(raw)
        const x = p.side === 'left' ? EDGE_PAD : (screen.width - FAB_SIZE - EDGE_PAD)
        const y = Math.max(minY, Math.min(maxY, minY + (maxY - minY) * (p.topPct || 0.85)))
        pan.setValue({ x, y })
        lastPos.current = { x, y }
      } catch {}
    })
  }, [])

  useEffect(() => {
    AsyncStorage.getItem(FAB_PREF_KEY).then(v => {
      if (v === '0') setVisible(false)
    })
    const off = on(FAB_EVENT, async () => {
      try { const v = await AsyncStorage.getItem(FAB_PREF_KEY); setVisible(v !== '0') } catch {}
    })
    return () => off()
  }, [])

  const askHide = () => {
    Alert.alert(
      'Hide Teeby button?',
      'You can turn it back on later from your Profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Hide for now', onPress: () => setVisible(false) },
        { text: 'Hide always', style: 'destructive', onPress: async () => { setVisible(false); try { await AsyncStorage.setItem(FAB_PREF_KEY, '0') } catch {} } },
      ],
    )
  }

  // PanResponder: only start tracking after a small movement so plain taps
  // still open the sheet (we don't capture every touch).
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_evt, gs) => Math.abs(gs.dx) > 6 || Math.abs(gs.dy) > 6,
    onPanResponderGrant: () => {
      dragged.current = true
      // Switch to absolute offset for free dragging.
      pan.setOffset({ x: lastPos.current.x, y: lastPos.current.y })
      pan.setValue({ x: 0, y: 0 })
    },
    onPanResponderMove: Animated.event(
      [null, { dx: pan.x, dy: pan.y }],
      { useNativeDriver: false },
    ),
    onPanResponderRelease: (_e, gs) => {
      pan.flattenOffset()
      let nx = lastPos.current.x + gs.dx
      let ny = lastPos.current.y + gs.dy
      // Clamp + snap to nearest horizontal edge.
      ny = Math.max(minY, Math.min(maxY, ny))
      const snapLeft = (nx + FAB_SIZE / 2) < screen.width / 2
      const snappedX = snapLeft ? EDGE_PAD : (screen.width - FAB_SIZE - EDGE_PAD)
      lastPos.current = { x: snappedX, y: ny }
      Animated.spring(pan, {
        toValue: { x: snappedX, y: ny },
        useNativeDriver: false, friction: 7, tension: 80,
      }).start()
      // Persist as proportional values so it survives orientation changes.
      const topPct = (ny - minY) / Math.max(1, maxY - minY)
      AsyncStorage.setItem(FAB_POS_KEY, JSON.stringify({ side: snapLeft ? 'left' : 'right', topPct })).catch(() => {})
      // Reset the dragged flag on next event loop so onPress is suppressed for this drag.
      setTimeout(() => { dragged.current = false }, 50)
    },
  }), [minY, maxY, screen.width])

  if (!visible) return null
  return (
    <>
      <Animated.View
        style={[s.fabWrap, { transform: pan.getTranslateTransform() }]}
        {...responder.panHandlers}
      >
        <TouchableOpacity
          style={s.fab}
          onPress={() => { if (!dragged.current) setOpen(true) }}
          onLongPress={askHide}
          delayLongPress={400}
          activeOpacity={0.8}
        >
          <Text style={s.fabIcon}>✦</Text>
        </TouchableOpacity>
      </Animated.View>
      <TeebyTaskSheet visible={open} onClose={() => setOpen(false)} />
    </>
  )
}

// Public helper so Profile can offer a "Show Teeby button" toggle.
export async function setTeebyFabVisible(visible: boolean) {
  try { await AsyncStorage.setItem(FAB_PREF_KEY, visible ? '1' : '0') } catch {}
  emit(FAB_EVENT)   // tell mounted <TeebyFAB/> instances to re-read
}
export async function getTeebyFabVisible(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(FAB_PREF_KEY)) !== '0' } catch { return true }
}

function TeebyTaskSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<TaskAction | null>(null)
  const [previewMembers, setPreviewMembers] = useState<{ id: string; name: string }[]>([])
  const [doneMsg, setDoneMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setDraft(''); setPlan(null); setPreviewMembers([]); setDoneMsg(null)
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUserId(user.id)
      const { data: p } = await supabase.from('profiles').select('display_name, username').eq('id', user.id).single()
      setUserName(p?.display_name || p?.username || '')
    })
  }, [visible])

  const ask = async () => {
    if (!userId || !draft.trim()) return
    setBusy(true); setPlan(null); setPreviewMembers([]); setDoneMsg(null)
    try {
      const a = await planTask(userId, userName, draft.trim(), '')
      setPlan(a)
      if (a.kind === 'find_and_dm') {
        const m = await findMembersMatching(a.group_id, a.criteria, 5)
        setPreviewMembers(m.map(x => ({ id: x.id, name: x.name })))
      } else if (a.kind === 'find_only' && a.group_id) {
        const m = await findMembersMatching(a.group_id, a.criteria, 5)
        setPreviewMembers(m.map(x => ({ id: x.id, name: x.name })))
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Teeby could not parse the task')
    } finally { setBusy(false) }
  }

  const confirm = async () => {
    if (!userId || !plan) return
    setBusy(true); setDoneMsg(null)
    try {
      if (plan.kind === 'find_and_dm') {
        const r = await executeFindAndDM(userId, plan)
        setDoneMsg(r.sent === 0
          ? "Couldn't find anyone matching that — try a different criteria."
          : `Sent your message to ${r.sent} ${r.sent === 1 ? 'person' : 'people'} ✦`)
      } else if (plan.kind === 'ask_in_groups') {
        const r = await executeAskInGroups(userId, plan)
        setDoneMsg(`Posted in ${r.posted} ${r.posted === 1 ? 'Trybe' : 'Trybes'} ✦`)
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not complete the task')
    } finally { setBusy(false) }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={s.overlayTap} onPress={onClose} activeOpacity={1} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerAvatar}><Text style={s.headerAvatarText}>✦</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Ask Teeby</Text>
              <Text style={s.sub}>Give me a task — I'll plan it and ask before doing anything.</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable body so long plan cards never overflow */}
          <ScrollView
            style={s.body}
            contentContainerStyle={{ paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!plan && !busy && !doneMsg && (
              <View style={s.examplesWrap}>
                <Text style={s.examplesLabel}>EXAMPLES</Text>
                {[
                  '🍻 Find someone in BBQ Friday who likes vegan and ask them about Friday',
                  '💻 Ask in all my groups if anyone has a good GPU laptop',
                  '🎾 Find someone who plays tennis nearby',
                  '☕ Post in my coffee group: who wants to grab a coffee tomorrow?',
                ].map(ex => (
                  <TouchableOpacity key={ex} style={s.exampleRow} onPress={() => setDraft(ex.replace(/^[^\s]+\s/, ''))}>
                    <Text style={s.exampleRowText}>{ex}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {plan && (plan.kind === 'find_and_dm' || plan.kind === 'ask_in_groups') && !doneMsg && (
              <View style={s.planCard}>
                <Text style={s.planTitle}>Here's my plan ✦</Text>
                {plan.kind === 'find_and_dm' && (
                  <>
                    <Text style={s.planLine}>1. Find members of <Text style={s.bold}>"{plan.group_name}"</Text></Text>
                    <Text style={s.planLine}>2. Who match: <Text style={s.bold}>{plan.criteria}</Text></Text>
                    {previewMembers.length > 0 && (
                      <View style={s.previewBox}>
                        <Text style={s.previewLabel}>WHO I'D DM ({previewMembers.length}):</Text>
                        {previewMembers.map(m => (
                          <Text key={m.id} style={s.previewName}>• {m.name}</Text>
                        ))}
                      </View>
                    )}
                    <Text style={s.planLine}>3. DM them:</Text>
                    <View style={s.messageBox}><Text style={s.messageText}>{plan.message}</Text></View>
                  </>
                )}
                {plan.kind === 'ask_in_groups' && (
                  <>
                    <Text style={s.planLine}>Post in <Text style={s.bold}>{plan.group_names.length}</Text> {plan.group_names.length === 1 ? 'Trybe' : 'Trybes'}:</Text>
                    <View style={s.previewBox}>
                      {plan.group_names.map(n => <Text key={n} style={s.previewName}>• {n}</Text>)}
                    </View>
                    <View style={s.messageBox}><Text style={s.messageText}>{plan.message}</Text></View>
                  </>
                )}
                <View style={s.planBtns}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => { setPlan(null); setPreviewMembers([]) }}>
                    <Text style={s.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.confirmBtn} onPress={confirm} disabled={busy}>
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmBtnText}>Yes — do it ✦</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {plan && plan.kind === 'find_only' && !doneMsg && (
              <View style={s.planCard}>
                <Text style={s.planTitle}>Here's who I found ✦</Text>
                {previewMembers.length === 0
                  ? <Text style={s.planLine}>No one matching "{plan.criteria}" yet.</Text>
                  : previewMembers.map(m => (
                      <Text key={m.id} style={s.previewName}>• {m.name}</Text>
                    ))}
                <View style={s.planBtns}>
                  <TouchableOpacity style={[s.confirmBtn, { flex: 1 }]} onPress={() => { setPlan(null); setPreviewMembers([]) }}>
                    <Text style={s.confirmBtnText}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {plan && plan.kind === 'reply' && !doneMsg && (
              <View style={s.planCard}>
                <Text style={s.planLine}>{plan.text}</Text>
                <View style={s.planBtns}>
                  <TouchableOpacity style={[s.confirmBtn, { flex: 1 }]} onPress={() => setPlan(null)}>
                    <Text style={s.confirmBtnText}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {doneMsg && (
              <View style={s.planCard}>
                <Text style={s.planLine}>{doneMsg}</Text>
                <View style={s.planBtns}>
                  <TouchableOpacity style={[s.confirmBtn, { flex: 1 }]} onPress={onClose}>
                    <Text style={s.confirmBtnText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Sticky input row at the bottom — only when no plan / done state */}
          {!plan && !doneMsg && (
            <View style={s.inputRow}>
              <TextInput
                style={s.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="What do you want me to do?"
                placeholderTextColor={GRAY}
                multiline
              />
              <TouchableOpacity style={[s.sendBtn, (!draft.trim() || busy) && { opacity: 0.4 }]} onPress={ask} disabled={!draft.trim() || busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.sendBtnText}>↑</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  // Animated wrapper is absolutely-positioned; the transform handles x/y.
  fabWrap: { position: 'absolute', top: 0, left: 0, zIndex: 100 },
  fab: { width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: PRIMARY, shadowOpacity: 0.4, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8 },
  fabIcon: { fontSize: 28, color: '#fff', fontWeight: '800' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  overlayTap: { flex: 1 },
  // Bottom-anchored, fixed height range so the sheet is always tall enough to
  // see the title + body + input row at once — fixes the "opens cramped" bug.
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 6, paddingHorizontal: 14, minHeight: '55%', maxHeight: '88%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginVertical: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PRIMARY },
  headerAvatarText: { fontSize: 18, color: PRIMARY, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '800', color: TEXT },
  sub: { fontSize: 12, color: GRAY, marginTop: 1 },
  close: { fontSize: 18, color: GRAY, paddingHorizontal: 6 },
  body: { flex: 1 },
  examplesWrap: { paddingTop: 4 },
  examplesLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 0.8, paddingHorizontal: 4, marginBottom: 8 },
  exampleRow: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: BG, marginBottom: 8, borderWidth: 1, borderColor: BORDER },
  exampleRowText: { fontSize: 13, color: TEXT, lineHeight: 18 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingTop: 8, paddingBottom: 4, borderTopWidth: 0.5, borderColor: BORDER },
  input: { flex: 1, backgroundColor: BG, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: TEXT, maxHeight: 110, borderWidth: 1, borderColor: BORDER },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  planCard: { backgroundColor: BG, borderRadius: 14, padding: 14, marginVertical: 8, borderWidth: 1, borderColor: BORDER },
  planTitle: { fontSize: 14, fontWeight: '800', color: PRIMARY, marginBottom: 8 },
  planLine: { fontSize: 14, color: TEXT, lineHeight: 19, marginBottom: 4 },
  bold: { fontWeight: '700' },
  previewBox: { backgroundColor: CARD, borderRadius: 10, padding: 10, marginVertical: 6, borderWidth: 0.5, borderColor: BORDER },
  previewLabel: { fontSize: 10, fontWeight: '700', color: GRAY, letterSpacing: 0.5, marginBottom: 4 },
  previewName: { fontSize: 13, color: TEXT, marginBottom: 2 },
  messageBox: { backgroundColor: CARD, borderLeftWidth: 3, borderLeftColor: PRIMARY, paddingHorizontal: 10, paddingVertical: 8, marginVertical: 6, borderRadius: 8 },
  messageText: { fontSize: 13, color: TEXT, lineHeight: 18, fontStyle: 'italic' },
  planBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  cancelBtn: { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, color: GRAY, fontWeight: '600' },
  confirmBtn: { flex: 1, backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
})
