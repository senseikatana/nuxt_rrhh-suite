import { and, eq } from 'drizzle-orm'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

/**
 * Baja de un empleado (borrado lógico).
 *
 * No se borra la fila: se marca `active=false` y se fija la fecha de fin para
 * conservar el histórico de fichajes, vacaciones y nóminas. Un borrado físico
 * rompería la trazabilidad laboral.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para dar de baja' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [employee] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, org.id)))
    .limit(1)
  if (!employee) throw createError({ statusCode: 404, statusMessage: 'Empleado no encontrado' })

  if (employee.userId === user.id) {
    throw createError({ statusCode: 409, statusMessage: 'No puedes darte de baja a ti mismo' })
  }
  if (!employee.active) {
    throw createError({ statusCode: 409, statusMessage: 'El empleado ya está de baja' })
  }

  const today = new Date().toISOString().slice(0, 10)
  await db
    .update(schema.employees)
    .set({ active: false, endDate: employee.endDate ?? today, updatedAt: new Date() })
    .where(eq(schema.employees.id, employee.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'employee.deactivate',
      entity: 'employee',
      entityId: employee.id,
      before: { active: true },
      after: { active: false, endDate: employee.endDate ?? today },
    },
    event,
  )

  return { id: employee.id, active: false }
})
