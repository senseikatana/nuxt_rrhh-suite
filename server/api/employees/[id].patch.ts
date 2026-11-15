import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)')
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')

const patchSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(40).nullable().optional(),
    position: z.string().max(80).nullable().optional(),
    departmentId: z.string().nullable().optional(),
    startDate: DATE.optional(),
    endDate: DATE.nullable().optional(),
    weeklyHours: z.number().min(0).max(60).optional(),
    scheduleStart: TIME.nullable().optional(),
    scheduleEnd: TIME.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nada que actualizar' })

/** Edita la ficha de un empleado (mandos y administración). */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para editar empleados' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const parsed = patchSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const [employee] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), eq(schema.employees.orgId, org.id)))
    .limit(1)
  if (!employee) throw createError({ statusCode: 404, statusMessage: 'Empleado no encontrado' })

  if (parsed.data.departmentId) {
    const [department] = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(
        and(
          eq(schema.departments.id, parsed.data.departmentId),
          eq(schema.departments.orgId, org.id),
        ),
      )
      .limit(1)
    if (!department) {
      throw createError({ statusCode: 404, statusMessage: 'Departamento no encontrado' })
    }
  }

  if (parsed.data.email) {
    const [duplicate] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(
        and(
          eq(schema.employees.orgId, org.id),
          ne(schema.employees.id, employee.id),
          sql`lower(${schema.employees.email}) = lower(${parsed.data.email})`,
        ),
      )
      .limit(1)
    if (duplicate) {
      throw createError({ statusCode: 409, statusMessage: 'Ya hay otro empleado con ese email' })
    }
  }

  await db
    .update(schema.employees)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.employees.id, employee.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'employee.update',
      entity: 'employee',
      entityId: employee.id,
      after: parsed.data,
    },
    event,
  )

  return { id: employee.id, ...parsed.data }
})
