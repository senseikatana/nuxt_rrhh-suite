/**
 * Orígenes de confianza compartidos por Better Auth y el middleware CSRF.
 *
 * El error "Invalid origin" aparece cuando la app se abre desde un origen que
 * no coincide con `BETTER_AUTH_URL` (por ejemplo 127.0.0.1 en vez de localhost,
 * una IP de la red local o un túnel de desarrollo). Centralizar la lista evita
 * que las dos capas (middleware propio y better-auth) se desincronicen.
 */

function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production'
}

/** Orígenes configurados explícitamente. */
export function configuredOrigins(): string[] {
  const config = useRuntimeConfig()
  const origins = [normalize(config.betterAuthUrl)]

  for (const entry of (process.env.BETTER_AUTH_TRUSTED_ORIGINS || '').split(',')) {
    const origin = normalize(entry)
    if (origin) origins.push(origin)
  }

  if (isDevelopment()) {
    // La misma app puede abrirse como localhost, 127.0.0.1 o [::1] en el
    // mismo puerto. Sin esto, entrar por 127.0.0.1 rompe el alta de cuentas.
    let port = '3000'
    try {
      port = new URL(config.betterAuthUrl).port || '3000'
    } catch {
      // BETTER_AUTH_URL inválida: se usa el puerto por defecto de Nuxt.
    }
    origins.push(
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://[::1]:${port}`,
    )
  }

  return [...new Set(origins)]
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** ¿Es un origen local o de red privada? Solo se usa en desarrollo. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname
    if (LOCAL_HOSTS.has(host)) return true
    return (
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
  } catch {
    return false
  }
}

/** ¿El origen está en la lista configurada (o es local en desarrollo)? */
export function isTrustedOrigin(origin: string): boolean {
  const normalized = normalize(origin)
  if (configuredOrigins().includes(normalized)) return true
  return isDevelopment() && isLocalOrigin(normalized)
}
