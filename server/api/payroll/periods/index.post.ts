import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as schema from '../../../database/schema'
import { recordAudit } from '../../../utils/audit'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

const createSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

/** Abre un periodo de nómina. Solo administración. */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Solo administración abre periodos' })
  }

  const parsed = createSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((issue) => issue.message).join('. '),
    })
  }

  const { year, month } = parsed.data

  const [existing] = await db
    .select()
    .from(schema.payrollPeriods)
    .where(
      and(
        eq(schema.payrollPeriods.orgId, org.id),
        eq(schema.payrollPeriods.year, year),
        eq(schema.payrollPeriods.month, month),
      ),
    )
    .limit(1)

  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'Ese periodo ya existe' })
  }

  const id = crypto.randomUUID()
  await db.insert(schema.payrollPeriods).values({
    id,
    orgId: org.id,
    year,
    month,
    status: 'open',
  })

  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'payroll.period.create',
      entity: 'payroll_period',
      entityId: id,
      after: { year, month, status: 'open' },
    },
    event,
  )

  return { id, year, month, status: 'open' as const }
})
