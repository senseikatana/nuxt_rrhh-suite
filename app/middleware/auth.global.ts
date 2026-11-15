/**
 * Control de acceso global, consciente del idioma.
 *
 * Con `prefix_except_default` las rutas de los idiomas no por defecto llevan
 * prefijo (/en/payroll). Los nombres de ruta que genera @nuxtjs/i18n pueden
 * llevar sufijo de idioma (`signin___en`), así que se normalizan antes de
 * comparar; si no, `/signin` no se reconoce como pública y el redirect entra
 * en bucle.
 */
const PUBLIC_ROUTES = new Set([
  'signin',
  'signup',
  'forgot-password',
  'reset-password',
  'verify-email',
])

/** Rutas que deben seguir accesibles aunque haya sesión iniciada. */
const ALWAYS_ACCESSIBLE = new Set(['reset-password', 'verify-email'])

/**
 * Rutas de acceso que se muestran también con sesión iniciada: sin esto, un
 * usuario con cookie activa no podía volver a la pantalla de entrada.
 */
const ENTRY_ROUTES = new Set(['signin'])

/** Gestión de personas: administración y mandos. */
const MANAGER_ROUTES = new Set([
  'empleados',
  'vacaciones-aprobaciones',
  'reclutamiento',
  'asistente',
])

/** Configuración de la empresa: solo administración. */
const ADMIN_ROUTES = new Set(['ajustes'])

function baseName(name: unknown): string {
  if (typeof name !== 'string') return ''
  const index = name.indexOf('___')
  return index >= 0 ? name.slice(0, index) : name
}

export default defineNuxtRouteMiddleware(async (to) => {
  const { state, loaded, refresh } = useSession()

  if (!loaded.value) {
    await refresh()
  }

  const name = baseName(to.name)
  const localePath = useLocalePath()

  // Ruta desconocida (404): dejar pasar para no provocar redirecciones en bucle.
  if (!name) return

  if (PUBLIC_ROUTES.has(name)) {
    if (state.value && !ALWAYS_ACCESSIBLE.has(name) && !ENTRY_ROUTES.has(name)) {
      const target = localePath('/')
      if (target === to.fullPath) return
      return navigateTo(target)
    }
    return
  }

  if (!state.value) {
    const target = localePath('/signin')
    // Salvaguarda: nunca redirigir a la misma ruta.
    if (target === to.fullPath) return
    return navigateTo(target)
  }

  // Defensa en profundidad: ocultar el enlace no basta; si alguien escribe la
  // URL a mano tampoco debe entrar en secciones que no le corresponden.
  const role = state.value?.user.role
  const home = localePath('/')
  const denied =
    (ADMIN_ROUTES.has(name) && role !== 'admin') ||
    (MANAGER_ROUTES.has(name) && role === 'employee')

  if (denied) {
    if (home === to.fullPath) return
    return navigateTo(home, { replace: true })
  }
})
