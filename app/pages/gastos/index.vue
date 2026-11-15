<script setup lang="ts">
interface ExpenseLine {
  id: string
  date: string
  category: string
  description: string | null
  amount: number
  tax: number
}

interface ExpenseReport {
  id: string
  employeeId: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'reimbursed'
  total: number
  notes: string | null
  submittedAt: string | null
  approvedAt: string | null
  createdAt: string
  employeeName: string
  departmentName: string | null
  lines: ExpenseLine[]
}

const { state, isManager } = useSession()
const toast = useToast()
const { confirm } = useDialogs()

const reports = ref<ExpenseReport[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const formOpen = ref(false)

const form = reactive({
  notes: '',
  lines: [{ date: todayIso(), category: 'Dietas', description: '', amount: 0 }],
})

const categories = ['Dietas', 'Transporte', 'Alojamiento', 'Material', 'Formación', 'Otros']

const ownEmployeeId = computed(() => state.value?.employee?.id ?? null)

const stats = computed(() => {
  const pending = reports.value.filter((r) => r.status === 'submitted')
  const approved = reports.value.filter((r) => r.status === 'approved')
  const reimbursed = reports.value.filter((r) => r.status === 'reimbursed')
  return {
    pendingCount: pending.length,
    pendingAmount: pending.reduce((sum, r) => sum + r.total, 0),
    approvedAmount: approved.reduce((sum, r) => sum + r.total, 0),
    reimbursedAmount: reimbursed.reduce((sum, r) => sum + r.total, 0),
  }
})

const totalNew = computed(() =>
  Math.round(form.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0) * 100) / 100,
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    reports.value = await $fetch<ExpenseReport[]>('/api/expenses')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

function errorMessage(e: unknown) {
  const err = e as { statusMessage?: string; data?: { message?: string; statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Error inesperado'
}

function addLine() {
  form.lines.push({ date: todayIso(), category: 'Dietas', description: '', amount: 0 })
}

function removeLine(index: number) {
  if (form.lines.length === 1) return
  form.lines.splice(index, 1)
}

async function createReport() {
  if (totalNew.value <= 0) {
    toast.add({ title: 'Añade importes válidos', color: 'error' })
    return
  }
  saving.value = true
  try {
    await $fetch('/api/expenses', {
      method: 'POST',
      body: {
        notes: form.notes || undefined,
        lines: form.lines.map((line) => ({
          date: line.date,
          category: line.category,
          description: line.description || undefined,
          amount: Number(line.amount),
        })),
      },
    })
    toast.add({ title: 'Nota de gasto creada', color: 'success' })
    formOpen.value = false
    form.notes = ''
    form.lines = [{ date: todayIso(), category: 'Dietas', description: '', amount: 0 }]
    await load()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function submitReport(report: ExpenseReport) {
  try {
    await $fetch(`/api/expenses/${report.id}/submit`, { method: 'POST' })
    toast.add({ title: 'Enviada a validación', color: 'success' })
    await load()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

async function decide(report: ExpenseReport, action: 'approve' | 'reject' | 'reimburse') {
  const labels = { approve: 'aprobar', reject: 'rechazar', reimburse: 'reembolsar' }
  if (action === 'reject') {
    const ok = await confirm({
      title: 'Rechazar nota de gasto',
      description: `Se rechazará la nota de ${report.employeeName} por ${formatCurrency(report.total)}.`,
      danger: true,
      confirmLabel: 'Rechazar',
    })
    if (!ok) return
  }
  try {
    await $fetch(`/api/expenses/${report.id}/decision`, { method: 'POST', body: { action } })
    toast.add({ title: `Nota ${labels[action]}da`, color: 'success' })
    await load()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Gastos"
      subtitle="Notas de gasto con sus líneas, validación y reembolso."
    >
      <UButton icon="i-lucide-plus" @click="formOpen = !formOpen">
        Nueva nota
      </UButton>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Pendientes" :value="stats.pendingCount" :hint="formatCurrency(stats.pendingAmount)" icon="i-lucide-hourglass" tone="amber" />
      <StatCard label="Aprobadas" :value="formatCurrency(stats.approvedAmount)" hint="pendientes de reembolso" icon="i-lucide-check" tone="emerald" />
      <StatCard label="Reembolsadas" :value="formatCurrency(stats.reimbursedAmount)" hint="histórico" icon="i-lucide-banknote" tone="sky" />
      <StatCard label="Total" :value="reports.length" hint="notas registradas" icon="i-lucide-receipt" tone="violet" />
    </div>

    <!-- Alta de nota -->
    <div v-if="formOpen" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 class="text-sm font-semibold text-slate-900">Nueva nota de gasto</h2>
      <div class="mt-4 space-y-3">
        <div
          v-for="(line, index) in form.lines"
          :key="index"
          class="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-12"
        >
          <input v-model="line.date" type="date" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" >
          <select v-model="line.category" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:col-span-3">
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
          <input v-model="line.description" placeholder="Descripción" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:col-span-4" >
          <input v-model.number="line.amount" type="number" min="0" step="0.01" placeholder="0,00" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2" >
          <button
            type="button"
            class="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-40 sm:col-span-1"
            :disabled="form.lines.length === 1"
            title="Quitar línea"
            @click="removeLine(index)"
          >
            <UIcon name="i-lucide-x" class="mx-auto size-4" />
          </button>
        </div>
        <UButton variant="soft" color="neutral" icon="i-lucide-plus" size="sm" @click="addLine">
          Añadir línea
        </UButton>
        <textarea
          v-model="form.notes"
          rows="2"
          placeholder="Notas para quien valida (opcional)"
          class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-slate-500">
            Total: <span class="font-semibold text-slate-900">{{ formatCurrency(totalNew) }}</span>
          </p>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" @click="formOpen = false">Cancelar</UButton>
            <UButton :loading="saving" icon="i-lucide-check" @click="createReport">Guardar borrador</UButton>
          </div>
        </div>
      </div>
    </div>

    <p v-if="error" class="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

    <div v-if="loading" class="py-10 text-center text-sm text-slate-500">Cargando gastos…</div>

    <EmptyState
      v-else-if="!reports.length"
      icon="i-lucide-receipt"
      title="Sin notas de gasto"
      description="Crea una nota con sus líneas y envíala a validación."
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
              <p class="font-semibold text-slate-900">{{ report.employeeName }}</p>
              <StatusBadge :status="report.status" />
            </div>
            <p class="text-xs text-slate-500">
              {{ report.departmentName ?? 'Sin departamento' }} · {{ formatDate(report.createdAt) }}
            </p>
          </div>
          <p class="text-lg font-semibold text-slate-900">{{ formatCurrency(report.total) }}</p>
        </div>

        <ul class="mt-3 divide-y divide-slate-100 text-sm">
          <li v-for="line in report.lines" :key="line.id" class="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span class="text-slate-700">
              <span class="font-medium">{{ line.category }}</span>
              <span v-if="line.description" class="text-slate-500"> · {{ line.description }}</span>
            </span>
            <span class="flex items-center gap-3 text-slate-500">
              <span>{{ formatDate(line.date) }}</span>
              <span class="font-medium text-slate-900">{{ formatCurrency(line.amount) }}</span>
            </span>
          </li>
        </ul>

        <p v-if="report.notes" class="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {{ report.notes }}
        </p>

        <div class="mt-3 flex flex-wrap gap-2">
          <UButton
            v-if="report.employeeId === ownEmployeeId && report.status === 'draft'"
            size="xs"
            icon="i-lucide-send"
            @click="submitReport(report)"
          >
            Enviar
          </UButton>
          <template v-if="isManager && report.status === 'submitted'">
            <UButton size="xs" color="success" icon="i-lucide-check" @click="decide(report, 'approve')">
              Aprobar
            </UButton>
            <UButton size="xs" color="error" variant="soft" icon="i-lucide-x" @click="decide(report, 'reject')">
              Rechazar
            </UButton>
          </template>
          <UButton
            v-if="isManager && report.status === 'approved'"
            size="xs"
            color="primary"
            icon="i-lucide-banknote"
            @click="decide(report, 'reimburse')"
          >
            Reembolsar
          </UButton>
        </div>
      </article>
    </div>
  </div>
</template>
