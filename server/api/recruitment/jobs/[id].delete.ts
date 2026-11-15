import { and, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/** Elimina una oferta y, en cascada, sus candidaturas. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para borrar ofertas' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id' })

  const [job] = await db
    .select()
    .from(schema.jobPostings)
    .where(and(eq(schema.jobPostings.id, id), eq(schema.jobPostings.orgId, org.id)))
    .limit(1)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Oferta no encontrada' })

  await db.delete(schema.jobPostings).where(eq(schema.jobPostings.id, job.id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'recruitment.job.delete',
      entity: 'job_posting',
      entityId: job.id,
      before: { title: job.title, status: job.status },
    },
    event,
  )

  return { ok: true }
})
