import { and, eq } from 'drizzle-orm'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

/**
 * Elimina una nota de gasto en borrador (con sus líneas).
 * El propietario puede borrar la suya; mandos y administración, cualquiera.
 * Las notas ya enviadas conservan su histórico.
 */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [report] = await db
    .select()
    .from(schema.expenseReports)
    .where(and(eq(schema.expenseReports.id, id), eq(schema.expenseReports.orgId, org.id)))
    .limit(1)
  if (!report) throw createError({ statusCode: 404, statusMessage: 'Nota de gasto no encontrada' })

  if (!isManagerOrAdmin(user.role) && report.employeeId !== employee?.id) {
    throw createError({ statusCode: 403, statusMessage: 'No puedes borrar esta nota de gasto' })
  }
  if (report.status !== 'draft') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Solo se borran notas en borrador; el resto conserva su histórico',
    })
  }

  await db.delete(schema.expenseReports).where(eq(schema.expenseReports.id, report.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'expense.delete',
      entity: 'expense_report',
      entityId: report.id,
      before: { total: report.total, status: report.status },
    },
    event,
  )

  return { ok: true }
})
