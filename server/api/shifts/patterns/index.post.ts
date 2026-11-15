import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)')

const createSchema = z.object({
  name: z.string().min(2, 'Ponle nombre al turno').max(40),
  startTime: time,
  endTime: time,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido').default('#6366f1'),
  departmentId: z.string().min(1).nullable().optional(),
})

/** Crea un patrón de turno. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const parsed = createSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const { name, startTime, endTime, color, departmentId } = parsed.data

  if (departmentId) {
    const [department] = await db
      .select()
      .from(schema.departments)
      .where(and(eq(schema.departments.id, departmentId), eq(schema.departments.orgId, org.id)))
      .limit(1)
    if (!department) {
      throw createError({ statusCode: 404, statusMessage: 'Departamento no encontrado' })
    }
  }

  const id = crypto.randomUUID()
  await db.insert(schema.shiftPatterns).values({
    id,
    orgId: org.id,
    name,
    startTime,
    endTime,
    color,
    departmentId: departmentId ?? null,
  })

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'shift.pattern.create',
      entity: 'shift_pattern',
      entityId: id,
      after: { name, startTime, endTime },
    },
    event,
  )

  return { id }
})
