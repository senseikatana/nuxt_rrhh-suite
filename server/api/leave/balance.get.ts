import { and, eq } from 'drizzle-orm'
import * as schema from '../../database/schema'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'
import {
  getBalanceForType,
  getOvertimeSummary,
  type BalanceForTypeResult,
} from '../../utils/leave'

export default defineEventHandler(async (event) => {
  const { db, user, employee, org, settings } = await getContext(event)
  const query = getQuery(event)

  const year = Number(query.year ?? new Date().getFullYear())
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createError({ statusCode: 400, statusMessage: 'Año inválido' })
  }
  const targetId = typeof query.employeeId === 'string' ? query.employeeId : null

  if (targetId && targetId !== employee?.id && !isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos para consultar otro empleado' })
  }

  const typesPromise = db
    .select()
    .from(schema.leaveTypes)
    .where(and(eq(schema.leaveTypes.orgId, org.id), eq(schema.leaveTypes.active, true)))

  let target = employee
  if (targetId) {
    const [row] = await db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.id, targetId), eq(schema.employees.orgId, org.id)))
      .limit(1)

    if (!row) {
      throw createError({ statusCode: 404, statusMessage: 'Empleado no encontrado' })
    }
    target = row
  }

  const types = await typesPromise

  // Usuarios sin ficha de empleado (por ejemplo, un registro recién creado):
  // se devuelve un saldo vacío en lugar de romper el panel.
  if (!target) {
    return {
      year,
      employee: null,
      balances: [],
      overtime: null,
      types,
    }
  }

  // Cada tipo de permiso y la bolsa de horas se calculan en paralelo: antes se
  // encadenaban y el panel tardaba ~300 ms solo en este endpoint.
  const [balanceResults, overtime] = await Promise.all([
    Promise.all(
      types.map((type) =>
        getBalanceForType(db, {
          employee: target,
          orgId: org.id,
          leaveType: type,
          year,
          settings,
        }),
      ),
    ),
    getOvertimeSummary(db, target.id, settings),
  ])

  const balances = balanceResults.filter(
    (balance): balance is BalanceForTypeResult => Boolean(balance),
  )

  return {
    year,
    employee: {
      id: target.id,
      firstName: target.firstName,
      lastName: target.lastName,
      departmentId: target.departmentId,
      startDate: target.startDate,
    },
    balances,
    overtime,
    types,
  }
})
