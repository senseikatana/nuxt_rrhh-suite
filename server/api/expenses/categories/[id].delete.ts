import { and, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/**
 * Elimina una categoría del catálogo (mandos y administración).
 *
 * Las líneas de gasto guardan el nombre como texto, así que el histórico no se
 * modifica: la categoría deja de ofrecerse para notas nuevas.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para borrar categorías' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [category] = await db
    .select()
    .from(schema.expenseCategories)
    .where(and(eq(schema.expenseCategories.id, id), eq(schema.expenseCategories.orgId, org.id)))
    .limit(1)
  if (!category) {
    throw createError({ statusCode: 404, statusMessage: 'Categoría no encontrada' })
  }

  await db.delete(schema.expenseCategories).where(eq(schema.expenseCategories.id, category.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'expense_category.delete',
      entity: 'expense_category',
      entityId: category.id,
      before: { name: category.name },
    },
    event,
  )

  return { ok: true }
})
