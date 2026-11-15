import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido')
      .optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nada que actualizar' })

/** Renombra, recolorea o desactiva una categoría (mandos y administración). */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para editar categorías' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const parsed = patchSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const [category] = await db
    .select()
    .from(schema.expenseCategories)
    .where(and(eq(schema.expenseCategories.id, id), eq(schema.expenseCategories.orgId, org.id)))
    .limit(1)
  if (!category) {
    throw createError({ statusCode: 404, statusMessage: 'Categoría no encontrada' })
  }

  if (parsed.data.name) {
    const [duplicate] = await db
      .select({ id: schema.expenseCategories.id })
      .from(schema.expenseCategories)
      .where(
        and(
          eq(schema.expenseCategories.orgId, org.id),
          ne(schema.expenseCategories.id, category.id),
          sql`lower(${schema.expenseCategories.name}) = lower(${parsed.data.name})`,
        ),
      )
      .limit(1)
    if (duplicate) {
      throw createError({ statusCode: 409, statusMessage: 'Ya existe una categoría con ese nombre' })
    }
  }

  await db
    .update(schema.expenseCategories)
    .set({
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.color ? { color: parsed.data.color } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    })
    .where(eq(schema.expenseCategories.id, category.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'expense_category.update',
      entity: 'expense_category',
      entityId: category.id,
      before: { name: category.name, color: category.color, active: category.active },
      after: parsed.data,
    },
    event,
  )

  return { id: category.id, ...parsed.data }
})
