<script setup lang="ts">
/**
 * Conversación con el asistente de contenido.
 *
 * Se usa en la página `/asistente` y dentro del panel flotante. Mantiene su
 * propio historial y delega el trabajo en `/api/ai/agent`.
 */
interface AgentAction {
  tool: string
  ok: boolean
  summary: string
}

interface ChatEntry {
  role: 'user' | 'assistant'
  content: string
  actions?: AgentAction[]
  error?: boolean
}

import type { AssistantModule } from '~/composables/useAssistant'

const props = withDefaults(
  defineProps<{
    compact?: boolean
    suggestions?: string[]
    /** Sección activa: filtra las herramientas del agente. */
    module?: AssistantModule | null
    /** Texto precargado al abrirse desde una sección. */
    seedPrompt?: string
    seedNonce?: number
  }>(),
  { compact: false, suggestions: () => [], module: null, seedPrompt: '', seedNonce: 0 },
)

const emit = defineEmits<{ changed: [] }>()

const { status, ready } = useAiStatus()

const messages = ref<ChatEntry[]>([])
const input = ref('')
const sending = ref(false)
const scroller = ref<HTMLElement | null>(null)

watch(
  () => [props.seedNonce, props.seedPrompt] as const,
  () => {
    if (props.seedPrompt) input.value = props.seedPrompt
  },
  { immediate: true },
)

function errorMessage(e: unknown) {
  const err = e as { statusMessage?: string; data?: { message?: string; statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Error inesperado'
}

async function scrollToBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

async function send(prompt?: string) {
  const text = (prompt ?? input.value).trim()
  if (!text || sending.value || !ready.value) return

  messages.value.push({ role: 'user', content: text })
  input.value = ''
  sending.value = true
  await scrollToBottom()

  try {
    const history = messages.value.map((entry) => ({ role: entry.role, content: entry.content }))
    const result = await $fetch<{ reply: string; actions: AgentAction[] }>('/api/ai/agent', {
      method: 'POST',
      body: { messages: history, module: props.module ?? undefined },
    })
    messages.value.push({ role: 'assistant', content: result.reply, actions: result.actions })
    if (result.actions?.some((action) => action.ok)) emit('changed')
  } catch (e) {
    messages.value.push({ role: 'assistant', content: errorMessage(e), error: true })
  } finally {
    sending.value = false
    await scrollToBottom()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}

function clear() {
  messages.value = []
}

defineExpose({ send, clear })

onMounted(() => {
  if (!status.value) void useAiStatus().refresh()
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      ref="scroller"
      class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
      :class="compact ? 'max-h-[52vh]' : ''"
    >
      <div v-if="!messages.length" class="flex flex-col gap-3 py-4">
        <div class="flex items-center gap-2">
          <span class="rounded-xl bg-sky-100 p-2 text-sky-700">
            <UIcon name="i-lucide-sparkles" class="size-4" />
          </span>
          <div>
            <p class="text-sm font-semibold text-slate-900">¿Qué quieres cambiar en el sitio?</p>
            <p class="text-xs text-slate-500">Textos y ofertas de empleo, en lenguaje natural.</p>
          </div>
        </div>
        <div v-if="suggestions.length" class="grid gap-1.5">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            class="tap-target rounded-xl border border-slate-200 px-3 text-left text-xs text-slate-600 transition hover:bg-slate-50"
            @click="send(suggestion)"
          >
            <UIcon name="i-lucide-arrow-right" class="size-3.5 shrink-0 text-slate-400" />
            {{ suggestion }}
          </button>
        </div>
      </div>

      <div v-for="(message, index) in messages" :key="index" class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
        <div
          class="max-w-[88%] rounded-2xl px-3.5 py-2 text-sm"
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
              class="flex items-start gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-[11px]"
              :class="action.ok ? 'text-emerald-700' : 'text-rose-700'"
            >
              <UIcon
                :name="action.ok ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
                class="mt-0.5 size-3 shrink-0"
              />
              <span><span class="font-mono">{{ action.tool }}</span> · {{ action.summary }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="sending" class="flex items-center gap-2 text-xs text-slate-500">
        <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
        Pensando…
      </div>
    </div>

    <div class="border-t border-slate-100 p-2.5">
      <div class="flex items-end gap-2">
        <textarea
          v-model="input"
          rows="3"
          :disabled="!ready || sending"
          :placeholder="
            ready
              ? 'Ej.: cambia el aviso del dashboard…'
              : 'IA no configurada (falta AI_API_KEY)'
          "
          class="max-h-40 min-h-11 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:opacity-60"
          @keydown="onKeydown"
        />
        <UButton
          icon="i-lucide-send"
          :loading="sending"
          :disabled="!ready || !input.trim()"
          @click="send()"
        >
          Enviar
        </UButton>
      </div>
    </div>
  </div>
</template>
