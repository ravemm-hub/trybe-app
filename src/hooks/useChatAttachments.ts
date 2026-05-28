import { useState, useRef, useCallback } from 'react'
import { Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { Audio } from 'expo-av'
import { uploadMedia, MediaKind } from '../lib/upload'

// Shared attachment logic for chat.tsx and dm.tsx.
// Calls onMedia(publicUrl, kind) once a file is uploaded; the screen then sends the message.
export function useChatAttachments(onMedia: (url: string, kind: MediaKind) => void) {
  const [uploading, setUploading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const recRef = useRef<Audio.Recording | null>(null)

  const pickPhoto = useCallback(async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!granted) { Alert.alert('Permission needed', 'Allow photo access to attach an image.'); return }
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images })
    if (res.canceled || !res.assets?.[0]) return
    setUploading(true)
    const url = await uploadMedia(res.assets[0].uri, 'image', res.assets[0].uri.split('.').pop())
    setUploading(false)
    if (url) onMedia(url, 'image'); else Alert.alert('Upload failed', 'Could not upload the image.')
  }, [onMedia])

  const pickFile = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (res.canceled || !res.assets?.[0]) return
    const a = res.assets[0]
    setUploading(true)
    const url = await uploadMedia(a.uri, 'file', a.name?.split('.').pop(), a.name)
    setUploading(false)
    if (url) onMedia(url, 'file'); else Alert.alert('Upload failed', 'Could not upload the file.')
  }, [onMedia])

  const startRecording = useCallback(async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync()
      if (!granted) { Alert.alert('Permission needed', 'Allow microphone access to record a voice note.'); return }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
      recRef.current = recording
      setIsRecording(true)
    } catch { Alert.alert('Error', 'Could not start recording.') }
  }, [])

  const cancelRecording = useCallback(async () => {
    try { await recRef.current?.stopAndUnloadAsync() } catch {}
    recRef.current = null
    setIsRecording(false)
  }, [])

  const stopAndSendRecording = useCallback(async () => {
    const rec = recRef.current
    recRef.current = null
    setIsRecording(false)
    if (!rec) return
    try {
      await rec.stopAndUnloadAsync()
      const uri = rec.getURI()
      if (!uri) return
      setUploading(true)
      const url = await uploadMedia(uri, 'audio', 'm4a')
      setUploading(false)
      if (url) onMedia(url, 'audio'); else Alert.alert('Upload failed', 'Could not upload the voice note.')
    } catch { setUploading(false) }
  }, [onMedia])

  const openMenu = useCallback(() => {
    Alert.alert('Attach', undefined, [
      { text: '📷 Photo', onPress: pickPhoto },
      { text: '📄 File', onPress: pickFile },
      { text: '🎤 Voice note', onPress: startRecording },
      { text: 'Cancel', style: 'cancel' },
    ])
  }, [pickPhoto, pickFile, startRecording])

  return { uploading, isRecording, openMenu, stopAndSendRecording, cancelRecording }
}
