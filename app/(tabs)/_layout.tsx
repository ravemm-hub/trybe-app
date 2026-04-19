import { Tabs } from 'expo-router'
import { Text, View, StyleSheet } from 'react-native'
import { useState, useEffect } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

const GREEN = '#1D9E75'
const GRAY = '#B4B2A9'
const PURPLE = '#7F77DD'

function BadgeIcon({ emoji, count, color }: { emoji: string; count: number; color?: string }) {
  return (
    <View style={s.iconWrap}>
      <Text style={s.iconEmoji}>{emoji}</Text>
      {count > 0 && (
        <View style={[s.badge, color ? { backgroundColor: color } : {}]}>
          <Text style={s.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </View>
  )
}

export default function TabsLayout() {
  const [unread, setUnread] = useState(0)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    checkUnread()
    const channel = supabase.channel('unread-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => checkUnread())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const checkUnread = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: myGroups } = await supabase.from('group_members').select('group_id').eq('user_id', user.id)
    if (!myGroups?.length) return
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    let count = 0
    for (const { group_id } of myGroups) {
      const { count: c } = await supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('group_id', group_id).neq('user_id', user.id).gt('created_at', fiveMinAgo)
      count += c || 0
    }
    setUnread(count)
  }

  const tabBarHeight = 52 + insets.bottom

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: '#fff',
        borderTopWidth: 0.5,
        borderTopColor: '#E0DED8',
        height: tabBarHeight,
        paddingBottom: insets.bottom + 4,
        paddingTop: 6,
        elevation: 8,
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      tabBarActiveTintColor: GREEN,
      tabBarInactiveTintColor: GRAY,
      tabBarLabelStyle: { fontSize: 9, fontWeight: '700', letterSpacing: 0.2 },
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Trybes',
        tabBarIcon: ({ focused }) => <BadgeIcon emoji={focused ? '⚡️' : '⚡'} count={unread} />,
      }} />
      <Tabs.Screen name="feed" options={{
        title: 'Feed',
        tabBarIcon: ({ focused }) => <BadgeIcon emoji={focused ? '🌐' : '🌍'} count={0} />,
      }} />
      <Tabs.Screen name="marketplace" options={{
        title: 'Market',
        tabBarIcon: ({ focused }) => <BadgeIcon emoji={focused ? '🛍️' : '🛒'} count={0} />,
      }} />
      <Tabs.Screen name="explore" options={{
        title: 'Explore',
        tabBarIcon: ({ focused }) => <BadgeIcon emoji="📡" count={0} />,
      }} />
      <Tabs.Screen name="agent" options={{
        title: 'Agent',
        tabBarIcon: ({ focused }) => <BadgeIcon emoji="✦" count={0} color={focused ? PURPLE : undefined} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Me',
        tabBarIcon: ({ focused }) => <BadgeIcon emoji={focused ? '◆' : '◇'} count={0} />,
      }} />
      <Tabs.Screen name="radar" options={{ href: null }} />
      <Tabs.Screen name="chats" options={{ href: null }} />
    </Tabs>
  )
}

const s = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  iconEmoji: { fontSize: 19 },
  badge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#E24B4A', borderRadius: 10, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#fff' },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
})
