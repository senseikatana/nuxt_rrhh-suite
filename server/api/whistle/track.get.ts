import { asc, eq } from 'drizzle-orm'
import * as schema from '../../database/schema'

/**
 * Seguimiento anónimo de una denuncia por código.
 *
 * Devuelve el estado y el hilo de mensajes. No expone la organización ni datos
 * internos: solo lo necesario para que el denunciante vea cómo avanza su caso.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const code = typeof query.code === 'string' ? query.code.trim().toUpperCase() : ''

  if (!/^WD-[A-Z0-9]{8}$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'Código de seguimiento inválido' })
  }

  const db = useDb()
  const [report] = await db
    .select({
      id: schema.whistleReports.id,
      trackingCode: schema.whistleReports.trackingCode,
      category: schema.whistleReports.category,
      description: schema.whistleReports.description,
      status: schema.whistleReports.status,
      createdAt: schema.whistleReports.createdAt,
      updatedAt: schema.whistleReports.updatedAt,
    })
    .from(schema.whistleReports)
    .where(eq(schema.whistleReports.trackingCode, code))
    .limit(1)

  if (!report) {
    throw createError({ statusCode: 404, statusMessage: 'No existe ninguna denuncia con ese código' })
  }

  const messages = await db
    .select({
      id: schema.whistleMessages.id,
      authorType: schema.whistleMessages.authorType,
      body: schema.whistleMessages.body,
      createdAt: schema.whistleMessages.createdAt,
    })
    .from(schema.whistleMessages)
    .where(eq(schema.whistleMessages.reportId, report.id))
    .orderBy(asc(schema.whistleMessages.createdAt))

  return { report, messages }
})
