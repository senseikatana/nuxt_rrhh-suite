import { desc, eq, inArray } from 'drizzle-orm'
import * as schema from '../../../database/schema'
import { getContext } from '../../../utils/hr'
import { isManagerOrAdmin } from '../../../utils/session'

/**
 * Periodos de nómina con su coste agregado.
 *
 * Los importes los ve cualquier usuario autenticado a nivel de periodo, pero el
 * detalle por empleado vive en `/api/payroll/payslips`, que sí filtra por rol.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  const periods = await db
    .select()
    .from(schema.payrollPeriods)
    .where(eq(schema.payrollPeriods.orgId, org.id))
    .orderBy(desc(schema.payrollPeriods.year), desc(schema.payrollPeriods.month))

  if (!periods.length) return []

  const slips = await db
    .select({
      periodId: schema.payslips.periodId,
      gross: schema.payslips.gross,
      net: schema.payslips.net,
      departmentId: schema.payslips.departmentId,
    })
    .from(schema.payslips)
    .where(inArray(schema.payslips.periodId, periods.map((period) => period.id)))

  const totals = new Map<string, { gross: number; net: number; count: number }>()
  for (const slip of slips) {
    const bucket = totals.get(slip.periodId) ?? { gross: 0, net: 0, count: 0 }
    bucket.gross += slip.gross
    bucket.net += slip.net
    bucket.count += 1
    totals.set(slip.periodId, bucket)
  }

  return periods.map((period) => ({
    ...period,
    employeeCount: totals.get(period.id)?.count ?? 0,
    totalGross: Math.round((totals.get(period.id)?.gross ?? 0) * 100) / 100,
    totalNet: Math.round((totals.get(period.id)?.net ?? 0) * 100) / 100,
    canManage: isManagerOrAdmin(user.role),
  }))
})
