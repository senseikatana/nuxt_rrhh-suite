import { and, desc, eq, inArray } from 'drizzle-orm'
import * as schema from '../../database/schema'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

/**
 * Listado de notas de gasto.
 *
 * - `employee` ve solo las suyas.
 * - `manager`/`admin` ven todas las de la organización.
 * Incluye las líneas para no tener que pedirlas en una segunda llamada.
 */
export default defineEventHandler(async (event) => {
  const { db, user, employee, org } = await getContext(event)

  const reports = await db
    .select({
      id: schema.expenseReports.id,
      employeeId: schema.expenseReports.employeeId,
      status: schema.expenseReports.status,
      total: schema.expenseReports.total,
      notes: schema.expenseReports.notes,
      submittedAt: schema.expenseReports.submittedAt,
      approvedAt: schema.expenseReports.approvedAt,
      createdAt: schema.expenseReports.createdAt,
      firstName: schema.employees.firstName,
      lastName: schema.employees.lastName,
      departmentName: schema.departments.name,
    })
    .from(schema.expenseReports)
    .innerJoin(schema.employees, eq(schema.expenseReports.employeeId, schema.employees.id))
    .leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
    .where(
      isManagerOrAdmin(user.role)
        ? eq(schema.expenseReports.orgId, org.id)
        : and(
            eq(schema.expenseReports.orgId, org.id),
            employee ? eq(schema.expenseReports.employeeId, employee.id) : eq(schema.expenseReports.employeeId, '__none__'),
          ),
    )
    .orderBy(desc(schema.expenseReports.createdAt))

  if (!reports.length) return []

  const lines = await db
    .select()
    .from(schema.expenseLines)
    .where(inArray(schema.expenseLines.reportId, reports.map((report) => report.id)))

  const byReport = new Map<string, typeof lines>()
  for (const line of lines) {
    const bucket = byReport.get(line.reportId) ?? []
    bucket.push(line)
    byReport.set(line.reportId, bucket)
  }

  return reports.map((report) => ({
    ...report,
    employeeName: `${report.firstName} ${report.lastName}`,
    lines: byReport.get(report.id) ?? [],
  }))
})
