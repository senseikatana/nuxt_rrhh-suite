const PUBLIC_PATHS = new Set([
  '/signin',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
])

/** Rutas que deben seguir accesibles aunque haya sesión iniciada. */
const ALWAYS_ACCESSIBLE = new Set(['/reset-password', '/verify-email'])

/**
 * Rutas de acceso que se muestran también con sesión iniciada.
 *
 * Sin esto, un usuario con la cookie activa era redirigido de `/signin` al
 * panel y no podía volver a la pantalla de entrada para cambiar de cuenta:
 * la página "desaparecía". Ahora se renderiza con un aviso y un botón para
 * ir al panel o cerrar sesión.
 */
const ENTRY_PATHS = new Set(['/signin'])

export default defineNuxtRouteMiddleware(async (to) => {
  const { state, loaded, refresh } = useSession()

  if (!loaded.value) {
    await refresh()
  }

  if (PUBLIC_PATHS.has(to.path)) {
    if (state.value && !ALWAYS_ACCESSIBLE.has(to.path) && !ENTRY_PATHS.has(to.path)) {
      return navigateTo('/')
    }
    return
  }

  if (!state.value) {
    return navigateTo('/signin')
  }
})
