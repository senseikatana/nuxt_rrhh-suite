import { asc, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getContext } from '../../../utils/hr'

/**
 * Catálogo de categorías de gasto de la empresa.
 *
 * Alimenta el selector del formulario. Las categorías nuevas se crean con
 * `POST /api/expenses/categories` (o automáticamente al guardar una nota con
 * una categoría que aún no existía).
 */
export default defineEventHandler(async (event) => {
  const { db, org } = await getContext(event)

  return db
    .select({
      id: schema.expenseCategories.id,
      name: schema.expenseCategories.name,
      color: schema.expenseCategories.color,
      active: schema.expenseCategories.active,
    })
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.orgId, org.id))
    .orderBy(asc(schema.expenseCategories.name))
})
