<script setup lang="ts">
const { t } = useI18n()
interface ContentBlock {
  id: string
  key: string
  locale: string
  title: string | null
  body: string
  updatedAt: string
}

const { isManager } = useSession()
const { status } = useAiStatus()
const requestFetch = useRequestFetch()

const content = ref<ContentBlock[]>([])

const suggestions = [
  'Publica una oferta de camarero/a para Cocina en Barcelona',
  'Crea un aviso de bienvenida en dashboard.welcome',
  'Actualiza el banner del dashboard con el horario de verano',
  'Revisa las ofertas publicadas y cierra las que ya no aplican',
]

async function loadContent() {
  if (!isManager.value) return
  try {
    content.value = await requestFetch<ContentBlock[]>('/api/content')
  } catch {
    content.value = []
  }
}

onMounted(loadContent)
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="t('page.asistente.title')"
      :subtitle="t('page.asistente.subtitle')"
    >
      <UBadge v-if="status" :color="status.configured ? 'success' : 'error'" variant="subtle" size="sm">
        {{ status.configured ? `IA lista · ${status.model}` : 'IA sin configurar' }}
      </UBadge>
    </PageHeader>

    <div
      v-if="status && !status.configured"
      class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      Falta <code class="font-mono">AI_API_KEY</code> en el entorno. Configúrala junto a
      <code class="font-mono">AI_BASE_URL</code> y <code class="font-mono">AI_MODEL</code> para
      activar el asistente.
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <section
        class="flex min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2"
      >
        <AiChatPanel :suggestions="suggestions" @changed="loadContent" />
      </section>

      <aside class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 class="text-sm font-semibold text-slate-900">Contenido del sitio</h2>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-refresh-cw"
            aria-label="Recargar contenido"
            @click="loadContent"
          />
        </div>

        <EmptyState
          v-if="!content.length"
          icon="i-lucide-layout-template"
          title="Sin bloques de contenido"
          description="Pídele al asistente que cree uno, por ejemplo dashboard.banner."
        />

        <ul v-else class="divide-y divide-slate-100">
          <li v-for="block in content" :key="block.id" class="px-4 py-3">
            <p class="font-mono text-xs font-semibold text-sky-700">{{ block.key }}</p>
            <p v-if="block.title" class="mt-0.5 text-sm font-medium text-slate-900">
              {{ block.title }}
            </p>
            <p class="mt-1 line-clamp-3 text-xs text-slate-500">{{ block.body }}</p>
            <p class="mt-1 text-[11px] text-slate-400">
              {{ block.locale }} · {{ formatDate(block.updatedAt) }}
            </p>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>
