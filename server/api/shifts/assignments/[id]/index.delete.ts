import { and, eq } from 'drizzle-orm'
import * as schema from '../../../../database/schema'
import { recordAudit } from '../../../../utils/audit'
import { getContext } from '../../../../utils/hr'
import { isManagerOrAdmin } from '../../../../utils/session'

/** Quita una asignación de turno. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [assignment] = await db
    .select()
    .from(schema.shiftAssignments)
    .where(and(eq(schema.shiftAssignments.id, id), eq(schema.shiftAssignments.orgId, org.id)))
    .limit(1)

  if (!assignment) throw createError({ statusCode: 404, statusMessage: 'Asignación no encontrada' })

  await db.delete(schema.shiftAssignments).where(eq(schema.shiftAssignments.id, id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'shift.assignment.delete',
      entity: 'shift_assignment',
      entityId: id,
      before: { employeeId: assignment.employeeId, date: assignment.date },
    },
    event,
  )

  return { ok: true }
})
