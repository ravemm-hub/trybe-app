import AsyncStorage from '@react-native-async-storage/async-storage'

// Languages the chat translate menus offer. Order = display order.
export const TRANSLATE_LANGS = [
  'English', 'Hebrew', 'Arabic', 'Russian', 'French', 'Spanish',
  'German', 'Italian', 'Portuguese', 'Ukrainian', 'Chinese', 'Japanese',
] as const

export type TranslateLang = (typeof TRANSLATE_LANGS)[number]

const KEY = 'preferred_translate_lang_v1'

// User's preferred target language for incoming translations. NULL = auto
// (Hebrew text → English, anything else → Hebrew). Stored locally because
// it's a personal preference, not shared social state.
export async function getPreferredLang(): Promise<TranslateLang | null> {
  try {
    const v = await AsyncStorage.getItem(KEY)
    if (!v) return null
    if (TRANSLATE_LANGS.includes(v as TranslateLang)) return v as TranslateLang
    return null
  } catch { return null }
}

export async function setPreferredLang(lang: TranslateLang | null) {
  try {
    if (lang) await AsyncStorage.setItem(KEY, lang)
    else await AsyncStorage.removeItem(KEY)
  } catch {}
}

// Returns the language to translate INTO for a given source text — honors
// the user's saved preference, otherwise auto-swaps Hebrew ↔ English.
export function pickTargetLang(sourceText: string, pref: TranslateLang | null): TranslateLang {
  if (pref) return pref
  return /[֐-׿]/.test(sourceText) ? 'English' : 'Hebrew'
}
