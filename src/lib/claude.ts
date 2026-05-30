import { CLAUDE_MODEL, EDGE_URL, EDGE_AUTH } from '../constants'

const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_KEY || ''

// Routes through the quick-endpoint Edge Function so the Anthropic key stays
// server-side (set via `supabase secrets set ANTHROPIC_API_KEY=...`) instead of
// being inlined into the app bundle.
export async function askClaude(prompt: string, system?: string, maxTokens = 200, web = false, imageUrl?: string): Promise<string> {
  try {
    const res = await fetch(EDGE_URL, {
      method: 'POST',
      headers: { Authorization: EDGE_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system: system || undefined, max_tokens: maxTokens, model: CLAUDE_MODEL, web, image_url: imageUrl }),
    })
    const data = await res.json()
    return data.text?.trim() || ''
  } catch { return '' }
}

export async function translateText(text: string, targetLang: string): Promise<string> {
  return askClaude('Translate to ' + targetLang + '. Return ONLY the translation: ' + text, undefined, 200)
}

export async function getSuggestedReplies(lastMsg: string, lang: string): Promise<string[]> {
  const result = await askClaude('Message: ' + lastMsg + ' Suggest 3 very short replies in ' + lang + '. JSON array only: [r1,r2,r3]', undefined, 80)
  try { return JSON.parse(result) } catch { return [] }
}

export async function webSearch(query: string): Promise<string> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, max_results: 3, search_depth: 'basic' }),
    })
    const data = await res.json()
    return data.results?.map((r: any) => r.title + ': ' + r.content).join('\n') || ''
  } catch { return '' }
}
