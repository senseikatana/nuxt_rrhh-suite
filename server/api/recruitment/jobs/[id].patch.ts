import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const updateSchema = z.object({
  status: z.enum(['draft', 'published', 'closed']).optional(),
  title: z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(5000).optional(),
})

/** Cambia el estado o el contenido de una oferta. */
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

  const [job] = await db
    .select()
    .from(schema.jobPostings)
    .where(and(eq(schema.jobPostings.id, id), eq(schema.jobPostings.orgId, org.id)))
    .limit(1)

  if (!job) throw createError({ statusCode: 404, statusMessage: 'Oferta no encontrada' })

  const patch: Partial<typeof schema.jobPostings.$inferInsert> = {}
  if (parsed.data.title !== undefined) patch.title = parsed.data.title
  if (parsed.data.description !== undefined) patch.description = parsed.data.description
  if (parsed.data.status !== undefined) {
    patch.status = parsed.data.status
    if (parsed.data.status === 'published' && !job.publishedAt) patch.publishedAt = new Date()
  }

  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, statusMessage: 'Nada que actualizar' })
  }

  await db.update(schema.jobPostings).set(patch).where(eq(schema.jobPostings.id, id))

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'recruitment.job.update',
      entity: 'job_posting',
      entityId: id,
      before: { status: job.status },
      after: patch,
    },
    event,
  )

  return { id, ...patch }
})
