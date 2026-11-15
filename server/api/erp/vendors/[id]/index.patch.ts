import { and, eq, ne } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { getErpContext } from '../../../../utils/erp'
import { parseOrThrow, vendorUpdate } from '../../../../utils/erp-schemas'

/**
 * Actualización de datos maestros de un proveedor. Solo admin y compras.
 */
export default defineEventHandler(async (event) => {
  const { db, actor, orgId } = await getErpContext(event)

  if (!['admin', 'buyer'].includes(actor.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Role '${actor.role}' is not permitted. Allowed roles: admin, buyer`,
    })
  }

  const vendorId = getRouterParam(event, 'id')
  const body = parseOrThrow(vendorUpdate, await readBody(event), 'Invalid vendor')

  const [vendor] = await db.select().from(schema.erpVendors).where(eq(schema.erpVendors.id, vendorId!))
  if (!vendor || vendor.orgId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Vendor not found' })
  }

  if (body.code) {
    const [duplicate] = await db
      .select({ id: schema.erpVendors.id })
      .from(schema.erpVendors)
      .where(
        and(
          eq(schema.erpVendors.orgId, orgId),
          eq(schema.erpVendors.code, body.code),
          ne(schema.erpVendors.id, vendor.id),
        ),
      )
      .limit(1)
    if (duplicate) {
      throw createError({ statusCode: 409, statusMessage: `Vendor code '${body.code}' already exists` })
    }
  }

  const [updated] = await db
    .update(schema.erpVendors)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(schema.erpVendors.id, vendor.id))
    .returning()

  return updated
})
