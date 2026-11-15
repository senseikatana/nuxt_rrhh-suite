import { and, eq } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { recordAudit } from '../../../../utils/audit'
import { getContext } from '../../../../utils/hr'
import { isManagerOrAdmin } from '../../../../utils/session'

/**
 * Cierra un periodo de nómina (open -> closed).
 * Una vez cerrado no admite más nóminas ni ediciones.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Solo administración cierra periodos' })
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
    throw createError({ statusCode: 409, statusMessage: 'El periodo ya está cerrado' })
  }

  await db
    .update(schema.payrollPeriods)
    .set({ status: 'closed' })
    .where(eq(schema.payrollPeriods.id, id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'payroll.period.close',
      entity: 'payroll_period',
      entityId: id,
      before: { status: 'open' },
      after: { status: 'closed' },
    },
    event,
  )

  return { id, status: 'closed' as const }
})
