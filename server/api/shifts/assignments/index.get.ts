import { and, between, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/**
 * Asignaciones de turno en un rango de fechas.
 * Un mando ve todo el equipo; un empleado ve solo lo suyo.
 */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)
  const query = getQuery(event)
  const from = typeof query.from === 'string' ? query.from : null
  const to = typeof query.to === 'string' ? query.to : null

  const conditions = [eq(schema.shiftAssignments.orgId, org.id)]
  if (from && to) conditions.push(between(schema.shiftAssignments.date, from, to))
  if (!isManagerOrAdmin(user.role)) {
    if (!employee) return []
    conditions.push(eq(schema.shiftAssignments.employeeId, employee.id))
  }

  return db
    .select({
      id: schema.shiftAssignments.id,
      employeeId: schema.shiftAssignments.employeeId,
      date: schema.shiftAssignments.date,
      patternId: schema.shiftAssignments.patternId,
      startTime: schema.shiftAssignments.startTime,
      endTime: schema.shiftAssignments.endTime,
      notes: schema.shiftAssignments.notes,
      patternName: schema.shiftPatterns.name,
      patternColor: schema.shiftPatterns.color,
      firstName: schema.employees.firstName,
      lastName: schema.employees.lastName,
    })
    .from(schema.shiftAssignments)
    .leftJoin(schema.shiftPatterns, eq(schema.shiftAssignments.patternId, schema.shiftPatterns.id))
    .innerJoin(schema.employees, eq(schema.shiftAssignments.employeeId, schema.employees.id))
    .where(and(...conditions))
})
