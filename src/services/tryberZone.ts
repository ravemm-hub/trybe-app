import { supabase } from '../lib/supabase'
import * as Crypto from 'expo-crypto'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ─── Local PIN ──────────────────────────────────────────────────────────────
// The Zone PIN is intentionally device-local — stored as a sha-256 hash in
// AsyncStorage so even a leaked DB can't reveal access. Trade-off: re-installing
// the app or switching devices forces a new PIN (treated as a feature).

const PIN_KEY = 'tryber_zone_pin_hash_v1'
const SESSION_KEY = 'tryber_zone_session_until'
const SESSION_DURATION_MS = 5 * 60 * 1000  // 5 minutes after a successful unlock

async function sha256(s: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s)
}

export async function hasPinSet(): Promise<boolean> {
  return !!(await AsyncStorage.getItem(PIN_KEY))
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4–6 digits')
  await AsyncStorage.setItem(PIN_KEY, await sha256(pin))
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await AsyncStorage.getItem(PIN_KEY)
  if (!stored) return false
  return stored === (await sha256(pin))
}

export async function clearPin(): Promise<void> {
  await AsyncStorage.removeItem(PIN_KEY)
  await AsyncStorage.removeItem(SESSION_KEY)
}

export async function markSessionUnlocked(): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_DURATION_MS))
}

export async function isSessionActive(): Promise<boolean> {
  const v = await AsyncStorage.getItem(SESSION_KEY)
  if (!v) return false
  return Number(v) > Date.now()
}

export async function endSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY)
}

// ─── Subscription / activation ──────────────────────────────────────────────
// MVP: paywall is a stub. Tap "Activate" → flag flips in DB. Real IAP later.

export type ZoneStatus = {
  active: boolean
  expires_at: string | null
  alias: string | null
  available: boolean
}

export async function getMyZoneStatus(userId: string): Promise<ZoneStatus> {
  const { data } = await supabase.from('profiles')
    .select('tryber_zone_active, tryber_zone_expires_at, tryber_zone_alias, tryber_zone_available')
    .eq('id', userId).single()
  return {
    active: !!data?.tryber_zone_active,
    expires_at: data?.tryber_zone_expires_at || null,
    alias: data?.tryber_zone_alias || null,
    available: data?.tryber_zone_available !== false,
  }
}

export async function activateZone(userId: string): Promise<void> {
  // Stub: real IAP would post a receipt to a server endpoint and that endpoint
  // would set this flag with a real expires_at. For dev, flip it forward 30d.
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  await supabase.from('profiles')
    .update({ tryber_zone_active: true, tryber_zone_expires_at: expires, tryber_zone_started_at: new Date().toISOString() })
    .eq('id', userId)
}

export async function setAlias(userId: string, alias: string): Promise<void> {
  const a = alias.trim().slice(0, 40)
  if (!a) throw new Error('Alias required')
  await supabase.from('profiles').update({ tryber_zone_alias: a }).eq('id', userId)
}

export async function setAvailability(userId: string, available: boolean): Promise<void> {
  await supabase.from('profiles').update({ tryber_zone_available: available }).eq('id', userId)
}

// Whether the OTHER user is in the Zone AND open to signals — controls the
// visibility of the ✦ button on their profile view.
export async function isTargetOpenInZone(targetId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles')
    .select('tryber_zone_active, tryber_zone_available')
    .eq('id', targetId).single()
  return !!(data?.tryber_zone_active && data?.tryber_zone_available !== false)
}

// ─── Signals ────────────────────────────────────────────────────────────────

export type SignalLevel = -2 | -1 | 1 | 2

export async function getMySignal(targetId: string): Promise<SignalLevel | null> {
  const { data } = await supabase.rpc('tryber_my_signal', { p_target: targetId })
  return (data ?? null) as SignalLevel | null
}

export async function setSignal(myId: string, targetId: string, level: SignalLevel): Promise<{ error: any | null }> {
  const { error } = await supabase.from('tryber_signals')
    .upsert({ signaler_id: myId, target_id: targetId, level, updated_at: new Date().toISOString() },
            { onConflict: 'signaler_id,target_id' })
  return { error }
}

export async function clearSignal(myId: string, targetId: string) {
  return supabase.from('tryber_signals').delete().eq('signaler_id', myId).eq('target_id', targetId)
}

// ─── Matches ────────────────────────────────────────────────────────────────

export type MatchRow = {
  match_id: string
  partner_id: string
  partner_alias: string | null
  partner_display_name: string | null
  partner_avatar: string | null
  my_status: 'pending' | 'revealed' | 'passed'
  their_status: 'pending' | 'revealed' | 'passed'
  both_revealed: boolean
  matched_at: string
}

export async function listMatches(): Promise<MatchRow[]> {
  const { data, error } = await supabase.rpc('tryber_my_matches')
  if (error) { console.warn('listMatches:', error.message); return [] }
  return (data || []) as MatchRow[]
}

export async function revealMatch(matchId: string) {
  return supabase.rpc('tryber_reveal', { p_match: matchId })
}

export async function passMatch(matchId: string) {
  return supabase.rpc('tryber_pass', { p_match: matchId })
}

// ─── Private photos ─────────────────────────────────────────────────────────
// We reuse the chat-media bucket but prefix with `zone-private/` and use a
// non-guessable name so a raw URL is hard to discover without going through
// the RLS-gated `tryber_private_photos` table.

export async function listPrivatePhotos(userId: string) {
  const { data } = await supabase.from('tryber_private_photos')
    .select('id, url, position').eq('user_id', userId).order('position', { ascending: true })
  return data || []
}

export async function addPrivatePhoto(userId: string, url: string) {
  return supabase.from('tryber_private_photos').insert({ user_id: userId, url })
}

export async function deletePrivatePhoto(id: string) {
  return supabase.from('tryber_private_photos').delete().eq('id', id)
}

// ─── Discoverable people for the Zone screen ─────────────────────────────
// Mix of two pools (deduped):
//   • Contacts on Tryber — people you saved a contact name for.
//   • Trybe members — anyone in the same Trybes as you.
// Backend RPC filters out agents and anyone who opted out of Zone.

export type DiscoverablePerson = {
  id: string
  display_name: string | null
  username: string | null
  avatar_char: string | null
  avatar_url: string | null
  source: 'contact' | 'trybe'
  available: boolean
  has_signal: boolean
}

export async function listDiscoverable(myId: string): Promise<DiscoverablePerson[]> {
  const { data, error } = await supabase.rpc('tryber_zone_discoverable', { p_user: myId })
  if (error) { console.warn('tryber_zone_discoverable:', error.message); return [] }
  return (data || []) as DiscoverablePerson[]
}

// ─── Teeby alias generator ──────────────────────────────────────────────────
// Small client-side fallback if the AI generator is unavailable.

const ANIMALS = ['Fox','Wolf','Owl','Wave','Star','Moon','Pine','Storm','Echo','Nova','Lynx','Sage','Reed','Cliff','Coral']
const ADJECTIVES = ['Wandering','Curious','Quiet','Sunny','Bold','Restless','Gentle','Wild','Soft','Twilight','Northern','Lucid']

export function suggestAliases(seed?: string): string[] {
  const out: string[] = []
  for (let i = 0; i < 5; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const ani = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
    const n = Math.floor(Math.random() * 90) + 10
    out.push(adj + ani + n)
  }
  return out
}
