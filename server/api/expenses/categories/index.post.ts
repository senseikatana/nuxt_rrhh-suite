import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'

const createSchema = z.object({
  name: z.string().trim().min(2, 'Indica el nombre de la categoría').max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido')
    .optional(),
})

/**
 * Crea una categoría de gasto.
 *
 * Cualquier usuario autenticado puede añadir categorías (por ejemplo EPIs o
 * material de seguridad) para que estén disponibles al registrar una nota.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  const parsed = createSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const [existing] = await db
    .select()
    .from(schema.expenseCategories)
    .where(
      and(
        eq(schema.expenseCategories.orgId, org.id),
        sql`lower(${schema.expenseCategories.name}) = lower(${parsed.data.name})`,
      ),
    )
    .limit(1)

  if (existing) {
    return { id: existing.id, name: existing.name, color: existing.color, created: false }
  }

  const id = crypto.randomUUID()
  await db.insert(schema.expenseCategories).values({
    id,
    orgId: org.id,
    name: parsed.data.name,
    color: parsed.data.color ?? '#0ea5e9',
    active: true,
    createdAt: new Date(),
  })

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'expense_category.create',
      entity: 'expense_category',
      entityId: id,
      after: { name: parsed.data.name },
    },
    event,
  )

  return { id, name: parsed.data.name, color: parsed.data.color ?? '#0ea5e9', created: true }
})
