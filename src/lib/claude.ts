import { CLAUDE_MODEL } from '../constants'

const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || ''
const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_KEY || ''

export async function askClaude(prompt: string, system?: string, maxTokens = 200): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system: system || undefined, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await res.json()
    return data.content?.[0]?.text?.trim() || ''
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
