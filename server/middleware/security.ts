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

import { isTrustedOrigin } from '../utils/allowed-origins'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Parsea un Origin/Referer; `null` si no es una URL válida. */
function parseOrigin(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * Nonce CSP por request.
 *
 * Nuxt necesita ejecutar scripts inline para hidratar (el bootstrap con el
 * payload `window.__NUXT__`, el script anti-FOUC de color-mode y, en dev, el
 * de devtools). Con `script-src 'self'` esos scripts se bloquean, el cliente
 * nunca monta y **ningún botón de la app responde**.
 *
 * En vez de abrir `'unsafe-inline'` (que anula la protección XSS de
 * `script-src`), se genera un nonce por request y se inyecta en cada script
 * inline desde el hook `render:html` de Nitro (ver nuxt.config.ts).
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// CSP completa para una aplicación Nuxt: SSR + API interna + assets locales.
// Los scripts inline deben llevar el nonce del request; los assets propios
// (`/_nuxt/…`) quedan cubiertos por `'self'`.
const buildCsp = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

export default defineEventHandler((event) => {
  const nonce = generateNonce()
  // Se expone al renderizador para firmar los scripts inline (hook render:html).
  event.context.nonce = nonce

  const headers: Record<string, string> = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': buildCsp(nonce),
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
  // solo mandan Referer). Se acepta cuando coincide con el host propio o con
  // el host reenviado por un proxy/túnel.
  const host = getRequestHeader(event, 'host')
  const forwardedHost = getRequestHeader(event, 'x-forwarded-host')
  const origin = getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer')
  if (!origin) return

  const originUrl = parseOrigin(origin)
  const sameHost =
    originUrl !== null &&
    (originUrl.host === host || (forwardedHost ? originUrl.host === forwardedHost : false))

  if (!sameHost && !(originUrl && isTrustedOrigin(originUrl.origin))) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request rejected' })
  }
})