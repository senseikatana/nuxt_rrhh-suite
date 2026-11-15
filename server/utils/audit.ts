import type { Db } from '../database/client'
import type { H3Event } from 'h3'
import * as schema from '../database/schema'

export interface AuditInput {
  orgId?: string | null
  actorUserId?: string | null
  action: string
  entity: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  // Campos de contexto de seguridad para trazabilidad forense
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Registra un evento de auditoría en la base de datos.
 * Incluye IP y User-Agent cuando están disponibles para trazabilidad forense.
 */
export async function recordAudit(db: Db, input: AuditInput, event?: H3Event) {
  const ipAddress =
    input.ipAddress ??
    (event ? (getRequestIP(event, { xForwardedFor: true }) ?? null) : null)
  const userAgent =
    input.userAgent ?? (event ? (getRequestHeader(event, 'user-agent') ?? null) : null)

  await db.insert(schema.auditLog).values({
    id: crypto.randomUUID(),
    orgId: input.orgId ?? null,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : JSON.stringify(input.before),
    after: input.after === undefined ? null : JSON.stringify(input.after),
    ipAddress,
    userAgent,
    createdAt: new Date(),
  })
}
