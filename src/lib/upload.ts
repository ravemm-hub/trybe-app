import * as ImagePicker from 'expo-image-picker'
import { Alert } from 'react-native'
import { supabase } from './supabase'

// Lets the user pick a photo from camera OR gallery via a quick menu.
// Android's native Alert supports max 3 buttons, which is exactly what we use here.
export async function pickImageAsset(): Promise<{ uri: string; ext: string } | null> {
  return new Promise((resolve) => {
    const pickFrom = async (source: 'camera' | 'gallery') => {
      try {
        const perm = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (!perm.granted) {
          Alert.alert('Permission needed', source === 'camera' ? 'Allow camera access in Settings.' : 'Allow photo access in Settings.')
          resolve(null); return
        }
        // expo-image-picker 55: MediaTypeOptions.Images is deprecated in favor of an array,
        // but the enum form still works and is consistent across SDK 55.
        const r = source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false })
        if (r.canceled || !r.assets?.[0]) { resolve(null); return }
        const a = r.assets[0]
        const ext = (a.uri.split('.').pop() || 'jpg').toLowerCase().split('?')[0]
        resolve({ uri: a.uri, ext })
      } catch (e: any) {
        Alert.alert('Picker error', e?.message || 'Could not open picker.')
        resolve(null)
      }
    }
    Alert.alert('Add photo', undefined, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Gallery', onPress: () => pickFrom('gallery') },
      { text: 'Camera', onPress: () => pickFrom('camera') },
    ], { cancelable: true, onDismiss: () => resolve(null) })
  })
}

export type MediaKind = 'image' | 'audio' | 'file'

// Uploads a local file URI to the chat-media bucket and returns its public URL.
// On RN, `fetch(uri).arrayBuffer()` is the reliable way — FormData with `{uri,type,name}`
// frequently uploads 0-byte files on Android because the bridge doesn't serialize the file.
export async function uploadMedia(uri: string, kind: MediaKind, ext?: string, originalName?: string): Promise<string | null> {
  try {
    const cleanExt = (ext || uri.split('.').pop() || (kind === 'image' ? 'jpg' : kind === 'audio' ? 'm4a' : 'bin'))
      .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
    const mime = kind === 'image'
      ? 'image/' + (cleanExt === 'png' ? 'png' : cleanExt === 'webp' ? 'webp' : cleanExt === 'gif' ? 'gif' : 'jpeg')
      : kind === 'audio' ? 'audio/m4a' : 'application/octet-stream'
    const safeName = (originalName ? originalName.replace(/[^a-zA-Z0-9._-]/g, '_') : Math.random().toString(36).slice(2, 10) + '.' + cleanExt)
    const path = kind + 's/' + Date.now() + '_' + safeName

    // Read the file: fetch() handles `file://` and `content://` URIs on both iOS and Android.
    const res = await fetch(uri)
    if (!res.ok) throw new Error('Could not read picked file (HTTP ' + res.status + ')')
    const ab = await res.arrayBuffer()
    if (!ab || ab.byteLength === 0) throw new Error('Picked file is empty')

    const { error } = await supabase.storage.from('chat-media').upload(path, ab, {
      upsert: true,
      contentType: mime,
      cacheControl: '3600',
    })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(path)
    return publicUrl
  } catch (e: any) {
    // Surface the error to the caller via console so toggling app logging shows it,
    // and also re-throw a clean message the UI can display.
    const msg = e?.message || 'Upload failed'
    Alert.alert('Upload failed', msg)
    return null
  }
}
