import { Text, View, Image, TouchableOpacity, Linking, StyleSheet } from 'react-native'
import { parseImageHints } from '../lib/claude'
import { PRIMARY, BORDER } from '../constants'

// Renders a Teeby / agent text reply with:
// 1. `IMAGE_URL: <url>` lines pulled out and rendered as image previews underneath.
// 2. Plain http(s) URLs in the text turned into tappable links (open in browser).
// Used by the Teeby tab + DM agent replies + agent group messages, so a single
// look-and-feel.

const URL_RE = /(https?:\/\/[^\s)]+)/g

type Props = {
  content: string
  isMe?: boolean
}

function linkifyText(text: string, color: string, linkColor: string) {
  // Split keeping URL groups so we can map each part to a Text/Linking element.
  const parts = text.split(URL_RE)
  return (
    <Text style={{ fontSize: 15, lineHeight: 22, color }}>
      {parts.map((part, i) => {
        if (URL_RE.test(part)) {
          // Reset regex state after .test() before reusing.
          URL_RE.lastIndex = 0
          return (
            <Text key={i} style={{ color: linkColor, textDecorationLine: 'underline' }}
              onPress={() => Linking.openURL(part).catch(() => {})}>
              {part}
            </Text>
          )
        }
        URL_RE.lastIndex = 0
        return <Text key={i}>{part}</Text>
      })}
    </Text>
  )
}

export function RichMessage({ content, isMe }: Props) {
  const { text, imageUrls } = parseImageHints(content)
  const color = isMe ? '#fff' : '#1A1A1A'
  const linkColor = isMe ? '#E0DEFF' : PRIMARY
  return (
    <View>
      {text ? linkifyText(text, color, linkColor) : null}
      {imageUrls.map((url, i) => (
        <TouchableOpacity key={url + i} onPress={() => Linking.openURL(url).catch(() => {})} activeOpacity={0.85}>
          <Image source={{ uri: url }} style={s.img} resizeMode="cover" />
        </TouchableOpacity>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  img: { width: 240, height: 180, borderRadius: 12, marginTop: 8, borderWidth: 0.5, borderColor: BORDER, backgroundColor: '#EEE' },
})
