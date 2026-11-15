import { eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getContext } from '../../../utils/hr'

/** Patrones de turno de la organización (mañana, tarde, noche…). */
export default defineEventHandler(async (event) => {
  const { db, org } = await getContext(event)

  return db
    .select({
      id: schema.shiftPatterns.id,
      name: schema.shiftPatterns.name,
      startTime: schema.shiftPatterns.startTime,
      endTime: schema.shiftPatterns.endTime,
      color: schema.shiftPatterns.color,
      departmentId: schema.shiftPatterns.departmentId,
      departmentName: schema.departments.name,
    })
    .from(schema.shiftPatterns)
    .leftJoin(schema.departments, eq(schema.shiftPatterns.departmentId, schema.departments.id))
    .where(eq(schema.shiftPatterns.orgId, org.id))
})
