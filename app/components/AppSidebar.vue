<script setup lang="ts">
import type { NavSection } from '~/types/nav'

withDefaults(defineProps<{ sections: NavSection[]; collapsed?: boolean; showToggle?: boolean }>(), {
  collapsed: false,
  showToggle: true,
})
const emit = defineEmits<{ navigate: []; toggle: [] }>()

const route = useRoute()
const { t } = useI18n()
const { state } = useSession()

const logoUrl = computed<string | null>(() => state.value?.settings.logoUrl ?? null)

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Cabecera / logo + colapso -->
    <div class="flex items-center gap-3 px-1" :class="collapsed ? 'flex-col gap-2' : ''">
      <span
        v-if="logoUrl"
        class="flex h-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm"
        :class="collapsed ? 'w-10 p-1' : 'px-2.5'"
      >
        <img
          :src="logoUrl"
          :alt="state?.organization.name ?? 'Logo'"
          class="object-contain"
          :class="collapsed ? 'h-full w-full' : 'h-7 w-auto'"
        >
      </span>
      <span
        v-else
        class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-sm font-bold text-white shadow-lg shadow-sky-500/20"
      >
        RR
      </span>
      <div v-if="!collapsed" class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-white">RRHH Suite</p>
        <p class="truncate text-xs text-slate-400">{{ state?.organization.name }}</p>
      </div>
      <button
        v-if="!collapsed && showToggle"
        type="button"
        class="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
        :title="t('nav.menu')"
        @click="emit('toggle')"
      >
        <UIcon name="i-lucide-chevrons-left" class="size-4" />
      </button>
    </div>
    <button
      v-if="collapsed && showToggle"
      type="button"
      class="mx-auto mt-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
      :title="t('nav.menu')"
      @click="emit('toggle')"
    >
      <UIcon name="i-lucide-chevrons-right" class="size-4" />
    </button>

    <!-- Navegación -->
    <nav class="scrollbar-thin mt-6 flex-1 overflow-y-auto pb-6" :class="collapsed ? 'space-y-2' : 'space-y-7'">
      <div v-for="section in sections" :key="section.title">
        <p
          v-if="!collapsed"
          class="px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500"
        >
          {{ section.title }}
        </p>
        <div class="space-y-1" :class="collapsed ? '' : 'mt-2'">
          <NuxtLink
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            :title="collapsed ? item.label : undefined"
            class="group relative flex items-center gap-3 rounded-xl text-sm font-medium transition"
            :class="[
              collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2',
              isActive(item.to)
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:bg-white/5 hover:text-white',
            ]"
            @click="emit('navigate')"
          >
            <UIcon :name="item.icon" class="size-5 shrink-0" />
            <template v-if="!collapsed">
              <span class="flex-1 truncate">{{ item.label }}</span>
              <UBadge v-if="item.badge" color="warning" variant="solid" size="xs">
                {{ item.badge }}
              </UBadge>
              <span
                v-else-if="item.phase"
                class="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
              >
                {{ item.phase }}
              </span>
            </template>
            <span
              v-else-if="item.badge"
              class="absolute right-1 top-1 size-1.5 rounded-full bg-amber-400"
            />
          </NuxtLink>
        </div>
      </div>
    </nav>

    <!-- Menú de usuario (dropdown con ajustes, tema e idioma) -->
    <div class="border-t border-white/10 pt-3">
      <AppUserMenu :collapsed="collapsed" @navigate="emit('navigate')" />
    </div>
  </div>
</template>
