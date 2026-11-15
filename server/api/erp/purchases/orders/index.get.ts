import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { getErpContext, intQuery } from '../../../../utils/erp'

/**
 * Listado de pedidos de compra con filtro opcional por estado.
 * Incluye proveedor y líneas para que la cola de calidad muestre el detalle.
 */
export default defineEventHandler(async (event) => {
  const { db, orgId } = await getErpContext(event)

  const query = getQuery(event)
  const limit = intQuery(query.limit, 50, 1, 500)
  const offset = intQuery(query.offset, 0, 0, 100_000)

  // Validar el filtro contra los valores del enum: un valor fuera de él llega a
  // `inArray` y Postgres revienta con un 500 en vez de un 400 claro.
  const statusValues = schema.erpPurchaseOrders.status.enumValues as readonly string[]
  const rawStatus = query.status ? ([] as string[]).concat(query.status as string[]) : []
  for (const s of rawStatus) {
    if (!statusValues.includes(s)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid status filter: '${s}'` })
    }
  }
  const statusFilter = rawStatus as (typeof schema.erpPurchaseOrders.status.enumValues)[number][]

  const conditions: SQL[] = [eq(schema.erpPurchaseOrders.orgId, orgId)]
  if (statusFilter.length) {
    conditions.push(inArray(schema.erpPurchaseOrders.status, statusFilter))
  }
  const where = and(...conditions)

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.erpPurchaseOrders)
    .where(where)

  const orders = await db
    .select()
    .from(schema.erpPurchaseOrders)
    .where(where)
    .orderBy(desc(schema.erpPurchaseOrders.orderDate), desc(schema.erpPurchaseOrders.id))
    .limit(limit)
    .offset(offset)

  const orderIds = orders.map((order) => order.id)
  const vendorIds = [...new Set(orders.map((order) => order.vendorId))]

  const lines = orderIds.length
    ? await db
        .select({
          id: schema.erpPurchaseOrderLines.id,
          orderId: schema.erpPurchaseOrderLines.orderId,
          itemId: schema.erpPurchaseOrderLines.itemId,
          quantity: schema.erpPurchaseOrderLines.quantity,
          unitCost: schema.erpPurchaseOrderLines.unitCost,
          qtyReceived: schema.erpPurchaseOrderLines.qtyReceived,
          qcStatus: schema.erpPurchaseOrderLines.qcStatus,
          stockPosted: schema.erpPurchaseOrderLines.stockPosted,
          item_code: schema.erpItems.code,
          item_description: schema.erpItems.description,
        })
        .from(schema.erpPurchaseOrderLines)
        .leftJoin(schema.erpItems, eq(schema.erpPurchaseOrderLines.itemId, schema.erpItems.id))
        .where(inArray(schema.erpPurchaseOrderLines.orderId, orderIds))
    : []

  const vendors = vendorIds.length
    ? await db
        .select({ id: schema.erpVendors.id, name: schema.erpVendors.name })
        .from(schema.erpVendors)
        .where(and(inArray(schema.erpVendors.id, vendorIds), eq(schema.erpVendors.orgId, orgId)))
    : []

  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.name]))

  return {
    items: orders.map((order) => ({
      ...order,
      vendor_name: vendorNames.get(order.vendorId) ?? null,
      lines: lines.filter((line) => line.orderId === order.id),
    })),
    meta: { total: countRow?.total ?? 0, limit, offset },
  }
})
