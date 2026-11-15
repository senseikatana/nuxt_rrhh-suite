import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../database/schema'
import { getContext } from '../../utils/hr'
import { recordAudit } from '../../utils/audit'
import { getAttendanceStatus, getJornadaState } from '../../utils/attendance'
import { localDateKey } from '../../services/attendance/time'

const clockSchema = z.object({
  direction: z.enum(['in', 'out']).optional(),
})

export default defineEventHandler(async (event) => {
  const { db, user, employee, org, settings } = await getContext(event)

  if (!employee) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Tu usuario no tiene ficha de empleado. Pide a RRHH que la vincule.',
    })
  }

  const parsed = clockSchema.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Fichaje inválido' })
  }

  const now = new Date()
  const todayKey = localDateKey(now, org.timezone)

  // Una sola jornada (entrada + salida) por día, para todos los roles.
  const jornada = await getJornadaState(db, employee.id, todayKey, org.timezone)
  if (jornada === 'closed') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ya registraste tu jornada de hoy. Solo se permite un fichaje por día.',
    })
  }

  const [last] = await db
    .select()
    .from(schema.clockEvents)
    .where(eq(schema.clockEvents.employeeId, employee.id))
    .orderBy(desc(schema.clockEvents.occurredAt))
    .limit(1)

  const expectedDirection = last?.direction === 'in' ? 'out' : 'in'
  const direction = parsed.data.direction ?? expectedDirection

  if (parsed.data.direction && parsed.data.direction !== expectedDirection) {
    throw createError({
      statusCode: 409,
      statusMessage:
        expectedDirection === 'in'
          ? 'Ahora corresponde fichar la entrada.'
          : 'Tienes una entrada abierta: ahora corresponde fichar la salida.',
    })
  }

  const userAgent = getHeader(event, 'user-agent') ?? null
  const source = /mobile|android|iphone|ipad/i.test(userAgent ?? '') ? 'mobile' : 'web'

  await db.insert(schema.clockEvents).values({
    id: crypto.randomUUID(),
    orgId: org.id,
    employeeId: employee.id,
    occurredAt: now,
    direction,
    source,
    ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
    userAgent,
    corrected: false,
    note: null,
  })

  await recordAudit(db, {
    orgId: org.id,
    actorUserId: user.id,
    action: `attendance.clock.${direction}`,
    entity: 'clock_event',
    entityId: employee.id,
    after: { direction, occurredAt: now.toISOString(), source },
  }, event)

  return getAttendanceStatus(db, employee, org, settings, now)
})
