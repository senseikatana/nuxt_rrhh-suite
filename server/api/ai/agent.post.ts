import { z } from 'zod'
import { runAgent } from '../../services/ai/agent'
import { aiConfigured, aiConfig } from '../../services/ai/client'
import type { AiModule } from '../../services/ai/tools'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

const MODULES = [
  'contenido',
  'empleados',
  'fichaje',
  'turnos',
  'gastos',
  'nominas',
  'reclutamiento',
  'vacaciones',
  'denuncias',
] as const

const bodySchema = z.object({
  module: z.enum(MODULES).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
})

/**
 * Límite simple por usuario para que un agente en bucle no dispare el gasto.
 * Vive en memoria de la instancia: es una salvaguarda, no un cuota exacta.
 */
const WINDOW_MS = 60_000
const MAX_REQUESTS = 15
const hits = new Map<string, { count: number; resetAt: number }>()

function throttle(userId: string) {
  const now = Date.now()
  const entry = hits.get(userId)
  if (!entry || entry.resetAt < now) {
    hits.set(userId, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  entry.count += 1
  if (entry.count > MAX_REQUESTS) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Demasiadas peticiones a la IA. Espera un minuto.',
    })
  }
}

/** Ejecuta el asistente de contenido sobre la organización del usuario. */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'El asistente de contenido requiere rol de mando o administración.',
    })
  }

  if (!aiConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'La IA no está configurada. Define AI_API_KEY en el entorno.',
    })
  }

  throttle(user.id)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const result = await runAgent(
    { db, user, employee, org, event },
    parsed.data.messages,
    parsed.data.module as AiModule | undefined,
  )

  return {
    ...result,
    model: aiConfig().model,
  }
})
