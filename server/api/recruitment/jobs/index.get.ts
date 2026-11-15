import { desc, eq, inArray } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/** Ofertas de empleo con el número de candidaturas por etapa. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const jobs = await db
    .select({
      id: schema.jobPostings.id,
      title: schema.jobPostings.title,
      description: schema.jobPostings.description,
      departmentId: schema.jobPostings.departmentId,
      departmentName: schema.departments.name,
      status: schema.jobPostings.status,
      publishedAt: schema.jobPostings.publishedAt,
      closesAt: schema.jobPostings.closesAt,
    })
    .from(schema.jobPostings)
    .leftJoin(schema.departments, eq(schema.jobPostings.departmentId, schema.departments.id))
    .where(eq(schema.jobPostings.orgId, org.id))
    .orderBy(desc(schema.jobPostings.publishedAt))

  if (!jobs.length) return []

  const candidates = await db
    .select({
      jobPostingId: schema.candidates.jobPostingId,
      stage: schema.candidates.stage,
    })
    .from(schema.candidates)
    .where(inArray(schema.candidates.jobPostingId, jobs.map((job) => job.id)))

  const counts = new Map<string, Record<string, number>>()
  for (const candidate of candidates) {
    const bucket = counts.get(candidate.jobPostingId) ?? {}
    bucket[candidate.stage] = (bucket[candidate.stage] ?? 0) + 1
    counts.set(candidate.jobPostingId, bucket)
  }

  return jobs.map((job) => ({
    ...job,
    candidates: counts.get(job.id) ?? {},
    candidateCount: Object.values(counts.get(job.id) ?? {}).reduce((sum, value) => sum + value, 0),
  }))
})
