import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const NAMES_KEY = 'contact_names_v2'      // legacy: userId -> name (kept for backward compat)
const PHONES_KEY = 'contact_phones_v1'    // primary:   normalizedPhone -> contactName (survives user-id changes)

export function normalizePhone(p: string): string {
  if (!p) return ''
  // Strip everything that isn't a digit or leading +. Catches Unicode RTL marks, NBSPs, etc.
  p = p.replace(/[^\d+]/g, '')
  if (p.startsWith('00972')) return '0' + p.slice(5)
  if (p.startsWith('+972')) return '0' + p.slice(4)
  if (p.startsWith('972') && p.length >= 12) return '0' + p.slice(3)
  if (p.startsWith('+')) return p.slice(1) // unknown country, keep digits
  return p
}

async function getPhoneMap(): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(PHONES_KEY)) || '{}') } catch { return {} }
}
async function getUserMap(): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(NAMES_KEY)) || '{}') } catch { return {} }
}

// In-memory cache so dm.tsx render doesn't hit AsyncStorage on every message.
let _phoneCache: Record<string, string> | null = null
let _userCache: Record<string, string> | null = null
async function warmCaches() {
  if (!_phoneCache) _phoneCache = await getPhoneMap()
  if (!_userCache) _userCache = await getUserMap()
}

// Per-user-id resolver. Tries the fast userId map first; if miss, fetches the user's
// phone from `profiles` and looks it up in the phone map.  This survives the case
// where two profile rows for the same human were merged and the user_id changed.
export async function getContactName(userId: string): Promise<string | null> {
  if (!userId) return null
  await warmCaches()
  if (_userCache && _userCache[userId]) return _userCache[userId]
  try {
    const { data: prof } = await supabase.from('profiles').select('phone').eq('id', userId).single()
    if (!prof?.phone) return null
    const n = normalizePhone(prof.phone)
    const name = _phoneCache?.[n]
    if (name) {
      // Cache for next time, and also persist the new userId mapping.
      _userCache![userId] = name
      try {
        const userMap = await getUserMap(); userMap[userId] = name
        await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(userMap))
      } catch {}
      return name
    }
  } catch {}
  return null
}

// Full { userId: savedContactName } map, for resolving names in group chats / lists.
// Now also auto-fills userIds whose phone we know but were never matched before.
export async function getContactNameMap(): Promise<Record<string, string>> {
  await warmCaches()
  return { ...(_userCache || {}) }
}

// Manually save a contact name (used by Contacts pickers and group-add UI).
export async function saveContactName(myId: string, theirId: string, name: string) {
  try {
    const userMap = await getUserMap(); userMap[theirId] = name
    await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(userMap))
    _userCache = userMap
    // Also fetch and persist their phone in the phone map so merges survive.
    try {
      const { data: p } = await supabase.from('profiles').select('phone').eq('id', theirId).single()
      if (p?.phone) {
        const n = normalizePhone(p.phone)
        const phoneMap = await getPhoneMap(); phoneMap[n] = name
        await AsyncStorage.setItem(PHONES_KEY, JSON.stringify(phoneMap))
        _phoneCache = phoneMap
      }
    } catch {}
    await supabase.from('user_contact_names').upsert({ user_id: myId, contact_user_id: theirId, custom_name: name }, { onConflict: 'user_id,contact_user_id' })
  } catch {}
}

export async function loadContactNamesFromDB(myId: string) {
  try {
    const { data } = await supabase.from('user_contact_names').select('contact_user_id, custom_name').eq('user_id', myId)
    if (!data?.length) return
    const map = await getUserMap()
    for (const r of data) map[r.contact_user_id] = r.custom_name
    await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(map))
    _userCache = map
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
      const phone = c.phoneNumbers[0].number || ''
      if (!phone) continue
      list.push({ id: c.id || phone, name: c.name, phone, initials: c.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase(), onTryber: false })
    }
    if (!list.length) return []
    // Build a wide variant set so we match whatever format the DB stored.
    const variants = new Set<string>()
    for (const c of list) {
      const n = normalizePhone(c.phone)
      variants.add(c.phone); variants.add(n)
      if (n.startsWith('0')) { variants.add('+972' + n.slice(1)); variants.add('972' + n.slice(1)) }
    }
    const { data: users } = await supabase.from('profiles').select('id, phone').in('phone', [...variants])
    const map = new Map<string, any>()
    for (const u of users || []) {
      if (!u.phone) continue
      const n = normalizePhone(u.phone)
      map.set(n, u); map.set(u.phone, u)
      if (n.startsWith('0')) { map.set('+972' + n.slice(1), u); map.set('972' + n.slice(1), u) }
    }
    return list.map(c => {
      const n = normalizePhone(c.phone)
      const u = map.get(n) || map.get(c.phone) || (n.startsWith('0') ? (map.get('+972' + n.slice(1)) || map.get('972' + n.slice(1))) : undefined)
      return { ...c, onTryber: !!u, tryberUserId: u?.id }
    }).sort((a, b) => (b.onTryber ? 1 : 0) - (a.onTryber ? 1 : 0) || a.name.localeCompare(b.name))
  } catch { return [] }
}

// Reads device contacts → matches phone to tryber profiles → fills the AsyncStorage maps.
// Called on app start AND on the Chats tab focus so merged-user scenarios self-heal.
export async function loadAndMatchContacts(userId: string) {
  try {
    const Contacts = require('expo-contacts')
    const { status } = await Contacts.requestPermissionsAsync()
    if (status !== 'granted') return
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] })
    const list: { name: string; phone: string }[] = []
    for (const c of data) {
      if (!c.name || !c.phoneNumbers?.length) continue
      const phone = c.phoneNumbers[0].number || ''
      if (phone) list.push({ name: c.name, phone })
    }
    if (!list.length) return

    // ALWAYS persist the phone-keyed map first — this is the source of truth that
    // survives user-id changes from duplicate-account merges.
    const phoneMap: Record<string, string> = await getPhoneMap()
    for (const c of list) {
      const n = normalizePhone(c.phone)
      if (n) phoneMap[n] = c.name
    }
    await AsyncStorage.setItem(PHONES_KEY, JSON.stringify(phoneMap))
    _phoneCache = phoneMap

    // Build variants and look up in profiles.
    const variants = new Set<string>()
    for (const c of list) {
      const n = normalizePhone(c.phone)
      variants.add(c.phone); variants.add(n)
      if (n.startsWith('0')) { variants.add('+972' + n.slice(1)); variants.add('972' + n.slice(1)) }
    }
    const { data: users } = await supabase.from('profiles').select('id, phone').in('phone', [...variants])
    const userMap = await getUserMap()
    for (const u of users || []) {
      if (!u.phone) continue
      const uNorm = normalizePhone(u.phone)
      const matchName = phoneMap[uNorm]
      if (matchName) {
        userMap[u.id] = matchName
        // Best-effort persist to DB (per-account sync of "saved names").
        try { supabase.from('user_contact_names').upsert({ user_id: userId, contact_user_id: u.id, custom_name: matchName }, { onConflict: 'user_id,contact_user_id' }) } catch {}
      }
    }
    await AsyncStorage.setItem(NAMES_KEY, JSON.stringify(userMap))
    _userCache = userMap
  } catch {}
}
