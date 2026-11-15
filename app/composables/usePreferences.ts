/**
 * Preferencias de interfaz que no dependen del idioma.
 *
 * El idioma lo gestiona `@nuxtjs/i18n` a través de la ruta (/es, /en, /ca),
 * así que aquí solo queda el colapso del sidebar, que se guarda en cookie para
 * sobrevivir a recargas y se comparte con `useState`.
 */
export function usePreferences() {
  const collapsedCookie = useCookie<boolean>('ui-sidebar-collapsed', {
    default: () => false,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })

  const sidebarCollapsed = useState<boolean>(
    'ui-sidebar-collapsed-state',
    () => collapsedCookie.value ?? false,
  )

  watch(sidebarCollapsed, (value) => {
    collapsedCookie.value = value
  })

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return { sidebarCollapsed, toggleSidebar }
}
