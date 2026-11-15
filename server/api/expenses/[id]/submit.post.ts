import { and, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'

/**
 * Envía una nota de gasto a validación (draft -> submitted).
 * Solo el propietario puede enviarla.
 */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })
  if (!employee) {
    throw createError({ statusCode: 403, statusMessage: 'Tu usuario no tiene ficha de empleado' })
  }

  const [report] = await db
    .select()
    .from(schema.expenseReports)
    .where(and(eq(schema.expenseReports.id, id), eq(schema.expenseReports.orgId, org.id)))
    .limit(1)

  if (!report) throw createError({ statusCode: 404, statusMessage: 'Nota de gasto no encontrada' })
  if (report.employeeId !== employee.id) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el propietario puede enviarla' })
  }
  if (report.status !== 'draft') {
    throw createError({ statusCode: 409, statusMessage: 'Solo se envían notas en borrador' })
  }

  const now = new Date()
  await db
    .update(schema.expenseReports)
    .set({ status: 'submitted', submittedAt: now })
    .where(eq(schema.expenseReports.id, id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'expense.submit',
      entity: 'expense_report',
      entityId: id,
      before: { status: 'draft' },
      after: { status: 'submitted' },
    },
    event,
  )

  return { id, status: 'submitted' as const }
})
