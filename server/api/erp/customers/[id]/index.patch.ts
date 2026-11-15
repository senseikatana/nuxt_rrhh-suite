import { and, eq, ne } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { getErpContext } from '../../../../utils/erp'
import { customerUpdate, parseOrThrow } from '../../../../utils/erp-schemas'

/**
 * Actualización de datos maestros de un cliente.
 * Solo admin y compras (los datos maestros de clientes son de compras).
 */
export default defineEventHandler(async (event) => {
  const { db, actor, orgId } = await getErpContext(event)

  if (!['admin', 'buyer'].includes(actor.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Role '${actor.role}' is not permitted. Allowed roles: admin, buyer`,
    })
  }

  const customerId = getRouterParam(event, 'id')
  const body = parseOrThrow(customerUpdate, await readBody(event), 'Invalid customer')

  const [customer] = await db
    .select()
    .from(schema.erpCustomers)
    .where(eq(schema.erpCustomers.id, customerId!))
  if (!customer || customer.orgId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Customer not found' })
  }

  if (body.code) {
    const [duplicate] = await db
      .select({ id: schema.erpCustomers.id })
      .from(schema.erpCustomers)
      .where(
        and(
          eq(schema.erpCustomers.orgId, orgId),
          eq(schema.erpCustomers.code, body.code),
          ne(schema.erpCustomers.id, customer.id),
        ),
      )
      .limit(1)
    if (duplicate) {
      throw createError({ statusCode: 409, statusMessage: `Customer code '${body.code}' already exists` })
    }
  }

  const [updated] = await db
    .update(schema.erpCustomers)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(schema.erpCustomers.id, customer.id))
    .returning()

  return updated
})
