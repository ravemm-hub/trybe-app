import { Tabs } from 'expo-router'
import { Text, View, StyleSheet } from 'react-native'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const GREEN = '#1D9E75'
const GRAY = '#B4B2A9'

function BadgeIcon({ emoji, count }: { emoji: string; count: number }) {
  return (
    <View style={s.iconWrap}>
      <Text style={s.iconEmoji}>{emoji}</Text>
      {count > 0 && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </View>
  )
}

export default function TabsLayout() {
  const [unreadChats, setUnreadChats] = useState(0)

  useEffect(() => {
    checkUnread()
    const channel = supabase
      .channel('unread-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        checkUnread()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const checkUnread = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: myGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id)

    if (!myGroups?.length) return

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    let count = 0

    for (const { group_id } of myGroups) {
      const { count: msgCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', group_id)
        .neq('user_id', user.id)
        .gt('created_at', fiveMinAgo)
      count += msgCount || 0
    }

    setUnreadChats(count)
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 0.5,
          borderTopColor: '#E0DED8',
          height: 64,
          paddingBottom: 10,
          paddingTop: 6,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: GRAY,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trybes',
          tabBarIcon: ({ focused }) => (
            <BadgeIcon emoji={focused ? '⚡️' : '⚡'} count={0} />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ focused }) => (
            <BadgeIcon emoji={focused ? '💬' : '🗨️'} count={unreadChats} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ focused }) => (
            <BadgeIcon emoji={focused ? '🌐' : '🔍'} count={0} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Me',
          tabBarIcon: ({ focused }) => (
            <BadgeIcon emoji={focused ? '◆' : '◇'} count={0} />
          ),
        }}
      />
      <Tabs.Screen name="radar" options={{ href: null }} />
    </Tabs>
  )
}

const s = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  iconEmoji: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#E24B4A',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
})
