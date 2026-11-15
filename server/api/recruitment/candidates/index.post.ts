import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const createSchema = z.object({
  jobPostingId: z.string().min(1),
  name: z.string().min(2).max(120),
  email: z.string().email('Email inválido'),
  phone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
  cvPath: z.string().max(500).optional(),
})

/** Registra una candidatura en una oferta de la organización. */
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

  const { jobPostingId, name, email, phone, notes, cvPath } = parsed.data

  const [job] = await db
    .select()
    .from(schema.jobPostings)
    .where(and(eq(schema.jobPostings.id, jobPostingId), eq(schema.jobPostings.orgId, org.id)))
    .limit(1)

  if (!job) throw createError({ statusCode: 404, statusMessage: 'Oferta no encontrada' })
  if (job.status === 'closed') {
    throw createError({ statusCode: 409, statusMessage: 'La oferta está cerrada' })
  }

  const id = crypto.randomUUID()
  await db.insert(schema.candidates).values({
    id,
    jobPostingId,
    name,
    email,
    phone: phone ?? null,
    cvPath: cvPath ?? null,
    stage: 'new',
    notes: notes ?? null,
    createdAt: new Date(),
  })

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'recruitment.candidate.create',
      entity: 'candidate',
      entityId: id,
      after: { jobPostingId, name, email },
    },
    event,
  )

  return { id, stage: 'new' as const }
})
