import { and, desc, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/** Candidaturas de una oferta (o de todas si no se filtra). */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const query = getQuery(event)
  const jobPostingId = typeof query.jobPostingId === 'string' ? query.jobPostingId : null

  // Solo se devuelven candidaturas cuyas ofertas pertenecen a la organización.
  const conditions = [eq(schema.jobPostings.orgId, org.id)]
  if (jobPostingId) conditions.push(eq(schema.candidates.jobPostingId, jobPostingId))

  const rows = await db
    .select({
      id: schema.candidates.id,
      jobPostingId: schema.candidates.jobPostingId,
      jobTitle: schema.jobPostings.title,
      name: schema.candidates.name,
      email: schema.candidates.email,
      phone: schema.candidates.phone,
      cvPath: schema.candidates.cvPath,
      stage: schema.candidates.stage,
      notes: schema.candidates.notes,
      createdAt: schema.candidates.createdAt,
    })
    .from(schema.candidates)
    .innerJoin(schema.jobPostings, eq(schema.candidates.jobPostingId, schema.jobPostings.id))
    .where(and(...conditions))
    .orderBy(desc(schema.candidates.createdAt))

  return rows
})
