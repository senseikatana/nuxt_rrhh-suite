import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getErpContext, intQuery, stringQuery } from '../../../utils/erp'

/**
 * Listado de clientes con búsqueda opcional por nombre o código.
 */
export default defineEventHandler(async (event) => {
  const { db, orgId } = await getErpContext(event)

  const query = getQuery(event)
  const limit = intQuery(query.limit, 50, 1, 500)
  const offset = intQuery(query.offset, 0, 0, 100_000)
  const search = stringQuery(query.search)

  const conditions: SQL[] = [eq(schema.erpCustomers.orgId, orgId)]
  if (search) {
    const pattern = `%${search}%`
    conditions.push(
      or(sql`${schema.erpCustomers.name} ilike ${pattern}`, sql`${schema.erpCustomers.code} ilike ${pattern}`)!,
    )
  }
  const where = and(...conditions)

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.erpCustomers)
    .where(where)

  const items = await db
    .select()
    .from(schema.erpCustomers)
    .where(where)
    .orderBy(asc(schema.erpCustomers.name))
    .limit(limit)
    .offset(offset)

  return { items, meta: { total: countRow?.total ?? 0, limit, offset } }
})
