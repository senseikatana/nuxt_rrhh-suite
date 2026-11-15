/**
 * Bucle del agente de contenido.
 *
 * El modelo recibe la conversación y el catálogo de herramientas; cuando pide
 * una herramienta se ejecuta en servidor y el resultado vuelve al modelo hasta
 * que produce una respuesta final. Se limita el número de pasos para que un
 * modelo que se atasca no genere un bucle infinito.
 */
import { chat, type ChatMessage } from './client'
import { runTool, toolSpecs, type ToolContext } from './tools'

export interface AgentAction {
  tool: string
  ok: boolean
  summary: string
  args?: unknown
}

export interface AgentResult {
  reply: string
  actions: AgentAction[]
  steps: number
}

export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

const MAX_STEPS = 5

function safeArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function errorText(error: unknown): string {
  const typed = error as { statusMessage?: string; data?: { message?: string }; message?: string }
  return typed?.data?.message || typed?.statusMessage || typed?.message || 'Error desconocido'
}

function systemPrompt(ctx: ToolContext): string {
  return [
    `Eres el asistente de contenido de RRHH Suite para la empresa "${ctx.org.name}".`,
    'Ayudas a crear, actualizar y modificar el contenido del sitio: textos de bloques',
    '(banners, avisos del dashboard, políticas, pie de página) y ofertas de empleo.',
    '',
    'Reglas:',
    '- Responde siempre en español, de forma breve y concreta.',
    '- Para cualquier cambio usa las herramientas; nunca inventes que ya está hecho.',
    '- Antes de modificar o eliminar algo existente, usa list_content o list_job_postings',
    '  para conocer la clave o el id real.',
    '- Usa claves de contenido en minúsculas con formato "seccion.nombre", por ejemplo:',
    '  dashboard.banner, dashboard.welcome, site.footer, policy.vacaciones.',
    '- Si falta información imprescindible, pide lo mínimo necesario en una sola frase.',
    '- Cuando termines, resume en una línea qué has cambiado.',
    '',
    `Contexto: usuario "${ctx.user.name}" con rol "${ctx.user.role}".`,
  ].join('\n')
}

export async function runAgent(
  ctx: ToolContext,
  history: AgentHistoryMessage[],
): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(ctx) },
    ...history.map((message) => ({ role: message.role, content: message.content })),
  ]

  const actions: AgentAction[] = []
  let lastText = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const { message } = await chat({ messages, tools: toolSpecs() })
    lastText = message.content?.trim() || lastText

    const calls = message.tool_calls ?? []
    if (!calls.length) {
      return {
        reply: message.content?.trim() || 'Listo.',
        actions,
        steps: step + 1,
      }
    }

    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls })

    for (const call of calls) {
      try {
        const result = await runTool(call.function.name, call.function.arguments, ctx)
        actions.push({
          tool: call.function.name,
          ok: true,
          summary: result.summary,
          args: safeArgs(call.function.arguments),
        })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: true, ...result }).slice(0, 4000),
        })
      } catch (error) {
        const text = errorText(error)
        actions.push({
          tool: call.function.name,
          ok: false,
          summary: text,
          args: safeArgs(call.function.arguments),
        })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: text }).slice(0, 2000),
        })
      }
    }
  }

  return {
    reply: lastText || 'He aplicado los cambios solicitados.',
    actions,
    steps: MAX_STEPS,
  }
}
