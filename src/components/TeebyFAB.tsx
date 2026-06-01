import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, KeyboardAvoidingView, TextInput, ActivityIndicator, ScrollView, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { planTask, executeFindAndDM, executeAskInGroups, findMembersMatching, TaskAction } from '../services/teebyTasks'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER } from '../constants'

// Floating ✦ button visible on every tab. Tap opens a Teeby task sheet:
// the user types what they want done, Teeby parses it into a structured
// action, the user confirms — only then is anything actually sent.

export function TeebyFAB() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <TouchableOpacity style={s.fab} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={s.fabIcon}>✦</Text>
      </TouchableOpacity>
      <TeebyTaskSheet visible={open} onClose={() => setOpen(false)} />
    </>
  )
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
      // Eagerly preview matching members so the user sees who would get DMed BEFORE
      // confirming. (find_only goes straight to a preview state with no DM stage.)
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
        setDoneMsg(`Posted in ${r.posted} ${r.posted === 1 ? 'Trybe' : 'Trybes'} ✦ — I'll keep an eye on replies`)
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not complete the task')
    } finally { setBusy(false) }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <KeyboardAvoidingView behavior="padding" style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.handle} />
          <View style={s.header}>
            <View style={s.headerAvatar}><Text style={s.headerAvatarText}>✦</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Ask Teeby</Text>
              <Text style={s.sub}>Give me a task — I'll plan it and ask before doing anything.</Text>
            </View>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>✕</Text></TouchableOpacity>
          </View>

          {/* Example chips when the sheet first opens */}
          {!plan && !busy && !doneMsg && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4, paddingBottom: 8 }}>
              {[
                'Find someone in BBQ Friday who likes vegan and ask them about Friday',
                'Ask in all my groups if anyone has a good GPU laptop',
                'Find someone who plays tennis nearby',
                'Post in my coffee group: who wants to grab a coffee tomorrow?',
              ].map(ex => (
                <TouchableOpacity key={ex} style={s.exampleChip} onPress={() => setDraft(ex)}>
                  <Text style={s.exampleChipText} numberOfLines={1}>{ex}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* PLAN PREVIEW — confirmation card */}
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

          {/* FIND ONLY — just a results list, nothing actioned */}
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

          {/* REPLY — Teeby just wanted to talk back */}
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

          {/* DONE state */}
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
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  fab: { position: 'absolute', right: 16, bottom: 78, width: 56, height: 56, borderRadius: 28, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: PRIMARY, shadowOpacity: 0.4, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, zIndex: 100 },
  fabIcon: { fontSize: 28, color: '#fff', fontWeight: '800' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 14, maxHeight: '85%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginVertical: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEF0FF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: PRIMARY },
  headerAvatarText: { fontSize: 18, color: PRIMARY, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '800', color: TEXT },
  sub: { fontSize: 12, color: GRAY, marginTop: 1 },
  close: { fontSize: 18, color: GRAY, paddingHorizontal: 6 },
  exampleChip: { backgroundColor: BG, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: BORDER, maxWidth: 260 },
  exampleChipText: { fontSize: 12, color: TEXT },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingTop: 10, paddingBottom: 8 },
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
