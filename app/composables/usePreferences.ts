/**
 * Preferencias de interfaz del usuario: colapso del sidebar e idioma.
 *
 * Se guardan en cookies para que sobrevivan a recargas y se exponen a través
 * de `useState` para que todos los componentes compartan el mismo estado
 * reactivo (cambiar el idioma en el menú de usuario actualiza la navegación
 * al instante, sin recargar).
 */
export type AppLocale = 'es' | 'en' | 'ca'

export const APP_LOCALES: ReadonlyArray<{ value: AppLocale; label: string }> = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'ca', label: 'Català' },
]

export function usePreferences() {
  const localeCookie = useCookie<AppLocale>('ui-locale', {
    default: () => 'es',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  const collapsedCookie = useCookie<boolean>('ui-sidebar-collapsed', {
    default: () => false,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })

  const locale = useState<AppLocale>('ui-locale-state', () => localeCookie.value ?? 'es')
  const sidebarCollapsed = useState<boolean>(
    'ui-sidebar-collapsed-state',
    () => collapsedCookie.value ?? false,
  )

  watch(locale, (value) => {
    localeCookie.value = value
  })
  watch(sidebarCollapsed, (value) => {
    collapsedCookie.value = value
  })

  function setLocale(value: AppLocale) {
    locale.value = value
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return { locale, sidebarCollapsed, setLocale, toggleSidebar }
}
