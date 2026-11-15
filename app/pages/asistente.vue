<script setup lang="ts">
interface AgentAction {
  tool: string
  ok: boolean
  summary: string
  args?: unknown
}

interface ChatEntry {
  role: 'user' | 'assistant'
  content: string
  actions?: AgentAction[]
  error?: boolean
}

interface ContentBlock {
  id: string
  key: string
  locale: string
  title: string | null
  body: string
  updatedAt: string
}

const { isManager } = useSession()
const toast = useToast()
const requestFetch = useRequestFetch()

const status = ref<{ configured: boolean; model: string; host: string; canUse: boolean } | null>(null)
const content = ref<ContentBlock[]>([])
const messages = ref<ChatEntry[]>([])
const input = ref('')
const sending = ref(false)

const suggestions = [
  'Publica una oferta de camarero/a para el departamento de Cocina en Barcelona',
  'Escribe un aviso de bienvenida para el dashboard y guárdalo en dashboard.welcome',
  'Actualiza el banner del dashboard con el horario de verano',
  'Revisa las ofertas publicadas y ciérralas si ya no aplican',
]

const canUse = computed(() => Boolean(status.value?.configured && status.value?.canUse))

function errorMessage(e: unknown) {
  const err = e as { statusMessage?: string; data?: { message?: string; statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Error inesperado'
}

async function loadStatus() {
  try {
    status.value = await requestFetch('/api/ai/status')
  } catch {
    status.value = { configured: false, model: '-', host: '-', canUse: false }
  }
}

async function loadContent() {
  if (!isManager.value) return
  try {
    content.value = await requestFetch<ContentBlock[]>('/api/content')
  } catch {
    content.value = []
  }
}

async function send(prompt?: string) {
  const text = (prompt ?? input.value).trim()
  if (!text || sending.value || !canUse.value) return

  messages.value.push({ role: 'user', content: text })
  input.value = ''
  sending.value = true

  try {
    const history = messages.value.map((entry) => ({ role: entry.role, content: entry.content }))
    const result = await $fetch<{ reply: string; actions: AgentAction[] }>('/api/ai/agent', {
      method: 'POST',
      body: { messages: history },
    })
    messages.value.push({
      role: 'assistant',
      content: result.reply,
      actions: result.actions,
    })
    await loadContent()
  } catch (e) {
    messages.value.push({
      role: 'assistant',
      content: errorMessage(e),
      error: true,
    })
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}

function clearChat() {
  messages.value = []
}

onMounted(async () => {
  await Promise.all([loadStatus(), loadContent()])
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Asistente de contenido"
      subtitle="Crea, actualiza y modifica el contenido del sitio hablando con la IA. Cada cambio queda registrado en la auditoría."
    >
      <UBadge v-if="status" :color="status.configured ? 'success' : 'error'" variant="subtle" size="sm">
        {{ status.configured ? `IA lista · ${status.model}` : 'IA sin configurar' }}
      </UBadge>
      <UButton
        v-if="messages.length"
        color="neutral"
        variant="soft"
        icon="i-lucide-eraser"
        @click="clearChat"
      >
        Limpiar
      </UButton>
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
      <!-- Chat -->
      <section class="flex min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
        <div class="flex-1 space-y-4 overflow-y-auto p-4">
          <div v-if="!messages.length" class="flex h-full flex-col justify-center gap-4 px-2 text-center">
            <div class="mx-auto rounded-2xl bg-sky-100 p-3 text-sky-700">
              <UIcon name="i-lucide-sparkles" class="size-6" />
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-900">¿Qué quieres cambiar en el sitio?</p>
              <p class="mt-1 text-sm text-slate-500">
                Pídelo en lenguaje natural. El asistente puede editar textos y ofertas de empleo.
              </p>
            </div>
            <div class="mx-auto grid w-full max-w-lg gap-2">
              <button
                v-for="suggestion in suggestions"
                :key="suggestion"
                type="button"
                class="tap-target rounded-xl border border-slate-200 px-3 text-left text-sm text-slate-600 transition hover:bg-slate-50"
                @click="send(suggestion)"
              >
                <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 text-slate-400" />
                {{ suggestion }}
              </button>
            </div>
          </div>

          <template v-for="(message, index) in messages" :key="index">
            <div class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
              <div
                class="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm"
                :class="
                  message.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : message.error
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-slate-100 text-slate-800'
                "
              >
                <p class="whitespace-pre-line">{{ message.content }}</p>

                <ul v-if="message.actions?.length" class="mt-2 space-y-1">
                  <li
                    v-for="(action, actionIndex) in message.actions"
                    :key="actionIndex"
                    class="flex items-start gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-xs"
                    :class="action.ok ? 'text-emerald-700' : 'text-rose-700'"
                  >
                    <UIcon
                      :name="action.ok ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
                      class="mt-0.5 size-3.5 shrink-0"
                    />
                    <span><span class="font-mono">{{ action.tool }}</span> · {{ action.summary }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </template>

          <div v-if="sending" class="flex items-center gap-2 text-sm text-slate-500">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            Pensando…
          </div>
        </div>

        <div class="border-t border-slate-100 p-3">
          <div class="flex items-end gap-2">
            <textarea
              v-model="input"
              rows="2"
              :disabled="!canUse || sending"
              placeholder="Ej.: crea una oferta de recepcionista y publícala…"
              class="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
              @keydown="onKeydown"
            />
            <UButton
              size="lg"
              icon="i-lucide-send"
              :loading="sending"
              :disabled="!canUse || !input.trim()"
              @click="send()"
            >
              Enviar
            </UButton>
          </div>
          <p class="mt-2 text-xs text-slate-400">
            Enter envía · Shift+Enter hace salto de línea. Solo administración y mandos.
          </p>
        </div>
      </section>

      <!-- Contenido del sitio -->
      <aside class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 class="text-sm font-semibold text-slate-900">Contenido del sitio</h2>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" @click="loadContent" />
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
            <p v-if="block.title" class="mt-0.5 text-sm font-medium text-slate-900">{{ block.title }}</p>
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
