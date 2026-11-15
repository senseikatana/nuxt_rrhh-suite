import { and, eq } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { recordAudit } from '../../../../utils/audit'
import { getContext } from '../../../../utils/hr'
import { isManagerOrAdmin } from '../../../../utils/session'

/**
 * Elimina un periodo de nómina abierto y sus nóminas.
 * Los periodos cerrados se conservan como histórico.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para borrar periodos' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [period] = await db
    .select()
    .from(schema.payrollPeriods)
    .where(and(eq(schema.payrollPeriods.id, id), eq(schema.payrollPeriods.orgId, org.id)))
    .limit(1)
  if (!period) throw createError({ statusCode: 404, statusMessage: 'Periodo no encontrado' })
  if (period.status === 'closed') {
    throw createError({
      statusCode: 409,
      statusMessage: 'No se puede borrar un periodo cerrado (histórico)',
    })
  }

  await db.delete(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, period.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'payroll.period.delete',
      entity: 'payroll_period',
      entityId: period.id,
      before: { year: period.year, month: period.month, status: period.status },
    },
    event,
  )

  return { ok: true }
})
