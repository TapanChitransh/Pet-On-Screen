import Anthropic from '@anthropic-ai/sdk'
import type { AiChatRequest, AiChatResult } from '@shared/types'

/**
 * Optional AI conversation via the Claude API. Runs in the main process so the API key never
 * reaches a renderer. Replies are deliberately short (the pet "speaks" in a small bubble).
 */
export async function aiChat(apiKey: string, model: string, req: AiChatRequest): Promise<AiChatResult> {
  if (!apiKey) return { ok: false, error: 'No API key configured' }
  const client = new Anthropic({ apiKey })
  try {
    const supportsEffort = !/haiku|sonnet-4|opus-4-5/.test(model)
    const response = await client.messages.create({
      model,
      max_tokens: 300,
      system: req.system,
      messages: req.messages,
      ...(supportsEffort ? { output_config: { effort: 'low' as const } } : {})
    })
    if (response.stop_reason === 'refusal') return { ok: false, error: 'refusal' }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()
    if (!text) return { ok: false, error: 'Empty reply' }
    return { ok: true, text }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Invalid API key' }
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'Rate limited, try again in a moment' }
    if (error instanceof Anthropic.BadRequestError) return { ok: false, error: `Bad request: ${error.message}` }
    if (error instanceof Anthropic.APIError) return { ok: false, error: `API error ${error.status}: ${error.message}` }
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
