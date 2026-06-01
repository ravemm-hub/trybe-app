import { supabase } from '../lib/supabase'

// ─── Venue detection (Overpass / OpenStreetMap) ─────────────────────────────
// Free, no API key. We query for amenities + leisure POIs within a radius of
// the user and return a clean list ordered by distance.

export type Venue = {
  id: string
  name: string
  category: string | null
  lat: number
  lon: number
  osm_id: string | null
  address: string | null
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// 5-minute in-memory cache keyed by ~50m grid (~4 decimal places) so reopening
// the create screen near the same spot is instant.
const CACHE_TTL_MS = 5 * 60 * 1000
const venueCache: Map<string, { at: number; data: DetectedVenue[] }> = new Map()
const cacheKey = (lat: number, lon: number, r: number) => lat.toFixed(4) + ':' + lon.toFixed(4) + ':' + r

// Categories the user actually wants offered when creating a Trybe.
// `amenity` covers pubs/bars/restaurants/cafes; `leisure` covers
// stadiums/parks/sports-centres; `tourism` covers attractions.
const QUERY_TYPES = `
  node["amenity"~"pub|bar|restaurant|cafe|fast_food|nightclub|biergarten|food_court"](around:%R%,%LAT%,%LON%);
  node["leisure"~"stadium|park|sports_centre|swimming_pool|beach_resort|garden|playground"](around:%R%,%LAT%,%LON%);
  node["tourism"~"attraction|viewpoint|museum|gallery|hotel|hostel"](around:%R%,%LAT%,%LON%);
  node["shop"~"mall|department_store"](around:%R%,%LAT%,%LON%);
  way["amenity"~"pub|bar|restaurant|cafe|nightclub"](around:%R%,%LAT%,%LON%);
  way["leisure"~"stadium|park|sports_centre"](around:%R%,%LAT%,%LON%);
`

export type DetectedVenue = {
  osm_id: string                          // e.g. 'node/123'
  name: string
  category: string
  lat: number
  lon: number
  distance_m: number
  address: string | null
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (x: number) => x * Math.PI / 180
  const R = 6371000
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Categorize an OSM element into a single friendly category string.
function categoryOf(el: any): string {
  const t = el.tags || {}
  if (t.amenity) return t.amenity
  if (t.leisure) return t.leisure
  if (t.tourism) return t.tourism
  if (t.shop) return t.shop
  return 'place'
}

export async function detectNearbyVenues(lat: number, lon: number, radiusM = 200): Promise<DetectedVenue[]> {
  try {
    // 1. Cache hit? (avoid hammering Overpass when the user reopens /create).
    const k = cacheKey(lat, lon, radiusM)
    const hit = venueCache.get(k)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data

    // 2. Race the Overpass request against a 4s client-side timeout so the
    //    create screen never feels stuck even if Overpass is slow today.
    const controller = new AbortController()
    const cancel = setTimeout(() => controller.abort(), 4000)
    const q = `[out:json][timeout:4];(${QUERY_TYPES.replace(/%LAT%/g, String(lat)).replace(/%LON%/g, String(lon)).replace(/%R%/g, String(radiusM))});out tags center 20;`
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
      signal: controller.signal,
    }).catch(() => null as any)
    clearTimeout(cancel)
    if (!res || !res.ok) return []
    const data = await res.json()
    const out: DetectedVenue[] = []
    for (const el of data.elements || []) {
      const n = el.tags?.name || el.tags?.['name:en'] || el.tags?.['name:he']
      if (!n) continue   // skip unnamed POIs — useless to suggest
      const elLat = el.lat ?? el.center?.lat
      const elLon = el.lon ?? el.center?.lon
      if (elLat == null || elLon == null) continue
      out.push({
        osm_id: el.type + '/' + el.id,
        name: n,
        category: categoryOf(el),
        lat: elLat,
        lon: elLon,
        distance_m: Math.round(haversine(lat, lon, elLat, elLon)),
        address: el.tags?.['addr:street'] ? [el.tags['addr:housenumber'], el.tags['addr:street'], el.tags['addr:city']].filter(Boolean).join(' ') : null,
      })
    }
    out.sort((a, b) => a.distance_m - b.distance_m)
    const trimmed = out.slice(0, 12)
    venueCache.set(cacheKey(lat, lon, radiusM), { at: Date.now(), data: trimmed })
    return trimmed
  } catch { return [] }
}

// Find-or-create a venue row for a detected POI. Dedup by osm_id.
export async function upsertVenue(d: DetectedVenue, userId: string): Promise<Venue | null> {
  // Try existing first (no auth needed; reads are public).
  if (d.osm_id) {
    const { data } = await supabase.from('venues').select('*').eq('osm_id', d.osm_id).limit(1).single()
    if (data) return data as Venue
  }
  const { data, error } = await supabase.from('venues').insert({
    name: d.name, category: d.category, lat: d.lat, lon: d.lon,
    osm_id: d.osm_id, address: d.address, created_by: userId,
  }).select('*').single()
  if (error) { console.warn('upsertVenue:', error.message); return null }
  return data as Venue
}

// ─── Existing-group suggestions ─────────────────────────────────────────────

export type NearbyGroup = {
  group_id: string
  group_name: string
  member_count: number
  venue_id: string
  venue_name: string
  venue_category: string | null
  distance_m: number
  event_at: string | null
}

// Trybes already anchored to nearby venues — shown on /create to nudge
// "There's already a Trybe here — join?"
export async function findNearbyVenueGroups(lat: number, lon: number, radiusM = 200): Promise<NearbyGroup[]> {
  const { data, error } = await supabase.rpc('groups_near', { p_lat: lat, p_lon: lon, p_radius_m: radiusM })
  if (error) { console.warn('groups_near:', error.message); return [] }
  return (data || []) as NearbyGroup[]
}

// ─── Live members + venue lookup ────────────────────────────────────────────

export type LiveMember = {
  user_id: string
  display_name: string | null
  username: string | null
  avatar_char: string | null
  distance_m: number
  updated_at: string
}

export async function getLiveMembers(groupId: string, radiusM = 100): Promise<LiveMember[]> {
  const { data, error } = await supabase.rpc('group_live_members', { p_group: groupId, p_radius_m: radiusM })
  if (error) { console.warn('group_live_members:', error.message); return [] }
  return (data || []) as LiveMember[]
}

export async function getGroupVenue(groupId: string): Promise<Venue | null> {
  const { data: g } = await supabase.from('groups').select('venue_id, default_radius_m, event_at').eq('id', groupId).single()
  if (!g?.venue_id) return null
  const { data: v } = await supabase.from('venues').select('*').eq('id', g.venue_id).single()
  return (v as Venue) || null
}

export function categoryEmoji(cat: string | null | undefined): string {
  if (!cat) return '📍'
  const c = cat.toLowerCase()
  if (c.includes('pub') || c.includes('bar') || c.includes('biergarten')) return '🍺'
  if (c.includes('restaurant') || c.includes('food')) return '🍽️'
  if (c.includes('cafe')) return '☕'
  if (c.includes('nightclub')) return '🪩'
  if (c.includes('stadium')) return '🏟️'
  if (c.includes('park') || c.includes('garden')) return '🌳'
  if (c.includes('beach')) return '🏖️'
  if (c.includes('hotel') || c.includes('hostel')) return '🏨'
  if (c.includes('museum') || c.includes('gallery')) return '🖼️'
  if (c.includes('attraction') || c.includes('viewpoint')) return '🗺️'
  if (c.includes('mall') || c.includes('shop')) return '🛍️'
  if (c.includes('pool') || c.includes('sports')) return '🏊'
  if (c.includes('playground')) return '🛝'
  return '📍'
}
