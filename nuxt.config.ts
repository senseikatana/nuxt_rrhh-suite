export default defineNuxtConfig({
  compatibilityDate: '2026-11-08',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxtjs/i18n'],

  /**
   * Internacionalización con rutas por idioma.
   *
   * `strategy: 'prefix'` genera /es/…, /en/… y /ca/…, y `customRoutes: 'config'`
   * traduce también los segmentos de ruta: /es/nominas, /en/payroll,
   * /ca/nomines. Las rutas son la fuente de verdad del idioma activo, así que
   * un enlace compartido siempre abre en el idioma correcto.
   */
  i18n: {
    defaultLocale: 'es',
    // Español sin prefijo (/nominas) y los demás idiomas con prefijo
    // (/en/payroll, /ca/nomines). Así las URLs existentes siguen funcionando.
    strategy: 'prefix_except_default',
    langDir: 'locales',
    detectBrowserLanguage: false,
    locales: [
      { code: 'es', language: 'es-ES', name: 'Español', file: 'es.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'ca', language: 'ca-ES', name: 'Català', file: 'ca.json' },
    ],
    customRoutes: 'config',
    pages: {
      index: { es: '/', en: '/', ca: '/' },
      herramientas: { es: '/herramientas', en: '/tools', ca: '/eines' },
      vacaciones: { es: '/vacaciones', en: '/time-off', ca: '/vacances' },
      'vacaciones-calendario': {
        es: '/vacaciones/calendario',
        en: '/time-off/calendar',
        ca: '/vacances/calendari',
      },
      'vacaciones-aprobaciones': {
        es: '/vacaciones/aprobaciones',
        en: '/time-off/approvals',
        ca: '/vacances/aprovacions',
      },
      empleados: { es: '/empleados', en: '/people', ca: '/empleats' },
      fichaje: { es: '/fichaje', en: '/clock', ca: '/fitxatge' },
      turnos: { es: '/turnos', en: '/shifts', ca: '/torns' },
      gastos: { es: '/gastos', en: '/expenses', ca: '/despeses' },
      nominas: { es: '/nominas', en: '/payroll', ca: '/nomines' },
      reclutamiento: { es: '/reclutamiento', en: '/recruitment', ca: '/reclutament' },
      denuncias: { es: '/denuncias', en: '/complaints', ca: '/denuncies' },
      asistente: { es: '/asistente', en: '/assistant', ca: '/assistent' },
      ajustes: { es: '/ajustes', en: '/settings', ca: '/ajustos' },
      cuenta: { es: '/cuenta', en: '/account', ca: '/compte' },
      erp: { es: '/erp', en: '/erp', ca: '/erp' },
      'erp-sales': { es: '/erp/ventas', en: '/erp/sales', ca: '/erp/vendes' },
      'erp-purchases': { es: '/erp/compras', en: '/erp/purchases', ca: '/erp/compres' },
      'erp-warehouse': { es: '/erp/almacen', en: '/erp/warehouse', ca: '/erp/magatzem' },
      'erp-demand': { es: '/erp/demanda', en: '/erp/demand', ca: '/erp/demanda' },
      'erp-routes': { es: '/erp/rutas', en: '/erp/routes', ca: '/erp/rutes' },
      'erp-activity': { es: '/erp/actividad', en: '/erp/activity', ca: '/erp/activitat' },
      // Rutas de autenticación sin traducir: /signin, /signup, /forgot-password,
      // /reset-password y /verify-email existen igual en los tres idiomas.
      // Traducirlas rompía el redirect del middleware (ruta inexistente → bucle).
    },
  },

  css: ['~/assets/css/main.css'],

  ui: {
    colorMode: true,
  },

  // Iconos 100% locales.
  //
  // Por defecto @nuxt/icon resuelve los iconos que no encuentra en el bundle
  // contra `api.iconify.design`. Eso rompe con la CSP (`connect-src 'self'`)
  // y deja huecos donde debería haber icono. Con `serverBundle: 'local'` y
  // `fallbackToApi: false` todo se sirve desde `@iconify-json/lucide`, que ya
  // está instalado.
  icon: {
    serverBundle: 'local',
    clientBundle: { scan: true, sizeLimitKb: 512 },
    fallbackToApi: false,
  },

  // Tema por defecto claro; el usuario puede cambiarlo desde el menú de usuario.
  // classSuffix vacío => la clase aplicada es `.dark` (coincide con main.css).
  colorMode: {
    preference: 'light',
    fallback: 'light',
    classSuffix: '',
  },

  runtimeConfig: {
    // Nunca fallback a un secreto conocido: si falta en producción, fallar en
    // alto en vez de firmar cookies con un secreto público del repo.
    betterAuthSecret: (() => {
      const secret = process.env.BETTER_AUTH_SECRET
      if (secret) return secret
      if (process.env.NODE_ENV === 'production') {
        throw new Error('BETTER_AUTH_SECRET is required in production')
      }
      // Secreto efímero solo para desarrollo.
      return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    })(),
    betterAuthUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || 'RRHH Suite <rrhh@localhost>',
      secure: process.env.SMTP_SECURE === 'true',
    },
    public: {
      appName: 'RRHH Suite',
      requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
    },
  },

  typescript: {
    strict: true,
  },

  app: {
    head: {
      title: 'RRHH Suite',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#0f172a' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
      ],
    },
  },
})
