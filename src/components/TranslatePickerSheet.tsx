import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { TRANSLATE_LANGS, TranslateLang } from '../lib/translatePref'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER } from '../constants'

// Bottom-sheet language picker used by chat & DM for choosing translation
// target language. Optional "Auto" row that clears any preference.

type Props = {
  visible: boolean
  onClose: () => void
  selected: TranslateLang | null
  onPick: (lang: TranslateLang | null) => void
  title?: string
}

export function TranslatePickerSheet({ visible, onClose, selected, onPick, title }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>{title || 'Translate to…'}</Text>
          <ScrollView style={{ maxHeight: 380 }}>
            <TouchableOpacity style={[s.row, selected === null && s.rowSel]} onPress={() => { onPick(null); onClose() }}>
              <Text style={s.emoji}>✦</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.label, selected === null && { fontWeight: '800', color: PRIMARY }]}>Auto</Text>
                <Text style={s.sub}>Hebrew ↔ English based on the source</Text>
              </View>
              {selected === null && <Text style={s.check}>✓</Text>}
            </TouchableOpacity>
            {TRANSLATE_LANGS.map(lang => (
              <TouchableOpacity key={lang} style={[s.row, selected === lang && s.rowSel]} onPress={() => { onPick(lang); onClose() }}>
                <Text style={s.emoji}>{flagFor(lang)}</Text>
                <Text style={[s.label, selected === lang && { fontWeight: '800', color: PRIMARY }, { flex: 1 }]}>{lang}</Text>
                {selected === lang && <Text style={s.check}>✓</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function flagFor(lang: TranslateLang): string {
  switch (lang) {
    case 'English': return '🇬🇧'
    case 'Hebrew': return '🇮🇱'
    case 'Arabic': return '🇸🇦'
    case 'Russian': return '🇷🇺'
    case 'French': return '🇫🇷'
    case 'Spanish': return '🇪🇸'
    case 'German': return '🇩🇪'
    case 'Italian': return '🇮🇹'
    case 'Portuguese': return '🇵🇹'
    case 'Ukrainian': return '🇺🇦'
    case 'Chinese': return '🇨🇳'
    case 'Japanese': return '🇯🇵'
  }
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingBottom: 18, paddingHorizontal: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginTop: 4, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700', color: TEXT, paddingHorizontal: 8, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12 },
  rowSel: { backgroundColor: '#F5F4FF' },
  emoji: { fontSize: 20 },
  label: { fontSize: 15, color: TEXT, fontWeight: '500' },
  sub: { fontSize: 12, color: GRAY, marginTop: 1 },
  check: { fontSize: 16, color: PRIMARY, fontWeight: '700' },
})
