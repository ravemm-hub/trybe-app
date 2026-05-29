import { useState, useEffect, useRef } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, KeyboardAvoidingView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../src/lib/supabase'
import { uuidv4 } from '../src/lib/uuid'
import { PRIMARY, BG, CARD, TEXT, GRAY, BORDER, LIVE, DANGER } from '../src/constants'

type Item = { id: string; text: string; done: boolean }

export default function SharedListScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<any>()
  const otherId = params?.userId || ''
  const otherName = params?.userName || 'someone'
  const [listId, setListId] = useState<string | null>(null)
  const [title, setTitle] = useState('Shopping list')
  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!otherId) { router.back(); return }
    let channel: ReturnType<typeof supabase.channel> | null = null
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      try {
        const { data: existing } = await supabase.from('shared_lists').select('*')
          .contains('dm_between', [user.id, otherId]).order('created_at', { ascending: true }).limit(1)
        let row: any = existing?.[0]
        if (!row) {
          const { data: created } = await supabase.from('shared_lists')
            .insert({ dm_between: [user.id, otherId], title: 'Shopping list', items: [], created_by: user.id })
            .select().single()
          row = created
        }
        if (row) {
          setListId(row.id); setTitle(row.title || 'Shopping list'); setItems(Array.isArray(row.items) ? row.items : [])
          channel = supabase.channel('list:' + row.id)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shared_lists', filter: 'id=eq.' + row.id }, ({ new: r }: any) => {
              if (Array.isArray(r.items)) setItems(r.items)
              if (r.title) setTitle(r.title)
            }).subscribe()
        }
      } catch {}
      setLoading(false)
    })
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  const persist = async (next: Item[]) => {
    setItems(next)
    if (listId) { try { await supabase.from('shared_lists').update({ items: next, updated_at: new Date().toISOString() }).eq('id', listId) } catch {} }
  }
  const addItem = () => { if (!draft.trim()) return; persist([...items, { id: uuidv4(), text: draft.trim(), done: false }]); setDraft('') }
  const toggle = (id: string) => persist(items.map(i => i.id === id ? { ...i, done: !i.done } : i))
  const remove = (id: string) => persist(items.filter(i => i.id !== id))

  const remaining = items.filter(i => !i.done).length

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <View style={s.hInfo}>
          <Text style={s.hName} numberOfLines={1}>📝 {title}</Text>
          <Text style={s.hSub}>Shared with {otherName} · {remaining} left</Text>
        </View>
      </View>

      {loading
        ? <ActivityIndicator color={PRIMARY} style={{ flex: 1 }} />
        : <FlatList data={items} keyExtractor={i => i.id} style={{ flex: 1 }}
            contentContainerStyle={items.length === 0 ? { flex: 1 } : { paddingVertical: 8 }}
            ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>🛒</Text><Text style={s.emptySub}>No items yet — add the first one below</Text></View>}
            renderItem={({ item }) => (
              <View style={s.row}>
                <TouchableOpacity style={[s.check, item.done && s.checkOn]} onPress={() => toggle(item.id)}>
                  {item.done && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
                <Text style={[s.itemText, item.done && s.itemDone]}>{item.text}</Text>
                <TouchableOpacity onPress={() => remove(item.id)}><Text style={s.del}>✕</Text></TouchableOpacity>
              </View>
            )} />
      }

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Add an item..." placeholderTextColor={GRAY} returnKeyType="done" onSubmitEditing={addItem} />
          <TouchableOpacity style={[s.addBtn, !draft.trim() && { opacity: 0.4 }]} onPress={addItem} disabled={!draft.trim()}>
            <Text style={s.addBtnText}>＋</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  backBtn: { padding: 4 },
  backText: { fontSize: 32, color: PRIMARY, lineHeight: 36, marginTop: -4 },
  hInfo: { flex: 1 },
  hName: { fontSize: 16, fontWeight: '700', color: TEXT },
  hSub: { fontSize: 11, color: GRAY },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyEmoji: { fontSize: 48 },
  emptySub: { fontSize: 14, color: GRAY, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: CARD, borderBottomWidth: 0.5, borderColor: BORDER },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: LIVE, borderColor: LIVE },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  itemText: { flex: 1, fontSize: 15, color: TEXT },
  itemDone: { textDecorationLine: 'line-through', color: GRAY },
  del: { fontSize: 16, color: GRAY, paddingHorizontal: 4 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, backgroundColor: CARD, borderTopWidth: 0.5, borderColor: BORDER },
  input: { flex: 1, backgroundColor: BG, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: TEXT, borderWidth: 1, borderColor: BORDER },
  addBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: -2 },
})
