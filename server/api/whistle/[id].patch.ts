import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

const updateSchema = z.object({
  status: z.enum(['new', 'in_review', 'resolved', 'closed']).optional(),
  message: z.string().min(1).max(3000).optional(),
})

/**
 * Gestión de una denuncia: cambia el estado y/o responde al denunciante.
 * La respuesta queda como mensaje de tipo `company` en el hilo.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const parsed = updateSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const [report] = await db
    .select()
    .from(schema.whistleReports)
    .where(and(eq(schema.whistleReports.id, id), eq(schema.whistleReports.orgId, org.id)))
    .limit(1)

  if (!report) throw createError({ statusCode: 404, statusMessage: 'Denuncia no encontrada' })

  const now = new Date()
  const { status, message } = parsed.data

  await db.transaction(async (tx) => {
    if (status) {
      await tx
        .update(schema.whistleReports)
        .set({ status, updatedAt: now })
        .where(eq(schema.whistleReports.id, id))
    }
    if (message) {
      await tx.insert(schema.whistleMessages).values({
        id: crypto.randomUUID(),
        reportId: id,
        authorType: 'company',
        body: message,
        createdAt: now,
      })
    }
  })

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'whistle.update',
      entity: 'whistle_report',
      entityId: id,
      before: { status: report.status },
      after: { status: status ?? report.status, replied: Boolean(message) },
    },
    event,
  )

  return { id, status: status ?? report.status }
})
