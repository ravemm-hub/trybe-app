import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const PHONE_MAP_KEY = 'contact_phone_map'
const NAME_MAP_KEY = 'contact_name_map'

export function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-\(\)\.]/g, '')
  if (p.startsWith('00972')) p = '0' + p.slice(5)
  if (p.startsWith('+972')) p = '0' + p.slice(4)
  if (p.startsWith('972') && p.length === 12) p = '0' + p.slice(3)
  return p
}

export async function saveContactPhoneMap(contacts: { name: string; phone: string }[]) {
  const map: Record<string, string> = {}
  for (const c of contacts) {
    if (c.phone) {
      const normalized = normalizePhone(c.phone)
      map[normalized] = c.name
      map[c.phone] = c.name
      // also store with +972 prefix
      if (normalized.startsWith('0')) {
        map['+972' + normalized.slice(1)] = c.name
        map['972' + normalized.slice(1)] = c.name
      }
    }
  }
  await AsyncStorage.setItem(PHONE_MAP_KEY, JSON.stringify(map))
}

export async function getContactNameByPhone(phone: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PHONE_MAP_KEY)
    if (!raw) return null
    const map = JSON.parse(raw)
    const normalized = normalizePhone(phone)
    // Try all formats
    const withPlus = normalized.startsWith('0') ? '+972' + normalized.slice(1) : phone
    const without = normalized.startsWith('0') ? normalized : '0' + phone.replace(/^\+?972/, '')
    return map[normalized] || map[phone] || map[withPlus] || map[without] || null
  } catch { return null }
}

export async function saveCustomName(myUserId: string, targetUserId: string, name: string) {
  try {
    const raw = await AsyncStorage.getItem(NAME_MAP_KEY) || '{}'
    const map = JSON.parse(raw)
    map[targetUserId] = name
    await AsyncStorage.setItem(NAME_MAP_KEY, JSON.stringify(map))
    await supabase.from('user_contact_names').upsert({
      user_id: myUserId,
      contact_user_id: targetUserId,
      custom_name: name,
    }, { onConflict: 'user_id,contact_user_id' })
  } catch {}
}

export async function getCustomName(targetUserId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(NAME_MAP_KEY)
    if (raw) {
      const map = JSON.parse(raw)
      if (map[targetUserId]) return map[targetUserId]
    }
    return null
  } catch { return null }
}

export async function loadCustomNamesFromDB(myUserId: string) {
  try {
    const { data } = await supabase
      .from('user_contact_names')
      .select('contact_user_id, custom_name')
      .eq('user_id', myUserId)
    if (!data?.length) return
    const raw = await AsyncStorage.getItem(NAME_MAP_KEY) || '{}'
    const map = JSON.parse(raw)
    for (const row of data) {
      map[row.contact_user_id] = row.custom_name
    }
    await AsyncStorage.setItem(NAME_MAP_KEY, JSON.stringify(map))
  } catch {}
}

export async function getDisplayName(targetUserId: string, appName: string, phone?: string | null): Promise<string> {
  const custom = await getCustomName(targetUserId)
  if (custom) return custom
  if (phone) {
    const contactName = await getContactNameByPhone(phone)
    if (contactName) return contactName
  }
  return appName
}
