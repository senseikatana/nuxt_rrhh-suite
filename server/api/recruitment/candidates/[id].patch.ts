import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const updateSchema = z.object({
  stage: z.enum(['new', 'screening', 'interview', 'offer', 'hired', 'rejected']).optional(),
  notes: z.string().max(2000).optional(),
})

/** Mueve una candidatura de etapa o actualiza sus notas. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const parsed = updateSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const [candidate] = await db
    .select({
      id: schema.candidates.id,
      stage: schema.candidates.stage,
      orgId: schema.jobPostings.orgId,
    })
    .from(schema.candidates)
    .innerJoin(schema.jobPostings, eq(schema.candidates.jobPostingId, schema.jobPostings.id))
    .where(and(eq(schema.candidates.id, id), eq(schema.jobPostings.orgId, org.id)))
    .limit(1)

  if (!candidate) throw createError({ statusCode: 404, statusMessage: 'Candidatura no encontrada' })

  const patch: Partial<typeof schema.candidates.$inferInsert> = {}
  if (parsed.data.stage !== undefined) patch.stage = parsed.data.stage
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes

  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, statusMessage: 'Nada que actualizar' })
  }

  await db.update(schema.candidates).set(patch).where(eq(schema.candidates.id, id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'recruitment.candidate.update',
      entity: 'candidate',
      entityId: id,
      before: { stage: candidate.stage },
      after: patch,
    },
    event,
  )

  return { id, ...patch }
})
