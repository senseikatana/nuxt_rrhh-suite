<script setup lang="ts">
interface WhistleReport {
  id: string
  trackingCode: string
  category: string
  description: string
  status: 'new' | 'in_review' | 'resolved' | 'closed'
  createdAt: string
  updatedAt: string
}

interface WhistleMessage {
  id: string
  authorType: 'reporter' | 'company'
  body: string
  createdAt: string
}

const { isManager } = useSession()
const toast = useToast()
const { confirm, prompt } = useDialogs()

type TabId = 'nueva' | 'seguimiento' | 'gestion'

const tabs: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'nueva', label: 'Enviar denuncia', icon: 'i-lucide-shield-plus' },
  { id: 'seguimiento', label: 'Seguimiento', icon: 'i-lucide-search' },
  ...(isManager.value
    ? [{ id: 'gestion' as TabId, label: 'Gestión', icon: 'i-lucide-clipboard-list' }]
    : []),
]

const activeTab = ref<TabId>('nueva')
const categories = ['Acoso', 'Fraude o corrupción', 'Seguridad', 'Discriminación', 'Otro']
const statuses = [
  { value: 'new', label: 'Nueva' },
  { value: 'in_review', label: 'En revisión' },
  { value: 'resolved', label: 'Resuelta' },
  { value: 'closed', label: 'Cerrada' },
] as const

const submission = reactive({ category: categories[0], description: '' })
const trackingCode = ref('')
const lookupCode = ref('')
const replyBody = ref('')
const saving = ref(false)

const reports = ref<WhistleReport[]>([])
const loadingReports = ref(false)
const error = ref('')

const trackResult = ref<{ report: WhistleReport; messages: WhistleMessage[] } | null>(null)
const trackError = ref('')
const loadingTrack = ref(false)

function errorMessage(e: unknown) {
  const err = e as { statusMessage?: string; data?: { message?: string; statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Error inesperado'
}

async function sendReport() {
  if (submission.description.trim().length < 20) {
    toast.add({ title: 'Describe los hechos con más detalle (mínimo 20 caracteres)', color: 'error' })
    return
  }
  saving.value = true
  try {
    const result = await $fetch<{ trackingCode: string }>('/api/whistle', {
      method: 'POST',
      body: { category: submission.category, description: submission.description },
    })
    trackingCode.value = result.trackingCode
    submission.description = ''
    toast.add({ title: 'Denuncia registrada', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function lookup() {
  if (!lookupCode.value.trim()) return
  loadingTrack.value = true
  trackError.value = ''
  trackResult.value = null
  try {
    trackResult.value = await $fetch('/api/whistle/track', {
      query: { code: lookupCode.value.trim().toUpperCase() },
    })
  } catch (e) {
    trackError.value = errorMessage(e)
  } finally {
    loadingTrack.value = false
  }
}

async function sendReply() {
  if (!trackResult.value || !replyBody.value.trim()) return
  saving.value = true
  try {
    await $fetch('/api/whistle/track', {
      method: 'POST',
      body: { code: trackResult.value.report.trackingCode, body: replyBody.value },
    })
    replyBody.value = ''
    await lookup()
    toast.add({ title: 'Mensaje enviado', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function loadReports() {
  if (!isManager.value) return
  loadingReports.value = true
  error.value = ''
  try {
    reports.value = await $fetch<WhistleReport[]>('/api/whistle')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loadingReports.value = false
  }
}

async function updateStatus(report: WhistleReport, status: WhistleReport['status']) {
  if (report.status === status) return
  if (status === 'closed') {
    const ok = await confirm({
      title: 'Cerrar caso',
      description: 'El denunciante ya no podrá seguir respondiendo en el hilo.',
      danger: true,
      confirmLabel: 'Cerrar caso',
    })
    if (!ok) return
  }
  try {
    await $fetch(`/api/whistle/${report.id}`, { method: 'PATCH', body: { status } })
    report.status = status
    toast.add({ title: 'Estado actualizado', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

async function replyFromManagement(report: WhistleReport) {
  const message = await prompt({
    title: 'Responder al denunciante',
    label: 'Mensaje',
    multiline: true,
    required: true,
    confirmLabel: 'Enviar respuesta',
  })
  if (!message) return
  try {
    await $fetch(`/api/whistle/${report.id}`, { method: 'PATCH', body: { message } })
    toast.add({ title: 'Respuesta enviada', color: 'success' })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

function goToTracking() {
  lookupCode.value = trackingCode.value
  activeTab.value = 'seguimiento'
  trackingCode.value = ''
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(trackingCode.value)
    toast.add({ title: 'Código copiado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo copiar; anótalo a mano', color: 'error' })
  }
}

onMounted(loadReports)
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Canal de denuncias"
      subtitle="Canal trazable y confidencial. No se guarda ningún dato del denunciante."
    >
      <AiActionButton module="denuncias" label="Revisar con IA" prompt="Revisa las denuncias abiertas y propón los siguientes pasos para cada una." />
    </PageHeader>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition"
        :class="
          activeTab === tab.id
            ? 'bg-slate-900 text-white'
            : 'bg-white text-slate-600 hover:bg-slate-100'
        "
        @click="activeTab = tab.id"
      >
        <UIcon :name="tab.icon" class="size-4" />
        {{ tab.label }}
      </button>
    </div>

    <!-- Nueva denuncia -->
    <div v-if="activeTab === 'nueva'" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div v-if="trackingCode" class="space-y-3">
        <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p class="text-sm font-semibold text-emerald-800">Denuncia registrada</p>
          <p class="mt-1 text-sm text-emerald-700">
            Guarda este código: es la única forma de consultar el caso.
          </p>
          <p class="mt-2 font-mono text-lg font-bold tracking-wider text-emerald-900">
            {{ trackingCode }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton variant="soft" icon="i-lucide-copy" @click="copyCode">
            Copiar código
          </UButton>
          <UButton color="neutral" variant="ghost" @click="goToTracking">
            Consultar ahora
          </UButton>
        </div>
      </div>

      <div v-else class="space-y-3">
        <div>
          <label class="text-sm font-medium text-slate-700">Categoría</label>
          <select v-model="submission.category" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-medium text-slate-700">Descripción de los hechos</label>
          <textarea
            v-model="submission.description"
            rows="6"
            placeholder="Cuanto más detalle, mejor se podrá investigar. No incluyas datos que te identifiquen si quieres mantener el anonimato."
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div class="flex justify-end">
          <UButton :loading="saving" icon="i-lucide-shield-check" @click="sendReport">
            Enviar denuncia
          </UButton>
        </div>
      </div>
    </div>

    <!-- Seguimiento -->
    <div v-else-if="activeTab === 'seguimiento'" class="space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label class="text-sm font-medium text-slate-700">Código de seguimiento</label>
        <div class="mt-2 flex flex-wrap gap-2">
          <input
            v-model="lookupCode"
            placeholder="WD-XXXXXXXX"
            class="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
            @keyup.enter="lookup"
          >
          <UButton :loading="loadingTrack" icon="i-lucide-search" @click="lookup">Consultar</UButton>
        </div>
        <p v-if="trackError" class="mt-3 text-sm text-rose-600">{{ trackError }}</p>
      </div>

      <div v-if="trackResult" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-slate-900">{{ trackResult.report.category }}</p>
            <p class="text-xs text-slate-500">Actualizado {{ formatDate(trackResult.report.updatedAt) }}</p>
          </div>
          <StatusBadge :status="trackResult.report.status" />
        </div>
        <p class="mt-3 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {{ trackResult.report.description }}
        </p>

        <div v-if="trackResult.messages.length" class="mt-4 space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Conversación</p>
          <div
            v-for="message in trackResult.messages"
            :key="message.id"
            class="rounded-lg px-3 py-2 text-sm"
            :class="message.authorType === 'company' ? 'bg-sky-50 text-sky-900' : 'bg-slate-100 text-slate-800'"
          >
            <p class="text-[11px] font-semibold uppercase tracking-wide opacity-70">
              {{ message.authorType === 'company' ? 'Empresa' : 'Denunciante' }} · {{ formatDate(message.createdAt) }}
            </p>
            <p class="mt-1 whitespace-pre-line">{{ message.body }}</p>
          </div>
        </div>

        <div v-if="trackResult.report.status !== 'closed'" class="mt-4">
          <textarea
            v-model="replyBody"
            rows="3"
            placeholder="Añadir información al caso…"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div class="mt-2 flex justify-end">
            <UButton :loading="saving" icon="i-lucide-send" @click="sendReply">Enviar mensaje</UButton>
          </div>
        </div>
        <p v-else class="mt-4 text-xs text-slate-500">Este caso está cerrado.</p>
      </div>
    </div>

    <!-- Gestión -->
    <div v-else class="space-y-3">
      <p v-if="error" class="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>
      <div v-if="loadingReports" class="py-10 text-center text-sm text-slate-500">Cargando denuncias…</div>
      <EmptyState
        v-else-if="!reports.length"
        icon="i-lucide-shield-check"
        title="Sin denuncias"
        description="No hay casos registrados."
      />
      <div v-else class="space-y-3">
        <article
          v-for="report in reports"
          :key="report.id"
          class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-semibold text-slate-900">{{ report.category }}</p>
                <StatusBadge :status="report.status" />
              </div>
              <p class="font-mono text-xs text-slate-500">{{ report.trackingCode }} · {{ formatDate(report.createdAt) }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <select
                :value="report.status"
                class="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                @change="updateStatus(report, ($event.target as HTMLSelectElement).value as WhistleReport['status'])"
              >
                <option v-for="status in statuses" :key="status.value" :value="status.value">{{ status.label }}</option>
              </select>
              <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-reply" @click="replyFromManagement(report)">
                Responder
              </UButton>
            </div>
          </div>
          <p class="mt-3 whitespace-pre-line text-sm text-slate-700">{{ report.description }}</p>
        </article>
      </div>
    </div>
  </div>
</template>
