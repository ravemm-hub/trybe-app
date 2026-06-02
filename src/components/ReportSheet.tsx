import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { submitReport, REASON_LABELS, ReportTarget, ReportReason } from '../services/moderation'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, DANGER, LIVE } from '../constants'

type Props = {
  visible: boolean
  onClose: () => void
  target: { type: ReportTarget; id: string } | null
  targetLabel?: string   // e.g. "User Maya" / "Post" — shown in the title
}

export function ReportSheet({ visible, onClose, target, targetLabel }: Props) {
  const insets = useSafeAreaInsets()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!target || !reason) return
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { Alert.alert('Sign in required'); return }
      const { error } = await submitReport(user.id, target, reason, comment)
      if (error) { Alert.alert("Couldn't submit report", error.message); return }
      onClose(); setReason(null); setComment('')
      Alert.alert('Reported', 'Thanks — our team will review this within 24h.')
    } finally { setBusy(false) }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.handle} />
          <Text style={s.title}>Report {targetLabel || 'this'}</Text>
          <Text style={s.sub}>Reports are reviewed by our moderation team. False reports can result in account action.</Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {(Object.keys(REASON_LABELS) as ReportReason[]).map(r => (
              <TouchableOpacity
                key={r}
                style={[s.option, reason === r && s.optionSel]}
                onPress={() => setReason(r)}
              >
                <Text style={[s.optionText, reason === r && { color: PRIMARY, fontWeight: '700' }]}>{REASON_LABELS[r]}</Text>
                {reason === r && <Text style={s.optionCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TextInput
              style={s.commentInput}
              value={comment}
              onChangeText={setComment}
              placeholder="Add a note for the moderation team (optional)"
              placeholderTextColor={GRAY}
              multiline
              maxLength={500}
            />
          </ScrollView>
          <View style={s.btnRow}>
            <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.submitBtn, (!reason || busy) && { opacity: 0.4 }]}
              onPress={submit}
              disabled={!reason || busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Submit report</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginVertical: 8 },
  title: { fontSize: 17, fontWeight: '800', color: TEXT, marginBottom: 4 },
  sub: { fontSize: 12, color: GRAY, marginBottom: 14, lineHeight: 16 },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: BG, marginBottom: 6, borderWidth: 1, borderColor: BORDER },
  optionSel: { backgroundColor: '#F5F4FF', borderColor: PRIMARY },
  optionText: { flex: 1, fontSize: 14, color: TEXT },
  optionCheck: { fontSize: 16, color: PRIMARY, fontWeight: '800' },
  commentInput: { backgroundColor: BG, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: TEXT, marginTop: 10, minHeight: 70, textAlignVertical: 'top', borderWidth: 1, borderColor: BORDER },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: BORDER, backgroundColor: BG },
  cancelBtnText: { fontSize: 14, color: GRAY, fontWeight: '600' },
  submitBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: DANGER },
  submitBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
})
