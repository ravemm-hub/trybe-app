import { supabase } from './supabase'

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
