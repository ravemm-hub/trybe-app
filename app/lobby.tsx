import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'

export default function LobbyScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>()
  const router = useRouter()
  const [group, setGroup] = useState<any>(null)
  const [joined, setJoined] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
    loadGroup()
  }, [])

  const loadGroup = async () => {
    const { data } = await supabase.from('groups').select('*').eq('id', id).single()
    if (data) {
      setGroup(data)
      if (data.status === 'open') {
        router.replace({ pathname: '/chat', params: { id, name: data.name, members: data.member_count.toString() } })
      }
    }
    setLoading(false)
  }

  // Realtime — watch for group opening
  useEffect(() => {
    const channel = supabase
      .channel(`lobby:${id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new
        setGroup(updated)
        if (updated.status === 'open') {
          router.replace({ pathname: '/chat', params: { id, name: updated.name, members: updated.member_count.toString() } })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  const joinLobby = async () => {
    if (!userId) return
    try {
      await supabase.from('group_members').insert({ group_id: id, user_id: userId })
      setJoined(true)
      setGroup((prev: any) => prev ? { ...prev, member_count: prev.member_count + 1 } : prev)
    } catch (err: any) {
      Alert.alert('שגיאה', err.message)
    }
  }

  if (loading || !group) {
    return <View style={s.center}><ActivityIndicator color={GREEN} size="large" /></View>
  }

  const pct = Math.min(100, Math.round((group.member_count / group.min_members) * 100))
  const remaining = Math.max(0, group.min_members - group.member_count)

  return (
    <SafeAreaView style={s.container}>
      <TouchableOpacity onPress={() => router.back()} style={s.back}>
        <Text style={s.backText}>‹ חזרה</Text>
      </TouchableOpacity>

      <View style={s.content}>
        <Text style={s.emoji}>🐦</Text>
        <Text style={s.title}>{group.name}</Text>
        {group.location_name && <Text style={s.location}>📍 {group.location_name}</Text>}

        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statNum}>{group.member_count}</Text>
            <Text style={s.statLabel}>בלובי</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNum}>{group.min_members}</Text>
            <Text style={s.statLabel}>נדרש</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={[s.statNum, { color: PURPLE }]}>{remaining}</Text>
            <Text style={s.statLabel}>חסרים</Text>
          </View>
        </View>

        <View style={s.progressSection}>
          <View style={s.progressBg}>
            <View style={[s.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={s.pctText}>{pct}% מהדרך</Text>
        </View>

        <View style={s.infoCard}>
          <Text style={s.infoText}>
            הצ׳אט ייפתח אוטומטית כשיגיעו {group.min_members} אנשים.{'\n'}
            תקבל עדכון מיידי על הטלפון.
          </Text>
        </View>

        {!joined ? (
          <TouchableOpacity style={s.joinBtn} onPress={joinLobby}>
            <Text style={s.joinBtnText}>הצטרף ללובי</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.joinedMsg}>
            <Text style={s.joinedText}>✓ אתה בלובי — ממתין לפתיחה...</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const GREEN = '#1D9E75'
const PURPLE = '#7F77DD'
const GRAY = '#888780'

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { padding: 20, paddingBottom: 0 },
  backText: { fontSize: 16, color: GREEN, fontWeight: '500' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#2C2C2A', textAlign: 'center', marginBottom: 8 },
  location: { fontSize: 14, color: GRAY, marginBottom: 32 },
  statsRow: { flexDirection: 'row', gap: 0, marginBottom: 28, backgroundColor: '#F1EFE8', borderRadius: 16, overflow: 'hidden' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statNum: { fontSize: 28, fontWeight: '800', color: '#2C2C2A' },
  statLabel: { fontSize: 11, color: GRAY, marginTop: 2 },
  statDivider: { width: 0.5, backgroundColor: '#E0DED8', marginVertical: 12 },
  progressSection: { width: '100%', marginBottom: 24 },
  progressBg: { height: 8, backgroundColor: '#F1EFE8', borderRadius: 4, marginBottom: 8 },
  progressFill: { height: 8, backgroundColor: PURPLE, borderRadius: 4, minWidth: 8 },
  pctText: { fontSize: 13, color: PURPLE, fontWeight: '600', textAlign: 'center' },
  infoCard: { backgroundColor: '#E1F5EE', borderRadius: 14, padding: 16, marginBottom: 28, width: '100%' },
  infoText: { fontSize: 14, color: '#0F6E56', textAlign: 'center', lineHeight: 22 },
  joinBtn: { backgroundColor: PURPLE, paddingHorizontal: 40, paddingVertical: 15, borderRadius: 28, width: '100%', alignItems: 'center' },
  joinBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  joinedMsg: { backgroundColor: '#E1F5EE', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 28, width: '100%', alignItems: 'center' },
  joinedText: { color: GREEN, fontSize: 15, fontWeight: '600' },
})
