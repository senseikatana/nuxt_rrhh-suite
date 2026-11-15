/**
 * Inyecta el nonce CSP en todos los <script> inline del HTML renderizado.
 *
 * El middleware `server/middleware/security.ts` genera un nonce por request,
 * lo publica en `event.context.nonce` y lo declara en la cabecera
 * `Content-Security-Policy`. Este plugin lo aplica al HTML final.
 *
 * Sin esto quedan sin firmar el bootstrap de Nuxt (`window.__NUXT__`), el
 * script anti-FOUC de color-mode y el de devtools; el navegador los bloquea,
 * la app no hidrata y ningún botón responde.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = (event.context as { nonce?: string }).nonce
    if (!nonce) return

    // Solo scripts inline: los que tienen `src` los cubre `'self'`.
    const addNonce = (tag: string) =>
      tag.replace(
        /<script(?![^>]*\bnonce=)(?![^>]*\bsrc=)([^>]*)>/gi,
        `<script nonce="${nonce}"$1>`,
      )

    for (const key of ['head', 'bodyPrepend', 'body', 'bodyAppend'] as const) {
      html[key] = html[key].map(addNonce)
    }
  })
})
