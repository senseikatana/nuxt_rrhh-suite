import { and, desc, eq } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/**
 * Nóminas.
 *
 * - `employee` obtiene solo las suyas (portal del empleado).
 * - `manager`/`admin` obtienen las de la organización, filtrables por periodo.
 */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)
  const query = getQuery(event)
  const periodId = typeof query.periodId === 'string' ? query.periodId : null

  const conditions = [eq(schema.payrollPeriods.orgId, org.id)]

  if (!isManagerOrAdmin(user.role)) {
    if (!employee) return []
    conditions.push(eq(schema.payslips.employeeId, employee.id))
  }
  if (periodId) conditions.push(eq(schema.payslips.periodId, periodId))

  const rows = await db
    .select({
      id: schema.payslips.id,
      periodId: schema.payslips.periodId,
      employeeId: schema.payslips.employeeId,
      gross: schema.payslips.gross,
      net: schema.payslips.net,
      filePath: schema.payslips.filePath,
      departmentId: schema.payslips.departmentId,
      year: schema.payrollPeriods.year,
      month: schema.payrollPeriods.month,
      periodStatus: schema.payrollPeriods.status,
      firstName: schema.employees.firstName,
      lastName: schema.employees.lastName,
      departmentName: schema.departments.name,
    })
    .from(schema.payslips)
    .innerJoin(schema.payrollPeriods, eq(schema.payslips.periodId, schema.payrollPeriods.id))
    .innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
    .leftJoin(schema.departments, eq(schema.payslips.departmentId, schema.departments.id))
    .where(and(...conditions))
    .orderBy(desc(schema.payrollPeriods.year), desc(schema.payrollPeriods.month))

  return rows.map((row) => ({
    ...row,
    employeeName: `${row.firstName} ${row.lastName}`,
  }))
})
