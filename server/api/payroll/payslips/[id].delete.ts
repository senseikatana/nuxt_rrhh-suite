import { and, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/** Elimina una nómina concreta mientras su periodo siga abierto. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para borrar nóminas' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [row] = await db
    .select({
      id: schema.payslips.id,
      gross: schema.payslips.gross,
      net: schema.payslips.net,
      periodStatus: schema.payrollPeriods.status,
    })
    .from(schema.payslips)
    .innerJoin(schema.payrollPeriods, eq(schema.payslips.periodId, schema.payrollPeriods.id))
    .where(and(eq(schema.payslips.id, id), eq(schema.payrollPeriods.orgId, org.id)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Nómina no encontrada' })
  if (row.periodStatus === 'closed') {
    throw createError({ statusCode: 409, statusMessage: 'El periodo está cerrado' })
  }

  await db.delete(schema.payslips).where(eq(schema.payslips.id, row.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'payroll.payslip.delete',
      entity: 'payslip',
      entityId: row.id,
      before: { gross: row.gross, net: row.net },
    },
    event,
  )

  return { ok: true }
})
