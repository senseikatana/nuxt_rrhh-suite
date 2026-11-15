/**
 * Cabeceras de seguridad, CSP completa y protección CSRF por Origin.
 *
 * - L-4: cabeceras fijas (X-Frame-Options, X-Content-Type-Options, nosniff,
 *   Referrer-Policy, HSTS) contra clickjacking, sniffing y MITM.
 * - CSP: todas las directivas necesarias para una app Nuxt (SSR + API).
 * - L-1: en mutaciones (todo menos GET/HEAD/OPTIONS) se compara el `Origin`
 *   (o `Referer`) contra el host propio. Es la segunda capa junto al `SameSite`
 *   de las cookies: si un browser laxo o un cambio en la config de cookies
 *   rompiera esa primera barrera, esta corta el request cross-site.
 *
 * Las cookies de better-auth se configuran con SameSite=Strict + Secure + httpOnly
 * en `server/utils/auth.ts` (`advanced.defaultCookieAttributes`). Este middleware
 * no toca la cabecera Set-Cookie para no romper la firma de las cookies de
 * better-auth; la capa de cookies es la responsable de SameSite/Secure.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// CSP completa para una aplicación Nuxt: SSR + API interna + assets locales.
// `upgrade-insecure-requests` fuerza https cuando la conexión llega por http.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

export default defineEventHandler((event) => {
  const headers: Record<string, string> = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': CSP,
  }

  // HSTS solo tiene sentido sobre HTTPS. En desarrollo local (http) se omite
  // para no romper el flujo de hot-reload.
  const isHttps =
    (getRequestHeader(event, 'x-forwarded-proto') || '').toLowerCase() === 'https' ||
    (event.node.req.socket as { encrypted?: boolean } | undefined)?.encrypted === true

  if (isHttps) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
  }

  setResponseHeaders(event, headers)

  const method = event.method.toUpperCase()
  if (SAFE_METHODS.has(method)) return

  // En same-origin puede no llegar Origin (peticiones de mismo origen a veces
  // solo mandan Referer). Se acepta cuando coincide con el host propio.
  const host = getRequestHeader(event, 'host')
  if (!host) return

  const origin = getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer')
  if (!origin) return

  let originHost: string | null
  try {
    originHost = new URL(origin).host
  } catch {
    originHost = null
  }

  if (originHost !== host) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request rejected' })
  }
})