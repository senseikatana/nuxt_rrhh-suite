<script setup lang="ts">
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'

interface ShiftPattern {
  id: string
  name: string
  startTime: string
  endTime: string
  color: string
  departmentId: string | null
  departmentName: string | null
}

interface ShiftAssignment {
  id: string
  employeeId: string
  date: string
  patternId: string | null
  startTime: string | null
  endTime: string | null
  notes: string | null
  patternName: string | null
  patternColor: string | null
  firstName: string
  lastName: string
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  active: boolean
  departmentName: string | null
}

const { isManager, state } = useSession()
const toast = useToast()

const patterns = ref<ShiftPattern[]>([])
const assignments = ref<ShiftAssignment[]>([])
const employees = ref<EmployeeOption[]>([])
const loading = ref(true)
const saving = ref(false)
const patternFormOpen = ref(false)

const weekStart = ref(startOfWeek(new Date(), { weekStartsOn: 1 }))

const patternForm = reactive({
  name: 'Mañana',
  startTime: '08:00',
  endTime: '16:00',
  color: '#0ea5e9',
})

const weekDates = computed(() =>
  Array.from({ length: 7 }, (_, index) => format(addDays(weekStart.value, index), 'yyyy-MM-dd')),
)

const weekLabel = computed(
  () =>
    `${format(weekStart.value, "d 'de' MMM", { locale: es })} – ${format(addDays(weekStart.value, 6), "d 'de' MMM yyyy", { locale: es })}`,
)

function errorMessage(e: unknown) {
  const err = e as { statusMessage?: string; data?: { message?: string; statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Error inesperado'
}

function dayLabel(iso: string) {
  return format(parseISO(iso), 'EEE d', { locale: es })
}

function employeeName(employee: EmployeeOption) {
  return `${employee.firstName} ${employee.lastName}`
}

/**
 * Filas del cuadrante: para mandos, todo el equipo activo; para un empleado,
 * solo su propia fila (lectura).
 */
const rows = computed<EmployeeOption[]>(() => {
  if (isManager.value) return employees.value
  const employee = state.value?.employee
  if (!employee) return []
  return [
    {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      active: true,
      departmentName: null,
    },
  ]
})

function assignmentFor(employeeId: string, date: string) {
  return assignments.value.find((item) => item.employeeId === employeeId && item.date === date)
}

async function loadWeek() {
  loading.value = true
  try {
    const from = weekDates.value[0]
    const to = weekDates.value[6]
    assignments.value = await $fetch<ShiftAssignment[]>('/api/shifts/assignments', {
      query: { from, to },
    })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function loadPatterns() {
  try {
    patterns.value = await $fetch<ShiftPattern[]>('/api/shifts/patterns')
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

async function loadEmployees() {
  if (!isManager.value) return
  try {
    employees.value = (await $fetch<EmployeeOption[]>('/api/employees')).filter((e) => e.active)
  } catch {
    employees.value = []
  }
}

async function changeWeek(offset: number) {
  weekStart.value = addDays(weekStart.value, offset * 7)
  await loadWeek()
}

async function createPattern() {
  saving.value = true
  try {
    await $fetch('/api/shifts/patterns', { method: 'POST', body: { ...patternForm } })
    toast.add({ title: 'Turno creado', color: 'success' })
    patternFormOpen.value = false
    await loadPatterns()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function deletePattern(pattern: ShiftPattern) {
  try {
    await $fetch(`/api/shifts/patterns/${pattern.id}`, { method: 'DELETE' })
    toast.add({ title: 'Turno eliminado', color: 'success' })
    await Promise.all([loadPatterns(), loadWeek()])
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

async function assign(employee: EmployeeOption, date: string, value: string) {
  const existing = assignmentFor(employee.id, date)
  try {
    if (!value) {
      if (existing) {
        await $fetch(`/api/shifts/assignments/${existing.id}`, { method: 'DELETE' })
        await loadWeek()
      }
      return
    }
    await $fetch('/api/shifts/assignments', {
      method: 'POST',
      body: { employeeId: employee.id, date, patternId: value },
    })
    await loadWeek()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

onMounted(async () => {
  await Promise.all([loadPatterns(), loadEmployees(), loadWeek()])
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Turnos" subtitle="Cuadrante semanal por empleado con patrones de turno.">
      <AiActionButton module="turnos" label="Con IA" prompt="Asigna turnos al equipo de esta semana. Pregúntame empleado, día y turno si te faltan." />
      <div class="flex items-center gap-2">
        <UButton variant="soft" color="neutral" icon="i-lucide-chevron-left" @click="changeWeek(-1)" />
        <span class="min-w-40 text-center text-sm font-medium text-slate-700">{{ weekLabel }}</span>
        <UButton variant="soft" color="neutral" icon="i-lucide-chevron-right" @click="changeWeek(1)" />
      </div>
      <UButton v-if="isManager" icon="i-lucide-plus" @click="patternFormOpen = !patternFormOpen">
        Nuevo turno
      </UButton>
    </PageHeader>

    <!-- Patrones -->
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">Turnos:</span>
        <span
          v-for="pattern in patterns"
          :key="pattern.id"
          class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
          :style="{ backgroundColor: `${pattern.color}20`, color: pattern.color }"
        >
          {{ pattern.name }} · {{ pattern.startTime }}–{{ pattern.endTime }}
          <button
            v-if="isManager"
            type="button"
            class="text-slate-400 hover:text-rose-500"
            title="Eliminar turno"
            @click="deletePattern(pattern)"
          >
            <UIcon name="i-lucide-x" class="size-3" />
          </button>
        </span>
        <span v-if="!patterns.length" class="text-xs text-slate-400">
          {{ isManager ? 'Crea el primer turno.' : 'Sin turnos definidos.' }}
        </span>
      </div>

      <div v-if="patternFormOpen && isManager" class="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-5">
        <input v-model="patternForm.name" placeholder="Nombre" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
        <input v-model="patternForm.startTime" type="time" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
        <input v-model="patternForm.endTime" type="time" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
        <input v-model="patternForm.color" type="color" class="h-9 w-full rounded-lg border border-slate-300" >
        <div class="flex gap-2">
          <UButton size="sm" :loading="saving" icon="i-lucide-check" @click="createPattern">Guardar</UButton>
          <UButton size="sm" color="neutral" variant="ghost" @click="patternFormOpen = false">Cancelar</UButton>
        </div>
      </div>
    </div>

    <div v-if="loading" class="py-10 text-center text-sm text-slate-500">Cargando cuadrante…</div>

    <EmptyState
      v-else-if="!rows.length"
      icon="i-lucide-users"
      title="Sin empleados activos"
      description="Añade empleados para poder planificar turnos."
    />

    <!-- Cuadrante -->
    <div v-else class="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table class="w-full min-w-[820px] text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <th class="sticky left-0 z-10 bg-white px-4 py-2 font-medium">Empleado</th>
            <th v-for="date in weekDates" :key="date" class="px-2 py-2 text-center font-medium">
              {{ dayLabel(date) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="employee in rows" :key="employee.id" class="border-b border-slate-50 last:border-0">
            <td class="sticky left-0 z-10 bg-white px-4 py-2">
              <p class="font-medium text-slate-800">{{ employeeName(employee) }}</p>
              <p class="text-xs text-slate-500">{{ employee.departmentName ?? '—' }}</p>
            </td>
            <td v-for="date in weekDates" :key="date" class="px-1 py-1 align-top">
              <div
                class="rounded-lg"
                :style="{
                  backgroundColor: assignmentFor(employee.id, date)?.patternColor
                    ? `${assignmentFor(employee.id, date)!.patternColor}18`
                    : 'transparent',
                }"
              >
                <select
                  :value="assignmentFor(employee.id, date)?.patternId ?? ''"
                  :disabled="!isManager"
                  class="w-full rounded-lg border-0 bg-transparent px-1.5 py-1.5 text-xs focus:ring-1 focus:ring-slate-300 disabled:opacity-70"
                  @change="assign(employee, date, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">—</option>
                  <option v-for="pattern in patterns" :key="pattern.id" :value="pattern.id">
                    {{ pattern.name }}
                  </option>
                </select>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!isManager" class="text-xs text-slate-500">
      Vista de solo lectura: solo administración y mandos pueden editar el cuadrante.
    </p>
  </div>
</template>
