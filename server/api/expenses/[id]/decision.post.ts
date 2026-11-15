import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const decisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reimburse']),
  note: z.string().max(500).optional(),
})

/**
 * Resolución de una nota de gasto por parte de un mando o administración.
 *
 * - approve:   submitted -> approved
 * - reject:    submitted -> rejected
 * - reimburse: approved  -> reimbursed
 */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para validar gastos' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const parsed = decisionSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const [report] = await db
    .select()
    .from(schema.expenseReports)
    .where(and(eq(schema.expenseReports.id, id), eq(schema.expenseReports.orgId, org.id)))
    .limit(1)

  if (!report) throw createError({ statusCode: 404, statusMessage: 'Nota de gasto no encontrada' })

  const { action, note } = parsed.data
  const transitions: Record<typeof action, { from: string; to: string }> = {
    approve: { from: 'submitted', to: 'approved' },
    reject: { from: 'submitted', to: 'rejected' },
    reimburse: { from: 'approved', to: 'reimbursed' },
  }
  const transition = transitions[action]

  if (report.status !== transition.from) {
    throw createError({
      statusCode: 409,
      statusMessage: `No se puede pasar de ${report.status} a ${transition.to}`,
    })
  }

  const now = new Date()
  await db
    .update(schema.expenseReports)
    .set({
      status: transition.to as typeof report.status,
      approvedBy: employee?.id ?? null,
      approvedAt: action === 'reject' ? null : now,
      notes: note ? [report.notes, note].filter(Boolean).join('\n') : report.notes,
    })
    .where(eq(schema.expenseReports.id, id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: `expense.${action}`,
      entity: 'expense_report',
      entityId: id,
      before: { status: report.status },
      after: { status: transition.to, note: note ?? null },
    },
    event,
  )

  return { id, status: transition.to }
})
