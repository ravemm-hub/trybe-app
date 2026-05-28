import { useState, useEffect, useRef } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from 'react-native'
import { Audio } from 'expo-av'
import { PRIMARY, BG, GRAY, BORDER } from '../constants'

export function MediaBubble({ url, kind, isMe }: { url: string; kind?: string; isMe?: boolean }) {
  if (kind === 'image') {
    return <Image source={{ uri: url }} style={s.image} resizeMode="cover" />
  }
  if (kind === 'audio') return <AudioPlayer url={url} isMe={isMe} />
  const name = decodeURIComponent((url.split('/').pop() || 'file').replace(/^\d+_/, ''))
  return (
    <TouchableOpacity style={[s.fileRow, isMe && { backgroundColor: 'rgba(255,255,255,0.18)' }]} onPress={() => Linking.openURL(url).catch(() => {})}>
      <Text style={{ fontSize: 22 }}>📄</Text>
      <Text style={[s.fileName, isMe && { color: '#fff' }]} numberOfLines={1}>{name}</Text>
    </TouchableOpacity>
  )
}

function AudioPlayer({ url, isMe }: { url: string; isMe?: boolean }) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const soundRef = useRef<Audio.Sound | null>(null)

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}) }, [])

  const toggle = async () => {
    try {
      if (soundRef.current) {
        if (playing) { await soundRef.current.pauseAsync(); setPlaying(false) }
        else { await soundRef.current.replayAsync(); setPlaying(true) }
        return
      }
      setLoading(true)
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true })
      soundRef.current = sound
      sound.setOnPlaybackStatusUpdate((st: any) => { if (st?.didJustFinish) setPlaying(false) })
      setLoading(false); setPlaying(true)
    } catch { setLoading(false) }
  }

  return (
    <TouchableOpacity style={[s.audioRow, isMe && { backgroundColor: 'rgba(255,255,255,0.18)' }]} onPress={toggle}>
      {loading
        ? <ActivityIndicator color={isMe ? '#fff' : PRIMARY} />
        : <Text style={[s.audioIcon, isMe && { color: '#fff' }]}>{playing ? '⏸' : '▶'}</Text>}
      <Text style={[s.audioLabel, isMe && { color: '#fff' }]}>Voice message</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  image: { width: 200, height: 200, borderRadius: 12, marginBottom: 2 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: BG, borderRadius: 10, padding: 8, minWidth: 160 },
  fileName: { flex: 1, fontSize: 14, color: PRIMARY, fontWeight: '600' },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: BG, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, minWidth: 160 },
  audioIcon: { fontSize: 18, color: PRIMARY },
  audioLabel: { fontSize: 14, color: GRAY, fontWeight: '500' },
})
