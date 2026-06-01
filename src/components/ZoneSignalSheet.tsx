import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet, ActivityIndicator } from 'react-native'
import { getMySignal, setSignal, clearSignal, SignalLevel } from '../services/tryberZone'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, DANGER } from '../constants'

// Discreet 4-level signal selector. Opens as a bottom sheet from anywhere the
// app surfaces the small ✦ button on a Zone-active user's profile.

const LEVELS: { value: SignalLevel; emoji: string; label: string; tone: 'positive' | 'negative' }[] = [
  { value: 2,  emoji: '💖', label: 'Definitely yes', tone: 'positive' },
  { value: 1,  emoji: '😊', label: 'Yes, maybe',     tone: 'positive' },
  { value: -1, emoji: '🤔', label: 'Not really',     tone: 'negative' },
  { value: -2, emoji: '🙅', label: 'Definitely no',  tone: 'negative' },
]

type Props = {
  visible: boolean
  onClose: () => void
  myId: string
  targetId: string
  targetAlias: string | null   // we show the alias, never the real name here
}

export function ZoneSignalSheet({ visible, onClose, myId, targetId, targetAlias }: Props) {
  const [current, setCurrent] = useState<SignalLevel | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!visible) return
    setBusy(true)
    getMySignal(targetId).then(v => { setCurrent(v); setBusy(false) })
  }, [visible, targetId])

  const tap = async (lvl: SignalLevel) => {
    if (busy) return
    setBusy(true)
    // If the user re-taps the same level, treat that as "undo" (clear it).
    if (current === lvl) {
      await clearSignal(myId, targetId)
      setCurrent(null)
    } else {
      const { error } = await setSignal(myId, targetId, lvl)
      if (!error) setCurrent(lvl)
    }
    setBusy(false)
    setTimeout(onClose, 250)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>What's the vibe?</Text>
          <Text style={s.subtitle}>Discreet. They never see this. Only if they signal you back, Teeby tells you both 👀</Text>
          {busy ? <ActivityIndicator color={PRIMARY} style={{ paddingVertical: 12 }} /> : null}
          <View style={s.list}>
            {LEVELS.map(l => {
              const selected = current === l.value
              return (
                <TouchableOpacity key={l.value}
                  style={[s.opt, selected && (l.tone === 'positive' ? s.optSelPositive : s.optSelNegative)]}
                  onPress={() => tap(l.value)} disabled={busy}>
                  <Text style={s.optEmoji}>{l.emoji}</Text>
                  <Text style={[s.optLabel, selected && { fontWeight: '800', color: l.tone === 'positive' ? PRIMARY : DANGER }]}>{l.label}</Text>
                  {selected && <Text style={[s.tap, { color: l.tone === 'positive' ? PRIMARY : DANGER }]}>Tap to undo</Text>}
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={s.footer}>
            ✦ Your signal stays private. If they signal you back, Teeby will let you both know — that's it. You can chat from there.
          </Text>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 26 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', color: TEXT, textAlign: 'center' },
  alias: { color: PRIMARY, fontWeight: '800' },
  subtitle: { fontSize: 12, color: GRAY, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  list: { gap: 8 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  optSelPositive: { borderColor: PRIMARY, backgroundColor: '#EEF0FF' },
  optSelNegative: { borderColor: DANGER, backgroundColor: '#FFEEEE' },
  optEmoji: { fontSize: 22 },
  optLabel: { flex: 1, fontSize: 15, color: TEXT, fontWeight: '500' },
  tap: { fontSize: 11, fontWeight: '600' },
  footer: { fontSize: 11, color: GRAY, textAlign: 'center', marginTop: 16, lineHeight: 16 },
})
