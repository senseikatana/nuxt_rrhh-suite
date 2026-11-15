import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const createSchema = z.object({
  periodId: z.string().min(1),
  employeeId: z.string().min(1),
  gross: z.number().min(0),
  net: z.number().min(0),
  filePath: z.string().max(500).optional(),
})

/**
 * Alta o actualización de una nómina dentro de un periodo abierto.
 * Es un upsert por (periodo, empleado): recalcular una nómina no duplica filas.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para gestionar nóminas' })
  }

  const parsed = createSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const { periodId, employeeId, gross, net, filePath } = parsed.data

  const [period] = await db
    .select()
    .from(schema.payrollPeriods)
    .where(and(eq(schema.payrollPeriods.id, periodId), eq(schema.payrollPeriods.orgId, org.id)))
    .limit(1)

  if (!period) throw createError({ statusCode: 404, statusMessage: 'Periodo no encontrado' })
  if (period.status === 'closed') {
    throw createError({ statusCode: 409, statusMessage: 'El periodo está cerrado' })
  }

  const [target] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, org.id)))
    .limit(1)

  if (!target) throw createError({ statusCode: 404, statusMessage: 'Empleado no encontrado' })

  const [existing] = await db
    .select()
    .from(schema.payslips)
    .where(and(eq(schema.payslips.periodId, periodId), eq(schema.payslips.employeeId, employeeId)))
    .limit(1)

  const id = existing?.id ?? crypto.randomUUID()
  const values = {
    id,
    periodId,
    employeeId,
    gross,
    net,
    filePath: filePath ?? null,
    departmentId: target.departmentId,
  }

  if (existing) {
    await db.update(schema.payslips).set(values).where(eq(schema.payslips.id, id))
  } else {
    await db.insert(schema.payslips).values(values)
  }

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: existing ? 'payslip.update' : 'payslip.create',
      entity: 'payslip',
      entityId: id,
      after: { periodId, employeeId, gross, net },
    },
    event,
  )

  return { id, updated: Boolean(existing) }
})
