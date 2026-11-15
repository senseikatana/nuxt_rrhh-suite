import { aiConfig, aiConfigured } from '../../services/ai/client'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

/**
 * Estado del asistente. Nunca devuelve la clave: solo si está configurado,
 * el modelo y el host del gateway (útil para diagnosticar).
 */
export default defineEventHandler(async (event) => {
  const { user } = await getContext(event)
  const config = aiConfig()

  let host = ''
  try {
    host = new URL(config.baseUrl).host
  } catch {
    host = config.baseUrl
  }

  return {
    configured: aiConfigured(),
    model: config.model,
    host,
    canUse: isManagerOrAdmin(user.role),
  }
})
