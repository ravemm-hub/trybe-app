import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER } from '../constants'

// Reusable 4-digit pin entry component. Calls onComplete(pin) once 4 digits
// are entered. The parent decides whether to verify or store.

type Props = {
  onComplete: (pin: string) => void
  reset?: number  // bump to clear the entered digits
}

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

export function PinPad({ onComplete, reset }: Props) {
  const [pin, setPin] = useState('')

  // Clear when parent bumps `reset`.
  // We intentionally watch reset directly inside the handler closure so
  // changing it forces a fresh render with the cleared state.
  if (reset !== undefined && pin && (PinPad as any)._lastReset !== reset) {
    (PinPad as any)._lastReset = reset
    setPin('')
  }

  const press = (k: string) => {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); return }
    if (!k) return
    if (pin.length >= 4) return
    const next = pin + k
    setPin(next)
    if (next.length === 4) setTimeout(() => onComplete(next), 100)
  }

  return (
    <View style={s.wrap}>
      <View style={s.dots}>
        {[0,1,2,3].map(i => (
          <View key={i} style={[s.dot, i < pin.length && s.dotFilled]} />
        ))}
      </View>
      <View style={s.pad}>
        {KEYS.map((k, i) => (
          <TouchableOpacity key={i} style={[s.key, !k && s.keyEmpty]} onPress={() => press(k)} disabled={!k}>
            <Text style={s.keyText}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 14 },
  dots: { flexDirection: 'row', gap: 18, marginBottom: 28 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: BORDER, backgroundColor: BG },
  dotFilled: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  pad: { width: 280, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  key: { width: 80, height: 80, borderRadius: 40, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  keyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { fontSize: 26, fontWeight: '600', color: TEXT },
})
