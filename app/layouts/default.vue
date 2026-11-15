<script setup lang="ts">
import type { NavSection } from '~/types/nav'

const { state, isAdmin, isManager, displayName } = useSession()
const erpSession = useErpSession()
const { t } = useI18n()
const localePath = useLocalePath()
const { sidebarCollapsed, toggleSidebar } = usePreferences()
const { refresh: refreshAiStatus } = useAiStatus()
const route = useRoute()

/** Iconos por módulo ERP, para la sección del sidebar. */
const ERP_NAV_ICONS: Record<string, string> = {
  sales: 'i-lucide-shopping-cart',
  purchases: 'i-lucide-shopping-bag',
  warehouse: 'i-lucide-warehouse',
  demand: 'i-lucide-line-chart',
  routes: 'i-lucide-truck',
  activity: 'i-lucide-activity',
}

const mobileOpen = ref(false)
const pendingCount = ref(0)

const sections = computed<NavSection[]>(() => [
  {
    title: t('nav.secPrincipal'),
    items: [
      { label: t('nav.dashboard'), to: localePath('/'), icon: 'i-lucide-layout-dashboard' },
      { label: t('nav.herramientas'), to: localePath('/herramientas'), icon: 'i-lucide-layout-grid' },
      { label: t('nav.vacaciones'), to: localePath('/vacaciones'), icon: 'i-lucide-palmtree' },
      { label: t('nav.calendario'), to: localePath('/vacaciones/calendario'), icon: 'i-lucide-calendar-days' },
      ...(isManager.value
        ? [
            {
              label: t('nav.aprobaciones'),
              to: localePath('/vacaciones/aprobaciones'),
              icon: 'i-lucide-check-check',
              badge: pendingCount.value,
            },
          ]
        : []),
    ],
  },
  {
    title: t('nav.secPersonal'),
    items: [
      ...(isManager.value
        ? [{ label: t('nav.empleados'), to: localePath('/empleados'), icon: 'i-lucide-users' }]
        : []),
      { label: t('nav.fichaje'), to: localePath('/fichaje'), icon: 'i-lucide-clock' },
      { label: t('nav.turnos'), to: localePath('/turnos'), icon: 'i-lucide-calendar-range' },
    ],
  },
  {
    title: t('nav.secGestion'),
    items: [
      // Autoservicio: cualquier persona ve lo suyo.
      { label: t('nav.gastos'), to: localePath('/gastos'), icon: 'i-lucide-receipt' },
      { label: t('nav.nominas'), to: localePath('/nominas'), icon: 'i-lucide-banknote' },
      { label: t('nav.denuncias'), to: localePath('/denuncias'), icon: 'i-lucide-shield-check' },
      // Gestión de personas: solo mandos y administración.
      ...(isManager.value
        ? [
            {
              label: t('nav.reclutamiento'),
              to: localePath('/reclutamiento'),
              icon: 'i-lucide-user-plus',
            },
            {
              label: t('nav.asistente'),
              to: localePath('/asistente'),
              icon: 'i-lucide-sparkles',
            },
          ]
        : []),
    ],
  },
  // Sección ERP: visible solo para quien tiene un rol ERP (grant en
  // user_company_access). Los módulos se filtran por ese rol y se enlazan por
  // nombre de ruta para que la URL se traduzca (/erp/ventas, /erp/sales…).
  ...(erpSession.navigation.value.length
    ? [
        {
          title: t('nav.secErp'),
          items: erpSession.navigation.value.map((entry) => ({
            label: t(`nav.${entry.key}`),
            to: localePath({ name: entry.routeName }),
            icon: ERP_NAV_ICONS[entry.key] ?? 'i-lucide-box',
          })),
        },
      ]
    : []),
  ...(isAdmin.value
    ? [
        {
          title: t('nav.secAdmin'),
          items: [{ label: t('nav.settings'), to: localePath('/ajustes'), icon: 'i-lucide-settings' }],
        },
      ]
    : []),
])

async function loadPending() {
  if (!isManager.value) return
  try {
    const rows = await $fetch<unknown[]>('/api/leave/requests', {
      query: { scope: 'team', status: 'pending', year: new Date().getFullYear() },
    })
    pendingCount.value = rows.length
  } catch {
    pendingCount.value = 0
  }
}

// La sesión ERP se resuelve en el setup para que la sección del sidebar esté
// disponible desde el SSR (sin parpadeo). Si falla, simplemente no hay ERP.
if (import.meta.server) {
  // Ambas consultas son independientes: en paralelo se evita sumar latencia.
  await Promise.all([erpSession.refresh(), refreshAiStatus()])
}

onMounted(() => {
  void loadPending()
  if (import.meta.client && !erpSession.loaded.value) {
    void erpSession.refresh()
  }
})
watch(
  () => route.path,
  () => {
    mobileOpen.value = false
    void loadPending()
  },
)
</script>

<template>
  <div class="min-h-screen">
    <!-- Sidebar de escritorio (colapsable) -->
    <aside
      class="fixed inset-y-0 left-0 z-30 hidden flex-col bg-slate-900 transition-[width] duration-200 lg:flex"
      :class="sidebarCollapsed ? 'w-20 p-2' : 'w-72 p-4'"
    >
      <AppSidebar
        :sections="sections"
        :collapsed="sidebarCollapsed"
        @toggle="toggleSidebar"
      />
    </aside>

    <div
      class="transition-[padding] duration-200"
      :class="sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'"
    >
      <!-- Cabecera móvil -->
      <header
        class="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur lg:hidden"
      >
        <button
          type="button"
          class="tap-target rounded-xl border border-slate-200 text-slate-600"
          @click="mobileOpen = true"
        >
          <UIcon name="i-lucide-menu" class="size-5" />
        </button>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-slate-900">{{ state?.organization.name }}</p>
          <p class="truncate text-xs text-slate-500">{{ displayName }}</p>
        </div>
        <NuxtLink
          :to="localePath('/vacaciones')"
          class="tap-target rounded-xl bg-slate-900 text-white"
          title="Solicitar vacaciones"
        >
          <UIcon name="i-lucide-plus" class="size-5" />
        </NuxtLink>
      </header>

      <main class="mx-auto w-full max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-10">
        <slot />
      </main>
    </div>

    <!-- Modal global de confirmación/prompt para toda la app. -->
    <DialogHost />

    <!-- Asistente de contenido flotante (disponible en todas las páginas). -->
    <AppAiLauncher />

    <!-- Drawer móvil -->
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="mobileOpen" class="fixed inset-0 z-50 lg:hidden">
        <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="mobileOpen = false" />
        <aside class="absolute inset-y-0 left-0 flex w-80 max-w-[86vw] flex-col bg-slate-900 p-5">
          <button
            type="button"
            class="absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            @click="mobileOpen = false"
          >
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
          <AppSidebar
            :sections="sections"
            :show-toggle="false"
            @navigate="mobileOpen = false"
          />
        </aside>
      </div>
    </Transition>

    <!-- Navegación inferior móvil -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div class="flex items-stretch justify-around">
        <NuxtLink
          :to="localePath('/')"
          class="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium"
          :class="route.path === '/' ? 'text-slate-900' : 'text-slate-400'"
        >
          <UIcon name="i-lucide-layout-dashboard" class="size-5" />
          {{ t('nav.dashboard') }}
        </NuxtLink>
        <NuxtLink
          :to="localePath('/vacaciones')"
          class="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium"
          :class="route.path.startsWith('/vacaciones') ? 'text-slate-900' : 'text-slate-400'"
        >
          <UIcon name="i-lucide-palmtree" class="size-5" />
          {{ t('nav.vacaciones') }}
        </NuxtLink>
        <NuxtLink
          v-if="isManager"
          :to="localePath('/vacaciones/aprobaciones')"
          class="relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium"
          :class="route.path.includes('aprobaciones') ? 'text-slate-900' : 'text-slate-400'"
        >
          <UIcon name="i-lucide-check-check" class="size-5" />
          {{ t('nav.aprobaciones') }}
          <span
            v-if="pendingCount"
            class="absolute right-4 top-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white"
          >
            {{ pendingCount }}
          </span>
        </NuxtLink>
        <NuxtLink
          v-else
          :to="localePath('/vacaciones/calendario')"
          class="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium"
          :class="route.path.includes('calendario') ? 'text-slate-900' : 'text-slate-400'"
        >
          <UIcon name="i-lucide-calendar-days" class="size-5" />
          {{ t('nav.calendario') }}
        </NuxtLink>
        <NuxtLink
          v-if="isManager"
          :to="localePath('/empleados')"
          class="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium"
          :class="route.path.startsWith('/empleados') ? 'text-slate-900' : 'text-slate-400'"
        >
          <UIcon name="i-lucide-users" class="size-5" />
          {{ t('nav.empleados') }}
        </NuxtLink>
        <button
          v-else
          type="button"
          class="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium text-slate-400"
          @click="mobileOpen = true"
        >
          <UIcon name="i-lucide-menu" class="size-5" />
          {{ t('nav.menu') }}
        </button>
      </div>
    </nav>
  </div>
</template>
