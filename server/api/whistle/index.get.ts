import { desc, eq } from 'drizzle-orm'
import * as schema from '../../database/schema'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

/** Bandeja de denuncias (solo mandos y administración). */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  const reports = await db
    .select()
    .from(schema.whistleReports)
    .where(eq(schema.whistleReports.orgId, org.id))
    .orderBy(desc(schema.whistleReports.createdAt))

  return reports
})
