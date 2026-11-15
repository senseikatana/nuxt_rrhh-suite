import { and, eq } from 'drizzle-orm'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

/** Elimina una denuncia y su hilo de mensajes (mandos y administración). */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para borrar denuncias' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [report] = await db
    .select()
    .from(schema.whistleReports)
    .where(and(eq(schema.whistleReports.id, id), eq(schema.whistleReports.orgId, org.id)))
    .limit(1)
  if (!report) throw createError({ statusCode: 404, statusMessage: 'Denuncia no encontrada' })

  await db.delete(schema.whistleReports).where(eq(schema.whistleReports.id, report.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'whistle.delete',
      entity: 'whistle_report',
      entityId: report.id,
      before: { trackingCode: report.trackingCode, status: report.status },
    },
    event,
  )

  return { ok: true }
})
