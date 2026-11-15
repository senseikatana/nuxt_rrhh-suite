import type { H3Event } from 'h3'

export type Role = 'admin' | 'manager' | 'employee'

export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerified?: boolean
  role: Role
}

/**
 * Devuelve la sesión activa o lanza 401.
 * Se usa en cada endpoint protegido.
 */
export async function requireUser(event: H3Event) {
  const auth = useAuth()
  const headers = new Headers()

  for (const [key, value] of Object.entries(getRequestHeaders(event))) {
    if (value) headers.set(key, value)
  }

  const session = await auth.api.getSession({ headers })

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Sesión inválida o expirada. Inicia sesión nuevamente.',
      data: { code: 'AUTH_SESSION_MISSING' },
    })
  }

  // Validación defensiva: el usuario de la sesión debe tener un rol reconocido.
  // Si better-auth devolviera un rol inesperado, caemos a 'employee' en vez de
  // pasar un valor no tipado que podría romper las autorizaciones por rol.
  const raw = session.user as {
    id: string
    name: string
    email: string
    emailVerified?: boolean
    role?: string
  }
  const role: Role =
    raw.role === 'admin' || raw.role === 'manager' ? (raw.role as Role) : 'employee'

  return {
    user: {
      id: raw.id,
      name: raw.name,
      email: raw.email,
      emailVerified: Boolean(raw.emailVerified),
      role,
    },
    session: { id: session.session.id, userId: session.session.userId },
  }
}

export async function requireRole(event: H3Event, roles: Role[]) {
  const session = await requireUser(event)
  if (!roles.includes(session.user.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Acceso denegado. Se requiere uno de estos roles: ${roles.join(', ')}.`,
      data: { code: 'AUTH_INSUFFICIENT_ROLE', required: roles, actual: session.user.role },
    })
  }
  return session
}

export function isManagerOrAdmin(role: Role) {
  return role === 'admin' || role === 'manager'
}
