import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const PHONE_MAP_KEY = 'contact_phone_map'
const NAME_MAP_KEY = 'contact_name_map'

// Save phone→name mapping from device contacts
export async function saveContactPhoneMap(contacts: { name: string; phone: string }[]) {
  const map: Record<string, string> = {}
  for (const c of contacts) {
    if (c.phone) {
      const normalized = normalizePhone(c.phone)
      map[normalized] = c.name
      // Also store original
      map[c.phone] = c.name
    }
  }
  await AsyncStorage.setItem(PHONE_MAP_KEY, JSON.stringify(map))
}

// Get contact name by phone
export async function getContactNameByPhone(phone: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PHONE_MAP_KEY)
    if (!raw) return null
    const map = JSON.parse(raw)
    const normalized = normalizePhone(phone)
    return map[normalized] || map[phone] || null
  } catch { return null }
}

// Save custom name for a user
export async function saveCustomName(myUserId: string, targetUserId: string, name: string) {
  try {
    // Save locally
    const raw = await AsyncStorage.getItem(NAME_MAP_KEY) || '{}'
    const map = JSON.parse(raw)
    map[targetUserId] = name
    await AsyncStorage.setItem(NAME_MAP_KEY, JSON.stringify(map))
    // Save to DB
    await supabase.from('user_contact_names').upsert({
      user_id: myUserId,
      contact_user_id: targetUserId,
      custom_name: name,
    }, { onConflict: 'user_id,contact_user_id' })
  } catch {}
}

// Get custom name for a user (local first, then DB)
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

// Load all custom names from DB into local cache
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

// Get display name — custom name > contact name > app name
export async function getDisplayName(
  targetUserId: string,
  appName: string,
  phone?: string | null
): Promise<string> {
  // Check custom name first
  const custom = await getCustomName(targetUserId)
  if (custom) return custom
  // Check phone in contacts
  if (phone) {
    const contactName = await getContactNameByPhone(phone)
    if (contactName) return contactName
  }
  return appName
}

export function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-\(\)\.]/g, '')
  if (p.startsWith('0')) p = '+972' + p.slice(1)
  return p
}
