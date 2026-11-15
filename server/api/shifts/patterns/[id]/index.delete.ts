import { and, eq } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { recordAudit } from '../../../../utils/audit'
import { getContext } from '../../../../utils/hr'
import { isManagerOrAdmin } from '../../../../utils/session'

/** Elimina un patrón de turno (las asignaciones quedan sin patrón). */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [pattern] = await db
    .select()
    .from(schema.shiftPatterns)
    .where(and(eq(schema.shiftPatterns.id, id), eq(schema.shiftPatterns.orgId, org.id)))
    .limit(1)

  if (!pattern) throw createError({ statusCode: 404, statusMessage: 'Turno no encontrado' })

  await db.delete(schema.shiftPatterns).where(eq(schema.shiftPatterns.id, id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'shift.pattern.delete',
      entity: 'shift_pattern',
      entityId: id,
      before: { name: pattern.name },
    },
    event,
  )

  return { ok: true }
})
