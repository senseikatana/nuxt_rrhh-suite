import { z } from 'zod'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import { getContext } from '../../utils/hr'

const bodySchema = z.object({
  confirm: z.literal('PURGAR', { message: 'Escribe PURGAR para confirmar' }),
})

/**
 * Purga de datos de demostración antes de entregar el proyecto.
 *
 * Elimina todo el contenido operativo (plantilla, fichajes, vacaciones, gastos,
 * nóminas, reclutamiento, denuncias, contenido editable y ERP) para dejar la
 * instalación limpia. **Conserva** lo necesario para poder entrar y operar:
 * usuarios y sesiones, empresa, configuración, tipos de permiso, festivos y
 * concesiones de acceso ERP.
 *
 * Es irreversible: exige confirmar escribiendo PURGAR y queda auditado.
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)

  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Solo administración puede purgar datos' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Confirmación inválida: escribe PURGAR para ejecutar la purga',
    })
  }

  const counts: Record<string, number> = {}

  await db.transaction(async (tx) => {
    const removed = async (key: string, rows: { id: string }[]) => {
      counts[key] = rows.length
    }

    // Canal de denuncias (hijos primero).
    await removed(
      'whistleMessages',
      await tx.delete(schema.whistleMessages).returning({ id: schema.whistleMessages.id }),
    )
    await removed(
      'whistleReports',
      await tx.delete(schema.whistleReports).returning({ id: schema.whistleReports.id }),
    )

    // Reclutamiento.
    await removed(
      'candidates',
      await tx.delete(schema.candidates).returning({ id: schema.candidates.id }),
    )
    await removed(
      'jobPostings',
      await tx.delete(schema.jobPostings).returning({ id: schema.jobPostings.id }),
    )

    // Nóminas.
    await removed('payslips', await tx.delete(schema.payslips).returning({ id: schema.payslips.id }))
    await removed(
      'payrollPeriods',
      await tx.delete(schema.payrollPeriods).returning({ id: schema.payrollPeriods.id }),
    )

    // Gastos y su catálogo.
    await removed(
      'expenseLines',
      await tx.delete(schema.expenseLines).returning({ id: schema.expenseLines.id }),
    )
    await removed(
      'expenseReports',
      await tx.delete(schema.expenseReports).returning({ id: schema.expenseReports.id }),
    )
    await removed(
      'expenseCategories',
      await tx.delete(schema.expenseCategories).returning({ id: schema.expenseCategories.id }),
    )

    // Control horario y turnos.
    await removed(
      'clockEvents',
      await tx.delete(schema.clockEvents).returning({ id: schema.clockEvents.id }),
    )
    await removed(
      'shiftAssignments',
      await tx.delete(schema.shiftAssignments).returning({ id: schema.shiftAssignments.id }),
    )
    await removed(
      'shiftPatterns',
      await tx.delete(schema.shiftPatterns).returning({ id: schema.shiftPatterns.id }),
    )

    // Vacaciones.
    await removed(
      'overtimeLedger',
      await tx.delete(schema.overtimeLedger).returning({ id: schema.overtimeLedger.id }),
    )
    await removed(
      'leaveRequests',
      await tx.delete(schema.leaveRequests).returning({ id: schema.leaveRequests.id }),
    )
    await removed(
      'leaveEntitlements',
      await tx.delete(schema.leaveEntitlements).returning({ id: schema.leaveEntitlements.id }),
    )
    await removed(
      'approvalRules',
      await tx.delete(schema.approvalRules).returning({ id: schema.approvalRules.id }),
    )

    // Plantilla.
    await removed('contracts', await tx.delete(schema.contracts).returning({ id: schema.contracts.id }))
    await removed('employees', await tx.delete(schema.employees).returning({ id: schema.employees.id }))
    await removed(
      'departments',
      await tx.delete(schema.departments).returning({ id: schema.departments.id }),
    )

    // Contenido editable del sitio.
    await removed(
      'contentBlocks',
      await tx.delete(schema.contentBlocks).returning({ id: schema.contentBlocks.id }),
    )

    // Correo pendiente y auditoría previa.
    await removed(
      'notifications',
      await tx.delete(schema.notifications).returning({ id: schema.notifications.id }),
    )
    await removed('auditLog', await tx.delete(schema.auditLog).returning({ id: schema.auditLog.id }))

    // ERP: líneas antes que pedidos y artículos.
    await removed(
      'erpSalesOrderLines',
      await tx.delete(schema.erpSalesOrderLines).returning({ id: schema.erpSalesOrderLines.id }),
    )
    await removed(
      'erpSalesOrders',
      await tx.delete(schema.erpSalesOrders).returning({ id: schema.erpSalesOrders.id }),
    )
    await removed(
      'erpPurchaseOrderLines',
      await tx.delete(schema.erpPurchaseOrderLines).returning({ id: schema.erpPurchaseOrderLines.id }),
    )
    await removed(
      'erpPurchaseOrders',
      await tx.delete(schema.erpPurchaseOrders).returning({ id: schema.erpPurchaseOrders.id }),
    )
    await removed(
      'erpDemandLines',
      await tx.delete(schema.erpDemandLines).returning({ id: schema.erpDemandLines.id }),
    )
    await removed('erpRoutes', await tx.delete(schema.erpRoutes).returning({ id: schema.erpRoutes.id }))
    await removed(
      'erpActivityEvents',
      await tx.delete(schema.erpActivityEvents).returning({ id: schema.erpActivityEvents.id }),
    )
    await removed('erpItems', await tx.delete(schema.erpItems).returning({ id: schema.erpItems.id }))
    await removed(
      'erpCustomers',
      await tx.delete(schema.erpCustomers).returning({ id: schema.erpCustomers.id }),
    )
    await removed(
      'erpVendors',
      await tx.delete(schema.erpVendors).returning({ id: schema.erpVendors.id }),
    )
  })

  // La propia purga deja rastro (después de vaciar la auditoría).
  await recordAudit(
    db,
    {
      orgId: org.id,
      actorUserId: user.id,
      action: 'admin.purge_demo_data',
      entity: 'organization',
      entityId: org.id,
      after: counts,
    },
    event,
  )

  return { ok: true, counts }
})
