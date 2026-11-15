import { z } from 'zod'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import { ensureExpenseCategories } from '../../utils/expense-categories'
import { getContext } from '../../utils/hr'

const lineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de la línea inválida'),
  category: z.string().min(1, 'Indica la categoría').max(60),
  description: z.string().max(300).optional(),
  amount: z.number().positive('El importe debe ser mayor que 0'),
  tax: z.number().min(0).default(0),
  attachmentPath: z.string().max(500).optional(),
})

const createSchema = z.object({
  notes: z.string().max(1000).optional(),
  lines: z.array(lineSchema).min(1, 'Añade al menos una línea de gasto').max(50),
})

/**
 * Crea una nota de gasto en estado `draft` con sus líneas.
 * El total se calcula en servidor: nunca se confía en el del cliente.
 */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)

  if (!employee) {
    throw createError({ statusCode: 400, statusMessage: 'Tu usuario no tiene ficha de empleado' })
  }

  const parsed = createSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const { notes, lines } = parsed.data
  const id = crypto.randomUUID()
  const now = new Date()
  const total = lines.reduce((sum, line) => sum + line.amount, 0)

  // Categorías nuevas (EPIs, material de seguridad…) pasan al catálogo.
  // Un fallo del catálogo no debe impedir registrar la nota.
  await ensureExpenseCategories(db, org.id, lines.map((line) => line.category)).catch((error) =>
    console.error('[expense-categories]', error),
  )

  await db.transaction(async (tx) => {
    await tx.insert(schema.expenseReports).values({
      id,
      orgId: org.id,
      employeeId: employee.id,
      status: 'draft',
      total: Math.round(total * 100) / 100,
      notes: notes ?? null,
      createdAt: now,
    })

    await tx.insert(schema.expenseLines).values(
      lines.map((line) => ({
        id: crypto.randomUUID(),
        reportId: id,
        date: line.date,
        category: line.category,
        description: line.description ?? null,
        amount: line.amount,
        tax: line.tax ?? 0,
        attachmentPath: line.attachmentPath ?? null,
      })),
    )
  })

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'expense.create',
      entity: 'expense_report',
      entityId: id,
      after: { total, lines: lines.length, status: 'draft' },
    },
    event,
  )

  return { id, total, status: 'draft' as const }
})
