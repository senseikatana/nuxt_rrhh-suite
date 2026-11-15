import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)')

const upsertSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  patternId: z.string().min(1).nullable().optional(),
  startTime: time.nullable().optional(),
  endTime: time.nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
})

/**
 * Asigna un turno a un empleado en una fecha.
 *
 * Es un upsert por (empleado, fecha): reasignar el mismo día actualiza la fila
 * en vez de duplicarla, que es lo que espera quien edita un cuadrante.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const parsed = upsertSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const { employeeId, date, patternId, notes } = parsed.data

  const [employee] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, employeeId), eq(schema.employees.orgId, org.id)))
    .limit(1)

  if (!employee) throw createError({ statusCode: 404, statusMessage: 'Empleado no encontrado' })

  let startTime = parsed.data.startTime ?? null
  let endTime = parsed.data.endTime ?? null

  if (patternId) {
    const [pattern] = await db
      .select()
      .from(schema.shiftPatterns)
      .where(and(eq(schema.shiftPatterns.id, patternId), eq(schema.shiftPatterns.orgId, org.id)))
      .limit(1)
    if (!pattern) throw createError({ statusCode: 404, statusMessage: 'Turno no encontrado' })
    // El patrón define el horario salvo que se indique uno explícito.
    startTime = startTime ?? pattern.startTime
    endTime = endTime ?? pattern.endTime
  }

  const [existing] = await db
    .select()
    .from(schema.shiftAssignments)
    .where(
      and(
        eq(schema.shiftAssignments.employeeId, employeeId),
        eq(schema.shiftAssignments.date, date),
      ),
    )
    .limit(1)

  const id = existing?.id ?? crypto.randomUUID()

  if (existing) {
    await db
      .update(schema.shiftAssignments)
      .set({ patternId: patternId ?? null, startTime, endTime, notes: notes ?? null })
      .where(eq(schema.shiftAssignments.id, id))
  } else {
    await db.insert(schema.shiftAssignments).values({
      id,
      orgId: org.id,
      employeeId,
      date,
      patternId: patternId ?? null,
      startTime,
      endTime,
      notes: notes ?? null,
    })
  }

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: existing ? 'shift.assignment.update' : 'shift.assignment.create',
      entity: 'shift_assignment',
      entityId: id,
      after: { employeeId, date, patternId: patternId ?? null, startTime, endTime },
    },
    event,
  )

  return { id, updated: Boolean(existing) }
})
