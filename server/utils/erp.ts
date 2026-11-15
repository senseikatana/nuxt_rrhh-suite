import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { Db } from '../database/client'
import * as schema from '../database/schema'
import { requireUser } from './session'

/**
 * Contexto ERP multi-tenant (migrado de `api/deps.py` + `models/user.py`).
 *
 * Un usuario puede operar en varias organizaciones mediante la tabla
 * `user_company_access`, cada concesión con un rol de aplicación
 * (admin/buyer/logistics/quality). Este rol es distinto del rol de Better Auth
 * (admin/manager/employee) y es el que gobierna los flujos de negocio.
 */

export type ErpRole = 'admin' | 'buyer' | 'logistics' | 'quality'

export interface ErpActor {
  id: string
  username: string
  role: ErpRole
}

/** Resuelve el rol ERP de un usuario dentro de una organización. */
export async function getErpRole(
  db: Db,
  userId: string,
  orgId: string,
): Promise<ErpRole | null> {
  const [grant] = await db
    .select()
    .from(schema.userCompanyAccess)
    .where(
      and(eq(schema.userCompanyAccess.userId, userId), eq(schema.userCompanyAccess.orgId, orgId)),
    )
    .limit(1)

  return (grant?.role as ErpRole) ?? null
}

/**
 * Construye el actor ERP para el usuario de la sesión en una organización.
 * Lanza 403 si el usuario no tiene concesión en esa organización.
 */
export async function getErpActor(db: Db, userId: string, orgId: string): Promise<ErpActor> {
  const [user] = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Usuario no encontrado' })
  }

  const role = await getErpRole(db, userId, orgId)
  if (!role) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Sin acceso a esta organización',
    })
  }

  return {
    id: user.id,
    // El histórico de actividad conserva el identificador estable del usuario.
    username: user.email ?? user.name ?? user.id,
    role,
  }
}

/**
 * Contexto completo de una petición ERP: actor, organización y base de datos.
 * La organización se resuelve por `?org=` o por la primera concesión del usuario.
 */
export async function getErpContext(event: H3Event) {
  const session = await requireUser(event)
  const db = useDb()

  const requestedOrgIdRaw = getQuery(event).org
  const requestedOrgId = typeof requestedOrgIdRaw === 'string' ? requestedOrgIdRaw.trim() : undefined

  let orgId = requestedOrgId || undefined
  if (!orgId) {
    const [grant] = await db
      .select()
      .from(schema.userCompanyAccess)
      .where(eq(schema.userCompanyAccess.userId, session.user.id))
      .limit(1)
    orgId = grant?.orgId
  }

  if (!orgId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'No hay ninguna organización asignada al usuario.',
    })
  }

  const actor = await getErpActor(db, session.user.id, orgId)
  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1)

  return { db, actor, org, orgId, user: session.user }
}

/**
 * Parámetros de query de los listados ERP.
 *
 * `getQuery` devuelve `string | string[] | undefined`; pasar `Number(...)` de
 * un valor no numérico produce `NaN` y Drizzle lo envía a `limit`, que Postgres
 * rechaza con un 500. Estos helpers convierten cualquier entrada inválida en el
 * valor por defecto y acotan el rango.
 */
export function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

export function stringQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}
