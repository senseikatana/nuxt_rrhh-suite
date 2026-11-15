<script setup lang="ts">
const { t } = useI18n()
interface PayrollPeriod {
  id: string
  year: number
  month: number
  status: 'open' | 'closed'
  employeeCount: number
  totalGross: number
  totalNet: number
  canManage: boolean
}

interface Payslip {
  id: string
  periodId: string
  employeeId: string
  gross: number
  net: number
  year: number
  month: number
  periodStatus: 'open' | 'closed'
  employeeName: string
  departmentName: string | null
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  active: boolean
}

const { isManager } = useSession()
const toast = useToast()
const { confirm } = useDialogs()

const periods = ref<PayrollPeriod[]>([])
const payslips = ref<Payslip[]>([])
const employees = ref<EmployeeOption[]>([])
const selectedPeriodId = ref<string | null>(null)
const loading = ref(true)
const loadingSlips = ref(false)
const error = ref('')
const formOpen = ref(false)
const saving = ref(false)

const now = new Date()
const form = reactive({
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  employeeId: '',
  gross: 0,
  net: 0,
})

const monthNames = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function errorMessage(e: unknown) {
  const err = e as { statusMessage?: string; data?: { message?: string; statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Error inesperado'
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
}

function periodLabel(period: { year: number; month: number }) {
  return `${monthNames[period.month - 1]} ${period.year}`
}

async function loadPeriods() {
  loading.value = true
  error.value = ''
  try {
    periods.value = await $fetch<PayrollPeriod[]>('/api/payroll/periods')
    if (!selectedPeriodId.value && periods.value.length) {
      selectedPeriodId.value = periods.value[0].id
    }
    if (selectedPeriodId.value) await loadPayslips(selectedPeriodId.value)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

async function loadPayslips(periodId: string) {
  selectedPeriodId.value = periodId
  loadingSlips.value = true
  try {
    payslips.value = await $fetch<Payslip[]>('/api/payroll/payslips', { query: { periodId } })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    loadingSlips.value = false
  }
}

async function loadEmployees() {
  if (!isManager.value) return
  try {
    employees.value = await $fetch<EmployeeOption[]>('/api/employees')
  } catch {
    employees.value = []
  }
}

async function createPeriod() {
  saving.value = true
  try {
    await $fetch('/api/payroll/periods', {
      method: 'POST',
      body: { year: form.year, month: form.month },
    })
    toast.add({ title: 'Periodo creado', color: 'success' })
    await loadPeriods()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function closePeriod(period: PayrollPeriod) {
  const ok = await confirm({
    title: 'Cerrar periodo',
    description: `Se cerrará ${periodLabel(period)} y no admitirá más cambios.`,
    danger: true,
    confirmLabel: 'Cerrar periodo',
  })
  if (!ok) return
  try {
    await $fetch(`/api/payroll/periods/${period.id}/close`, { method: 'POST' })
    toast.add({ title: 'Periodo cerrado', color: 'success' })
    await loadPeriods()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

async function savePayslip() {
  if (!selectedPeriodId.value || !form.employeeId) {
    toast.add({ title: 'Selecciona periodo y empleado', color: 'error' })
    return
  }
  saving.value = true
  try {
    await $fetch('/api/payroll/payslips', {
      method: 'POST',
      body: {
        periodId: selectedPeriodId.value,
        employeeId: form.employeeId,
        gross: Number(form.gross),
        net: Number(form.net),
      },
    })
    toast.add({ title: 'Nómina guardada', color: 'success' })
    formOpen.value = false
    form.employeeId = ''
    form.gross = 0
    form.net = 0
    await loadPayslips(selectedPeriodId.value)
    await loadPeriods()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

const selectedPeriod = computed(() =>
  periods.value.find((period) => period.id === selectedPeriodId.value) ?? null,
)

onMounted(async () => {
  await Promise.all([loadPeriods(), loadEmployees()])
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="t('page.nominas.title')"
      :subtitle="t('page.nominas.subtitle')"
    >
      <AiActionButton module="nominas" label="Preparar con IA" prompt="Prepara el periodo de nómina del mes actual y pregúntame lo que necesites." />
      <UButton v-if="isManager" icon="i-lucide-calendar-plus" @click="formOpen = !formOpen">
        Nuevo periodo
      </UButton>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Periodos" :value="periods.length" hint="registrados" icon="i-lucide-calendar" tone="sky" />
      <StatCard label="Abiertos" :value="periods.filter((p) => p.status === 'open').length" hint="admiten cambios" icon="i-lucide-lock-open" tone="emerald" />
      <StatCard
        label="Coste bruto"
        :value="formatCurrency(periods.reduce((sum, p) => sum + p.totalGross, 0))"
        hint="todos los periodos"
        icon="i-lucide-banknote"
        tone="violet"
      />
      <StatCard
        label="Coste neto"
        :value="formatCurrency(periods.reduce((sum, p) => sum + p.totalNet, 0))"
        hint="todos los periodos"
        icon="i-lucide-wallet"
        tone="amber"
      />
    </div>

    <!-- Alta de periodo / nómina -->
    <div v-if="formOpen && isManager" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 class="text-sm font-semibold text-slate-900">Nuevo periodo</h2>
          <div class="mt-3 flex gap-2">
            <select v-model.number="form.month" class="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option v-for="(name, index) in monthNames" :key="name" :value="index + 1">{{ name }}</option>
            </select>
            <input v-model.number="form.year" type="number" min="2000" max="2100" class="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
            <UButton :loading="saving" icon="i-lucide-plus" @click="createPeriod">Crear</UButton>
          </div>
        </div>
        <div>
          <h2 class="text-sm font-semibold text-slate-900">Añadir nómina</h2>
          <div class="mt-3 space-y-2">
            <select v-model="form.employeeId" class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="" disabled>Empleado…</option>
              <option v-for="employee in employees" :key="employee.id" :value="employee.id">
                {{ employee.firstName }} {{ employee.lastName }}
              </option>
            </select>
            <div class="flex gap-2">
              <input v-model.number="form.gross" type="number" min="0" step="0.01" placeholder="Bruto" class="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
              <input v-model.number="form.net" type="number" min="0" step="0.01" placeholder="Neto" class="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
              <UButton :loading="saving" icon="i-lucide-save" @click="savePayslip">Guardar</UButton>
            </div>
            <p v-if="selectedPeriod" class="text-xs text-slate-500">
              Se guardará en {{ periodLabel(selectedPeriod) }}.
            </p>
          </div>
        </div>
      </div>
    </div>

    <p v-if="error" class="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

    <div v-if="loading" class="py-10 text-center text-sm text-slate-500">Cargando nóminas…</div>

    <EmptyState
      v-else-if="!periods.length"
      icon="i-lucide-banknote"
      title="Sin periodos de nómina"
      :description="isManager ? 'Crea el primer periodo para empezar a cargar nóminas.' : 'Todavía no hay nóminas publicadas.'"
    />

    <div v-else class="grid gap-6 lg:grid-cols-[320px_1fr]">
      <!-- Periodos -->
      <div class="space-y-2">
        <button
          v-for="period in periods"
          :key="period.id"
          type="button"
          class="w-full rounded-xl border p-3 text-left transition"
          :class="
            selectedPeriodId === period.id
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          "
          @click="loadPayslips(period.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold">{{ periodLabel(period) }}</span>
            <StatusBadge :status="period.status" />
          </div>
          <p class="mt-1 text-xs" :class="selectedPeriodId === period.id ? 'text-slate-300' : 'text-slate-500'">
            {{ period.employeeCount }} nóminas · {{ formatCurrency(period.totalGross) }}
          </p>
          <UButton
            v-if="period.canManage && period.status === 'open'"
            size="xs"
            color="error"
            variant="soft"
            class="mt-2"
            icon="i-lucide-lock"
            @click.stop="closePeriod(period)"
          >
            Cerrar
          </UButton>
        </button>
      </div>

      <!-- Nóminas del periodo -->
      <div class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 class="text-sm font-semibold text-slate-900">
            {{ selectedPeriod ? periodLabel(selectedPeriod) : 'Nóminas' }}
          </h2>
          <span class="text-xs text-slate-500">{{ payslips.length }} registros</span>
        </div>

        <div v-if="loadingSlips" class="px-4 py-10 text-center text-sm text-slate-500">Cargando…</div>

        <EmptyState
          v-else-if="!payslips.length"
          icon="i-lucide-file-text"
          title="Sin nóminas en este periodo"
          :description="isManager ? 'Carga las nóminas del periodo desde el formulario superior.' : 'Aún no se ha publicado tu nómina de este periodo.'"
        />

        <table v-else class="w-full text-sm">
          <thead class="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr class="border-b border-slate-100">
              <th class="px-4 py-2 font-medium">Empleado</th>
              <th class="px-4 py-2 font-medium">Departamento</th>
              <th class="px-4 py-2 text-right font-medium">Bruto</th>
              <th class="px-4 py-2 text-right font-medium">Neto</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="slip in payslips" :key="slip.id" class="border-b border-slate-50 last:border-0">
              <td class="px-4 py-2.5 font-medium text-slate-800">{{ slip.employeeName }}</td>
              <td class="px-4 py-2.5 text-slate-500">{{ slip.departmentName ?? '—' }}</td>
              <td class="px-4 py-2.5 text-right text-slate-700">{{ formatCurrency(slip.gross) }}</td>
              <td class="px-4 py-2.5 text-right font-medium text-slate-900">{{ formatCurrency(slip.net) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
