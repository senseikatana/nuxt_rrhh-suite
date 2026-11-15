import { and, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/** Elimina una candidatura. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para borrar candidaturas' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [candidate] = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      email: schema.candidates.email,
      stage: schema.candidates.stage,
    })
    .from(schema.candidates)
    .innerJoin(schema.jobPostings, eq(schema.candidates.jobPostingId, schema.jobPostings.id))
    .where(and(eq(schema.candidates.id, id), eq(schema.jobPostings.orgId, org.id)))
    .limit(1)
  if (!candidate) throw createError({ statusCode: 404, statusMessage: 'Candidatura no encontrada' })

  await db.delete(schema.candidates).where(eq(schema.candidates.id, candidate.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'recruitment.candidate.delete',
      entity: 'candidate',
      entityId: candidate.id,
      before: { name: candidate.name, email: candidate.email, stage: candidate.stage },
    },
    event,
  )

  return { ok: true }
})
