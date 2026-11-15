import { eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../database/schema'

const replySchema = z.object({
  code: z.string().regex(/^WD-[A-Z0-9]{8}$/i, 'Código de seguimiento inválido'),
  body: z.string().min(1, 'Escribe un mensaje').max(3000),
})

/**
 * Respuesta anónima del denunciante dentro del hilo.
 * Se valida el código; no se guarda ningún dato del remitente.
 */
export default defineEventHandler(async (event) => {
  const parsed = replySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const code = parsed.data.code.trim().toUpperCase()
  const db = useDb()

  const [report] = await db
    .select({ id: schema.whistleReports.id, status: schema.whistleReports.status })
    .from(schema.whistleReports)
    .where(eq(schema.whistleReports.trackingCode, code))
    .limit(1)

  if (!report) {
    throw createError({ statusCode: 404, statusMessage: 'No existe ninguna denuncia con ese código' })
  }
  if (report.status === 'closed') {
    throw createError({ statusCode: 409, statusMessage: 'El caso está cerrado' })
  }

  const now = new Date()
  await db.insert(schema.whistleMessages).values({
    id: crypto.randomUUID(),
    reportId: report.id,
    authorType: 'reporter',
    body: parsed.data.body,
    createdAt: now,
  })

  await db
    .update(schema.whistleReports)
    .set({ updatedAt: now })
    .where(eq(schema.whistleReports.id, report.id))

  return { ok: true }
})
