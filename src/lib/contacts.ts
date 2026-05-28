import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const NAMES_KEY = 'contact_names_v2'

export function normalizePhone(p: string): string {
  p = p.replace(/[\s\-\(\)\.]/g, '')
  if (p.startsWith('00972')) return '0' + p.slice(5)
  if (p.startsWith('+972')) return '0' + p.slice(4)
  if (p.startsWith('972') && p.length >= 12) return '0' + p.slice(3)
  return p
}

export async function getContactName(userId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(NAMES_KEY)
    return JSON.parse(raw || '{}')[userId] || null
  } catch { return null }
}

export async function saveContactName(myId: string, theirId: string, name: string) {
  try {
    const raw = await AsyncStorage.getItem(NAMES_KEY)
    const map = JSON.parse(raw || '{}')
    map[theirId] = name
    await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(map))
    await supabase.from('user_contact_names').upsert({ user_id: myId, contact_user_id: theirId, custom_name: name }, { onConflict: 'user_id,contact_user_id' })
  } catch {}
}

export async function loadContactNamesFromDB(myId: string) {
  try {
    const { data } = await supabase.from('user_contact_names').select('contact_user_id, custom_name').eq('user_id', myId)
    if (!data?.length) return
    const map = JSON.parse(await AsyncStorage.getItem(NAMES_KEY) || '{}')
    for (const r of data) map[r.contact_user_id] = r.custom_name
    await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(map))
  } catch {}
}

export type EnrichedContact = { id: string; name: string; phone: string; initials: string; onTryber: boolean; tryberUserId?: string }

// Device contacts enriched with whether each is a Tryber user (for add-to-group / invite UIs).
export async function getEnrichedContacts(): Promise<EnrichedContact[]> {
  try {
    const Contacts = require('expo-contacts')
    const { status } = await Contacts.requestPermissionsAsync()
    if (status !== 'granted') return []
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] })
    const list: EnrichedContact[] = []
    for (const c of data) {
      if (!c.name || !c.phoneNumbers?.length) continue
      const phone = c.phoneNumbers[0].number?.replace(/[\s\-\(\)]/g, '') || ''
      if (!phone) continue
      list.push({ id: c.id || phone, name: c.name, phone, initials: c.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase(), onTryber: false })
    }
    if (!list.length) return []
    const allPhones = [...new Set(list.flatMap(c => { const n = normalizePhone(c.phone); return [c.phone, n, '+972' + n.slice(1)] }))]
    const { data: users } = await supabase.from('profiles').select('id, phone').in('phone', allPhones)
    const map = new Map<string, any>()
    for (const u of users || []) { if (!u.phone) continue; const n = normalizePhone(u.phone); map.set(u.phone, u); map.set(n, u); map.set('+972' + n.slice(1), u) }
    return list.map(c => {
      const n = normalizePhone(c.phone)
      const u = map.get(c.phone) || map.get(n) || map.get('+972' + n.slice(1))
      return { ...c, onTryber: !!u, tryberUserId: u?.id }
    }).sort((a, b) => (b.onTryber ? 1 : 0) - (a.onTryber ? 1 : 0) || a.name.localeCompare(b.name))
  } catch { return [] }
}

export async function loadAndMatchContacts(userId: string) {
  try {
    const Contacts = require('expo-contacts')
    const { status } = await Contacts.requestPermissionsAsync()
    if (status !== 'granted') return
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] })
    const list: { name: string; phone: string }[] = []
    for (const c of data) {
      if (!c.name || !c.phoneNumbers?.length) continue
      const phone = c.phoneNumbers[0].number?.replace(/[\s\-\(\)]/g, '') || ''
      if (phone) list.push({ name: c.name, phone })
    }
    if (!list.length) return
    const allPhones = [...new Set(list.flatMap(c => {
      const n = normalizePhone(c.phone)
      return [c.phone, n, '+972' + n.slice(1)]
    }))]
    const { data: users } = await supabase.from('profiles').select('id, phone').in('phone', allPhones)
    const map = JSON.parse(await AsyncStorage.getItem(NAMES_KEY) || '{}')
    for (const u of users || []) {
      if (!u.phone) continue
      const uNorm = normalizePhone(u.phone)
      const match = list.find(c => normalizePhone(c.phone) === uNorm)
      if (match) { map[u.id] = match.name; saveContactName(userId, u.id, match.name) }
    }
    await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(map))
  } catch {}
}
