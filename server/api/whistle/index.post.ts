import { eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../database/schema'
import { getOrganization } from '../../utils/hr'

const createSchema = z.object({
  category: z.string().min(2, 'Indica la categoría').max(80),
  description: z.string().min(20, 'Describe los hechos con más detalle').max(5000),
})

/** Código de seguimiento legible: WD-XXXXXXXX. */
function generateTrackingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sin I, O, 0, 1
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  return `WD-${code}`
}

/**
 * Alta anónima de una denuncia.
 *
 * No requiere sesión: el canal debe permitir denunciar sin identificarse. No se
 * guarda ningún dato del remitente (ni IP ni user-agent), solo el contenido y un
 * código de seguimiento que se devuelve una única vez.
 */
export default defineEventHandler(async (event) => {
  const parsed = createSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const db = useDb()
  const org = await getOrganization(db)
  if (!org) {
    throw createError({ statusCode: 500, statusMessage: 'No hay empresa configurada' })
  }

  const { category, description } = parsed.data
  const now = new Date()

  // Reintenta si el código choca (probabilidad muy baja, pero el índice es único).
  for (let attempt = 0; attempt < 5; attempt++) {
    const trackingCode = generateTrackingCode()
    const [existing] = await db
      .select({ id: schema.whistleReports.id })
      .from(schema.whistleReports)
      .where(eq(schema.whistleReports.trackingCode, trackingCode))
      .limit(1)
    if (existing) continue

    const id = crypto.randomUUID()
    await db.insert(schema.whistleReports).values({
      id,
      orgId: org.id,
      trackingCode,
      category,
      description,
      status: 'new',
      createdAt: now,
      updatedAt: now,
    })

    return { trackingCode }
  }

  throw createError({ statusCode: 500, statusMessage: 'No se pudo generar el código' })
})
