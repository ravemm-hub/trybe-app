import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vytkiwibuohtcmjmslkh.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5dGtpd2lidW9odGNtam1zbGtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODIwNDUsImV4cCI6MjA5MDk1ODA0NX0.jgggUmp5stzW-9QKLjtrVJdQE4MBbKaFLuySZjgi-ds'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
