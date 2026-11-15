import { eq } from 'drizzle-orm'
import type { Db } from '../database/client'
import * as schema from '../database/schema'

/**
 * Registra en el catálogo las categorías usadas por una nota de gasto.
 *
 * Así una categoría nueva (por ejemplo "EPIs" o "Material de seguridad") queda
 * disponible para el resto de la empresa sin pasos extra. La comparación es
 * insensible a mayúsculas para no duplicar "Transporte" y "transporte".
 */
export async function ensureExpenseCategories(db: Db, orgId: string, names: string[]) {
  const cleaned = [
    ...new Map(
      names
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [name.toLowerCase(), name] as const),
    ).values(),
  ]
  if (!cleaned.length) return []

  const existing = await db
    .select({ name: schema.expenseCategories.name })
    .from(schema.expenseCategories)
    .where(eq(schema.expenseCategories.orgId, orgId))

  const seen = new Set(existing.map((row) => row.name.toLowerCase()))
  const toCreate = cleaned.filter((name) => !seen.has(name.toLowerCase()))
  if (!toCreate.length) return []

  await db
    .insert(schema.expenseCategories)
    .values(
      toCreate.map((name) => ({
        id: crypto.randomUUID(),
        orgId,
        name,
        color: '#0ea5e9',
        active: true,
        createdAt: new Date(),
      })),
    )
    .onConflictDoNothing()

  return toCreate
}
