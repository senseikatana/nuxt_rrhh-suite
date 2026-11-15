import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const createSchema = z.object({
  title: z.string().min(3, 'El título es obligatorio').max(120),
  description: z.string().min(10, 'Describe la oferta').max(5000),
  departmentId: z.string().min(1).nullable().optional(),
  closesAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de cierre inválida')
    .nullable()
    .optional(),
  publish: z.boolean().default(false),
})

/** Crea una oferta de empleo (borrador o publicada). */
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

  const { title, description, departmentId, closesAt, publish } = parsed.data

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
  const now = new Date()

  await db.insert(schema.jobPostings).values({
    id,
    orgId: org.id,
    title,
    description,
    departmentId: departmentId ?? null,
    status: publish ? 'published' : 'draft',
    publishedAt: publish ? now : null,
    closesAt: closesAt ?? null,
  })

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'recruitment.job.create',
      entity: 'job_posting',
      entityId: id,
      after: { title, status: publish ? 'published' : 'draft' },
    },
    event,
  )

  return { id, status: publish ? 'published' : 'draft' }
})
