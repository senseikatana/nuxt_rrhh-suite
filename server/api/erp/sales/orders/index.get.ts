import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { getErpContext, intQuery } from '../../../../utils/erp'

/**
 * Listado de pedidos de venta, con filtro opcional por estado.
 * Incluye el nombre del cliente y las líneas para que el listado no tenga que
 * mostrar UUIDs ni pedir el detalle de cada pedido.
 */
export default defineEventHandler(async (event) => {
  const { db, orgId } = await getErpContext(event)

  const query = getQuery(event)
  const limit = intQuery(query.limit, 50, 1, 500)
  const offset = intQuery(query.offset, 0, 0, 100_000)

  // Validar el filtro contra los valores del enum: un valor fuera de él llega a
  // `inArray` y Postgres revienta con un 500 en vez de un 400 claro.
  const statusValues = schema.erpSalesOrders.status.enumValues as readonly string[]
  const rawStatus = query.status ? ([] as string[]).concat(query.status as string[]) : []
  for (const s of rawStatus) {
    if (!statusValues.includes(s)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid status filter: '${s}'` })
    }
  }
  const statusFilter = rawStatus as (typeof schema.erpSalesOrders.status.enumValues)[number][]

  const conditions: SQL[] = [eq(schema.erpSalesOrders.orgId, orgId)]
  if (statusFilter.length) {
    conditions.push(inArray(schema.erpSalesOrders.status, statusFilter))
  }
  const where = and(...conditions)

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.erpSalesOrders)
    .where(where)

  const orders = await db
    .select()
    .from(schema.erpSalesOrders)
    .where(where)
    .orderBy(desc(schema.erpSalesOrders.orderDate), desc(schema.erpSalesOrders.id))
    .limit(limit)
    .offset(offset)

  const orderIds = orders.map((order) => order.id)
  const customerIds = [...new Set(orders.map((order) => order.customerId))]

  const lines = orderIds.length
    ? await db
        .select({
          id: schema.erpSalesOrderLines.id,
          orderId: schema.erpSalesOrderLines.orderId,
          itemId: schema.erpSalesOrderLines.itemId,
          quantity: schema.erpSalesOrderLines.quantity,
          unitPrice: schema.erpSalesOrderLines.unitPrice,
          qtyPicked: schema.erpSalesOrderLines.qtyPicked,
          qtyShipped: schema.erpSalesOrderLines.qtyShipped,
          item_code: schema.erpItems.code,
          item_description: schema.erpItems.description,
        })
        .from(schema.erpSalesOrderLines)
        .leftJoin(schema.erpItems, eq(schema.erpSalesOrderLines.itemId, schema.erpItems.id))
        .where(inArray(schema.erpSalesOrderLines.orderId, orderIds))
    : []

  const customers = customerIds.length
    ? await db
        .select({ id: schema.erpCustomers.id, name: schema.erpCustomers.name })
        .from(schema.erpCustomers)
        .where(and(inArray(schema.erpCustomers.id, customerIds), eq(schema.erpCustomers.orgId, orgId)))
    : []

  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]))

  return {
    items: orders.map((order) => ({
      ...order,
      customer_name: customerNames.get(order.customerId) ?? null,
      lines: lines.filter((line) => line.orderId === order.id),
    })),
    meta: { total: countRow?.total ?? 0, limit, offset },
  }
})
