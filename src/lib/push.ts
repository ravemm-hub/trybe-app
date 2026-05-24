import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'
import { EAS_PROJECT_ID } from '../constants'

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
})

export async function registerPushToken(userId: string): Promise<string | null> {
  try {
    const { status } = await Notifications.requestPermissionsAsync()
    if (status !== 'granted') return null
    const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })
    if (token?.data) await supabase.from('profiles').update({ push_token: token.data }).eq('id', userId)
    return token?.data || null
  } catch { return null }
}

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

export function setupNotificationTap(router: any) {
  Notifications.addNotificationResponseReceivedListener(r => {
    const d = r.notification.request.content.data as any
    if (d?.group_id) router.push({ pathname: '/chat', params: { id: d.group_id, name: d.group_name || '' } })
    else if (d?.dm_user_id) router.push({ pathname: '/dm', params: { userId: d.dm_user_id, userName: d.sender_name || '' } })
    else if (d?.type === 'nearby') router.push('/(tabs)/explore')
  })
}
