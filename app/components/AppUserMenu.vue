<script setup lang="ts">
withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })
const emit = defineEmits<{ navigate: [] }>()

const { state, displayName, isAdmin, logout } = useSession()
const { t, locale, locales, setLocale } = useI18n()
const localePath = useLocalePath()
const colorMode = useColorMode()

const open = ref(false)

const roleLabel = computed(() => {
  const role = state.value?.user.role
  if (role === 'admin') return t('user.roleAdmin')
  if (role === 'manager') return t('user.roleManager')
  return t('user.roleEmployee')
})

const themeOptions = computed(() => [
  { value: 'light' as const, label: t('user.light'), icon: 'i-lucide-sun' },
  { value: 'dark' as const, label: t('user.dark'), icon: 'i-lucide-moon' },
  { value: 'system' as const, label: t('user.system'), icon: 'i-lucide-monitor' },
])

const localeOptions = computed(() =>
  locales.value.map((item) =>
    typeof item === 'string'
      ? { value: item, label: item.toUpperCase() }
      : { value: item.code, label: item.name ?? item.code.toUpperCase() },
  ),
)

function setTheme(value: 'light' | 'dark' | 'system') {
  colorMode.preference = value
}

function pickLocale(value: string) {
  // setLocale de @nuxtjs/i18n navega además a la ruta traducida equivalente.
  void setLocale(value as 'es' | 'en' | 'ca')
}

function close() {
  open.value = false
  emit('navigate')
}

async function signOut() {
  open.value = false
  await logout()
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'top', align: 'start', sideOffset: 8 }"
    :ui="{ content: 'w-64 p-0 overflow-hidden' }"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/5"
      :class="collapsed ? 'justify-center' : ''"
      :title="collapsed ? displayName : undefined"
    >
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white"
      >
        {{ displayName.charAt(0) }}
      </span>
      <div v-if="!collapsed" class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-white">{{ displayName }}</p>
        <p class="truncate text-xs text-slate-400">{{ roleLabel }}</p>
      </div>
      <UIcon
        :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="size-4 shrink-0 text-slate-400"
      />
    </button>

    <template #content>
      <div class="bg-white">
        <!-- Identidad -->
        <div class="border-b border-slate-100 px-3 py-2.5">
          <p class="truncate text-sm font-semibold text-slate-900">{{ displayName }}</p>
          <p class="truncate text-xs text-slate-500">{{ state?.user.email }}</p>
        </div>

        <!-- Cuenta y ajustes -->
        <div class="p-1.5">
          <NuxtLink
            :to="localePath('/cuenta')"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            @click="close"
          >
            <UIcon name="i-lucide-user" class="size-4 text-slate-400" />
            {{ t('user.account') }}
          </NuxtLink>
          <NuxtLink
            v-if="isAdmin"
            :to="localePath('/ajustes')"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            @click="close"
          >
            <UIcon name="i-lucide-settings" class="size-4 text-slate-400" />
            {{ t('user.settings') }}
          </NuxtLink>
        </div>

        <!-- Tema -->
        <div class="border-t border-slate-100 p-2">
          <p class="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {{ t('user.theme') }}
          </p>
          <div class="grid grid-cols-3 gap-1">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              class="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition"
              :class="
                colorMode.preference === option.value
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              "
              @click="setTheme(option.value)"
            >
              <UIcon :name="option.icon" class="size-4" />
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- Idioma -->
        <div class="border-t border-slate-100 p-2">
          <p class="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {{ t('user.language') }}
          </p>
          <div class="grid grid-cols-3 gap-1">
            <button
              v-for="option in localeOptions"
              :key="option.value"
              type="button"
              class="rounded-lg px-1 py-2 text-[11px] font-semibold transition"
              :class="
                locale === option.value
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              "
              @click="pickLocale(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- Salir -->
        <div class="border-t border-slate-100 p-1.5">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
            @click="signOut"
          >
            <UIcon name="i-lucide-log-out" class="size-4" />
            {{ t('user.logout') }}
          </button>
        </div>
      </div>
    </template>
  </UPopover>
</template>
