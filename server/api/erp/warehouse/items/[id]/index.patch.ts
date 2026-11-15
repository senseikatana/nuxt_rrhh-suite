import { and, eq, ne } from 'drizzle-orm'
import * as schema from '../../../../../database/schema'
import { getErpContext } from '../../../../../utils/erp'
import { parseOrThrow, itemUpdate } from '../../../../../utils/erp-schemas'
import { recordActivity } from '../../../../../services/erp-activity'

/**
 * Actualización de datos maestros de un artículo. Solo logística y admin.
 * El stock NO se edita aquí: se mueve por recepciones, aprobaciones de Calidad
 * y ajustes explícitos, para que cada cambio tenga un motivo y un autor.
 */
export default defineEventHandler(async (event) => {
  const { db, actor, orgId } = await getErpContext(event)

  if (actor.role !== 'admin' && actor.role !== 'logistics') {
    throw createError({
      statusCode: 403,
      statusMessage: `Role '${actor.role}' is not permitted. Allowed roles: admin, logistics`,
    })
  }

  const itemId = getRouterParam(event, 'id')
  const { stock: _stock, ...body } = parseOrThrow(
    itemUpdate,
    await readBody(event),
    'Invalid item',
  )

  const [item] = await db.select().from(schema.erpItems).where(eq(schema.erpItems.id, itemId!))
  if (!item || item.orgId !== orgId) {
    throw createError({ statusCode: 404, statusMessage: 'Item not found' })
  }

  if (body.code) {
    const [duplicate] = await db
      .select({ id: schema.erpItems.id })
      .from(schema.erpItems)
      .where(
        and(
          eq(schema.erpItems.orgId, orgId),
          eq(schema.erpItems.code, body.code),
          ne(schema.erpItems.id, item.id),
        ),
      )
      .limit(1)
    if (duplicate) {
      throw createError({ statusCode: 409, statusMessage: `Item code '${body.code}' already exists` })
    }
  }

  const { unitCost, unitPrice, minStock, ...rest } = body

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.erpItems)
      .set({
        ...rest,
        ...(unitCost !== undefined ? { unitCost: Number(unitCost).toFixed(2) } : {}),
        ...(unitPrice !== undefined ? { unitPrice: Number(unitPrice).toFixed(2) } : {}),
        ...(minStock !== undefined ? { minStock: Number(minStock).toFixed(3) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.erpItems.id, item.id))
      .returning()

    await recordActivity(tx, {
      orgId,
      actorId: actor.id,
      actorUsername: actor.username,
      entity: 'item',
      action: 'updated',
      entityId: item.id,
      summary: `Updated item ${row!.code}`,
    })

    return row!
  })

  return updated
})
