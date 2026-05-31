import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from './supabase'
import { EAS_PROJECT_ID } from '../constants'

// When a notification arrives while the app is foregrounded, show the banner,
// add to the list, play a sound, and bump the OS-level app-icon badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
})

// Set the launcher-icon badge count (Android shows on launcher / iOS shows on home screen).
// Pass 0 to clear the dot/number.
export async function setAppBadge(count: number) {
  try { await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count))) } catch {}
}

// One-time Android channel setup so notifications get proper priority + sound.
// Without an explicit "default" channel, Expo's server can deliver but the OS
// will silence the heads-up popup.
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6C63FF',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
    })
  } catch {}
}

export async function registerPushToken(userId: string): Promise<string | null> {
  try {
    await ensureAndroidChannel()
    const { status: existing } = await Notifications.getPermissionsAsync()
    let status = existing
    if (existing !== 'granted') {
      const r = await Notifications.requestPermissionsAsync()
      status = r.status
    }
    if (status !== 'granted') return null
    const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })
    if (token?.data) await supabase.from('profiles').update({ push_token: token.data }).eq('id', userId)
    return token?.data || null
  } catch { return null }
}

// Direct-send helper, still exported for ad-hoc cases (e.g. nearby ping). Most
// production traffic now goes through the edge function quick-endpoint which
// handles recipient lookup + token redaction server-side.
export async function sendPush(tokens: string[], title: string, body: string, data?: Record<string, any>) {
  if (!tokens.length) return
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map(to => ({ to, title, body, data, sound: 'default' }))),
    })
  } catch {}
}

// Notification TAP listener — routes the user to the relevant screen and clears
// the icon badge once they've engaged with the inbox.
export function setupNotificationTap(router: any) {
  Notifications.addNotificationResponseReceivedListener(r => {
    const d = r.notification.request.content.data as any
    if (d?.group_id) router.push({ pathname: '/chat', params: { id: d.group_id, name: d.group_name || '' } })
    else if (d?.dm_user_id) router.push({ pathname: '/dm', params: { userId: d.dm_user_id, userName: d.sender_name || '' } })
    else if (d?.type === 'nearby') router.push('/(tabs)/explore')
    // Don't clear the whole badge — useUnread keeps it accurate based on actual unread state.
  })
}
