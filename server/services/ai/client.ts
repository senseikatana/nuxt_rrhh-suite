/**
 * Cliente del gateway FreeLLMAPI (compatible con la API de OpenAI).
 *
 * Se usa para el asistente de contenido: mantiene la conversación y ejecuta
 * herramientas. Todo pasa por HTTP, así que funciona igual en Node y en
 * Cloudflare Workers (sin SDK propietario ni dependencias extra).
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatResult {
  message: { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  finishReason: string
}

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** Configuración desde el entorno (nunca se registra la clave en logs). */
export function aiConfig(): AiConfig {
  return {
    baseUrl: (process.env.AI_BASE_URL || 'http://127.0.0.1:31415/v1').replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'auto',
  }
}

export function aiConfigured(): boolean {
  return Boolean(aiConfig().apiKey)
}

export interface ChatInput {
  messages: ChatMessage[]
  tools?: ToolSpec[]
  toolChoice?: 'auto' | 'none'
  maxTokens?: number
  temperature?: number
}

/**
 * Envía una conversación al gateway y devuelve el siguiente mensaje del modelo.
 * Si el modelo decide llamar a herramientas, vienen en `tool_calls`.
 */
export async function chat(input: ChatInput): Promise<ChatResult> {
  const config = aiConfig()

  if (!config.apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'La IA no está configurada (falta AI_API_KEY).',
    })
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages: input.messages,
    max_tokens: input.maxTokens ?? 2000,
    temperature: input.temperature ?? 0.3,
  }

  if (input.tools?.length) {
    body.tools = input.tools
    body.tool_choice = input.toolChoice ?? 'auto'
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: `No se pudo contactar con el proveedor de IA: ${(error as Error).message}`,
    })
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: `El proveedor de IA respondió ${response.status}: ${detail.slice(0, 200)}`,
    })
  }

  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string
      message?: { role?: string; content?: string | null; tool_calls?: ToolCall[] }
    }>
  }

  const choice = data.choices?.[0]
  if (!choice?.message) {
    throw createError({ statusCode: 502, statusMessage: 'Respuesta de IA vacía o malformada.' })
  }

  return {
    message: {
      role: 'assistant',
      content: choice.message.content ?? '',
      tool_calls: choice.message.tool_calls,
    },
    finishReason: choice.finish_reason ?? 'stop',
  }
}
