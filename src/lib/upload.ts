import * as ImagePicker from 'expo-image-picker'
import { Alert } from 'react-native'
import { supabase } from './supabase'

// Lets the user pick a photo from camera OR gallery via a quick menu.
export async function pickImageAsset(): Promise<{ uri: string; ext: string } | null> {
  return new Promise((resolve) => {
    const pickFrom = async (source: 'camera' | 'gallery') => {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert('Permission needed', source === 'camera' ? 'Allow camera access.' : 'Allow photo access.'); resolve(null); return }
      const r = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      if (r.canceled || !r.assets?.[0]) { resolve(null); return }
      const a = r.assets[0]
      resolve({ uri: a.uri, ext: (a.uri.split('.').pop() || 'jpg').toLowerCase() })
    }
    Alert.alert('Add photo', undefined, [
      { text: '📷 Camera', onPress: () => pickFrom('camera') },
      { text: '🖼️ Gallery', onPress: () => pickFrom('gallery') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ])
  })
}

export type MediaKind = 'image' | 'audio' | 'file'

// Uploads a local file URI to the chat-media bucket and returns its public URL (or null on failure).
export async function uploadMedia(uri: string, kind: MediaKind, ext?: string, originalName?: string): Promise<string | null> {
  try {
    const cleanExt = (ext || uri.split('.').pop() || (kind === 'image' ? 'jpg' : kind === 'audio' ? 'm4a' : 'bin'))
      .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
    const mime = kind === 'image'
      ? 'image/' + (cleanExt === 'png' ? 'png' : cleanExt === 'webp' ? 'webp' : 'jpeg')
      : kind === 'audio' ? 'audio/m4a' : 'application/octet-stream'
    const base = (originalName ? originalName.replace(/[^a-zA-Z0-9._-]/g, '_') : Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + cleanExt)
    const path = kind + 's/' + Date.now() + '_' + base
    const formData = new FormData()
    formData.append('file', { uri, type: mime, name: path.split('/').pop() } as any)
    const { error } = await supabase.storage.from('chat-media').upload(path, formData, { upsert: true, contentType: mime })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(path)
    return publicUrl
  } catch {
    return null
  }
}
