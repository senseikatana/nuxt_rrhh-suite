<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
import type { DepartmentRow, EmployeeRow, ImportResult } from '~/types/api'

const { isAdmin } = useSession()
const requestFetch = useRequestFetch()
const toast = useToast()
const { confirm } = useDialogs()

const editing = ref<EmployeeRow | null>(null)
const savingEdit = ref(false)
const editForm = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  position: '',
  departmentId: '',
  startDate: '',
  weeklyHours: 40,
  active: true,
})

const editOpen = computed({
  get: () => Boolean(editing.value),
  set: (value: boolean) => {
    if (!value) editing.value = null
  },
})

const year = new Date().getFullYear()
const search = ref('')
const departmentId = ref('all')
const importing = ref(false)
const importResult = ref<ImportResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const [{ data: employees, refresh }, { data: departments }] = await Promise.all([
  useAsyncData<EmployeeRow[]>('employees-page', () => requestFetch('/api/employees')),
  useAsyncData<DepartmentRow[]>('employees-departments', () => requestFetch('/api/departments')),
])

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()

  return (employees.value ?? []).filter((employee) => {
    if (departmentId.value !== 'all' && employee.departmentId !== departmentId.value) return false
    if (!term) return true
    return `${employee.firstName} ${employee.lastName} ${employee.email} ${employee.position ?? ''}`
      .toLowerCase()
      .includes(term)
  })
})

const stats = computed(() => {
  const list = employees.value ?? []
  return {
    total: list.length,
    active: list.filter((employee) => employee.active).length,
    departments: departments.value?.length ?? 0,
    managers: list.filter((employee) => ['admin', 'manager'].includes(employee.role ?? '')).length,
  }
})

const departmentItems = computed(() => [
  { label: 'Todos los departamentos', value: 'all' },
  ...(departments.value ?? []).map((department) => ({ label: department.name, value: department.id })),
])

function download(path: string) {
  window.location.href = path
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  importing.value = true
  importResult.value = null

  try {
    const body = new FormData()
    body.append('file', file)

    const result = await $fetch<ImportResult>('/api/imports/employees', {
      method: 'POST',
      body,
    })

    importResult.value = result
    toast.add({
      title: 'Importación completada',
      description: `${result.created} creados, ${result.updated} actualizados.`,
      color: 'success',
    })

    await Promise.all([refresh(), refreshNuxtData('employees-departments')])
  } catch (caught) {
    const error = caught as { data?: { message?: string }; statusMessage?: string }
    toast.add({
      title: 'No se pudo importar',
      description: error?.data?.message ?? error?.statusMessage ?? 'Revisa el archivo',
      color: 'error',
    })
  } finally {
    importing.value = false
    input.value = ''
  }
}

function roleLabel(role: string | null) {
  if (role === 'admin') return 'Administración'
  if (role === 'manager') return 'Mando'
  if (role === 'employee') return 'Empleado'
  return 'Sin acceso'
}

function roleColor(role: string | null): 'primary' | 'info' | 'neutral' {
  if (role === 'admin') return 'primary'
  if (role === 'manager') return 'info'
  return 'neutral'
}

function openEdit(employee: EmployeeRow) {
  editing.value = employee
  editForm.firstName = employee.firstName
  editForm.lastName = employee.lastName
  editForm.email = employee.email
  editForm.phone = employee.phone ?? ''
  editForm.position = employee.position ?? ''
  editForm.departmentId = employee.departmentId ?? ''
  editForm.startDate = employee.startDate
  editForm.weeklyHours = employee.weeklyHours
  editForm.active = employee.active
}

async function saveEdit() {
  if (!editing.value) return
  savingEdit.value = true
  try {
    await $fetch(`/api/employees/${editing.value.id}`, {
      method: 'PATCH',
      body: {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || null,
        position: editForm.position.trim() || null,
        departmentId: editForm.departmentId || null,
        startDate: editForm.startDate,
        weeklyHours: Number(editForm.weeklyHours),
        active: editForm.active,
      },
    })
    toast.add({ title: 'Empleado actualizado', color: 'success' })
    editing.value = null
    await Promise.all([refresh(), refreshNuxtData('employees-departments')])
  } catch (caught) {
    const error = caught as { data?: { message?: string }; statusMessage?: string }
    toast.add({
      title: 'No se pudo guardar',
      description: error?.data?.message ?? error?.statusMessage ?? 'Revisa los datos',
      color: 'error',
    })
  } finally {
    savingEdit.value = false
  }
}

async function deactivate(employee: EmployeeRow) {
  const ok = await confirm({
    title: 'Dar de baja al empleado',
    description: `${employee.firstName} ${employee.lastName} dejará de estar activo. Se conserva su histórico de fichajes, vacaciones y nóminas.`,
    danger: true,
    confirmLabel: 'Dar de baja',
  })
  if (!ok) return

  try {
    await $fetch(`/api/employees/${employee.id}`, { method: 'DELETE' })
    toast.add({ title: 'Empleado dado de baja', color: 'success' })
    await refresh()
  } catch (caught) {
    const error = caught as { data?: { message?: string }; statusMessage?: string }
    toast.add({
      title: 'No se pudo dar de baja',
      description: error?.data?.message ?? error?.statusMessage,
      color: 'error',
    })
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="t('page.empleados.title')"
      :subtitle="t('page.empleados.subtitle')"
    >
      <AiActionButton module="empleados" label="Crear con IA" prompt="Da de alta un empleado nuevo. Pregúntame nombre, apellidos, email, puesto, departamento y fecha de alta si te faltan." />
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-file-down"
        @click="download('/api/imports/template')"
      >
        Plantilla Excel
      </UButton>
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-download"
        @click="download(`/api/exports/leave.xlsx?year=${year}`)"
      >
        Exportar
      </UButton>
      <UButton icon="i-lucide-upload" :loading="importing" @click="fileInput?.click()">
        Importar
      </UButton>
      <input
        ref="fileInput"
        type="file"
        accept=".xlsx,.xls"
        class="hidden"
        @change="onFileChange"
      >
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Plantilla" :value="stats.total" hint="personas registradas" icon="i-lucide-users" tone="sky" />
      <StatCard label="Activos" :value="stats.active" hint="con contrato vigente" icon="i-lucide-user-check" tone="emerald" />
      <StatCard label="Departamentos" :value="stats.departments" hint="áreas de la empresa" icon="i-lucide-building-2" tone="violet" />
      <StatCard label="Mandos y admin" :value="stats.managers" hint="con acceso de gestión" icon="i-lucide-shield" tone="amber" />
    </div>

    <UAlert
      v-if="importResult"
      color="success"
      variant="subtle"
      icon="i-lucide-check-check"
      title="Resultado de la importación"
      :description="`${importResult.created} empleados creados · ${importResult.updated} actualizados · ${importResult.departmentsCreated} departamentos nuevos · ${importResult.holidays} festivos.${importResult.errors.length ? ` ${importResult.errors.length} fila(s) con errores.` : ''}`"
    />

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Buscar por nombre, email o puesto…"
        class="w-full sm:max-w-sm"
      />
      <USelect v-model="departmentId" :items="departmentItems" class="w-full sm:w-64" />
      <p class="text-xs text-slate-500">{{ filtered.length }} de {{ stats.total }}</p>
    </div>

    <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table class="w-full min-w-[860px] text-left text-sm">
        <thead>
          <tr class="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-400">
            <th class="px-4 py-3 font-semibold">Empleado</th>
            <th class="px-4 py-3 font-semibold">Departamento</th>
            <th class="px-4 py-3 font-semibold">Puesto</th>
            <th class="px-4 py-3 font-semibold">Alta</th>
            <th class="px-4 py-3 font-semibold">Horas</th>
            <th class="px-4 py-3 font-semibold">PIN</th>
            <th class="px-4 py-3 font-semibold">Acceso</th>
            <th class="px-4 py-3 text-right font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="employee in filtered" :key="employee.id" class="hover:bg-slate-50/60">
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {{ initials(employee.firstName, employee.lastName) }}
                </span>
                <div>
                  <p class="font-medium text-slate-900">
                    {{ employee.firstName }} {{ employee.lastName }}
                    <UBadge v-if="!employee.active" color="neutral" variant="subtle" size="xs">
                      Baja
                    </UBadge>
                  </p>
                  <p class="text-xs text-slate-500">{{ employee.email }}</p>
                </div>
              </div>
            </td>
            <td class="px-4 py-3">
              <span class="inline-flex items-center gap-1.5 text-slate-600">
                <span
                  class="size-2 rounded-full"
                  :style="{ backgroundColor: employee.departmentColor ?? '#cbd5e1' }"
                />
                {{ employee.departmentName ?? 'Sin departamento' }}
              </span>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ employee.position ?? '—' }}</td>
            <td class="px-4 py-3 text-slate-500">{{ formatDate(employee.startDate) }}</td>
            <td class="px-4 py-3 text-slate-500">{{ employee.weeklyHours }} h</td>
            <td class="px-4 py-3 font-mono text-xs text-slate-500">{{ employee.pin ?? '—' }}</td>
            <td class="px-4 py-3">
              <UBadge :color="roleColor(employee.role)" variant="subtle" size="sm">
                {{ roleLabel(employee.role) }}
              </UBadge>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center justify-end gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  aria-label="Editar empleado"
                  title="Editar"
                  @click="openEdit(employee)"
                />
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-user-x"
                  aria-label="Dar de baja"
                  title="Dar de baja"
                  :disabled="!employee.active"
                  @click="deactivate(employee)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="filtered.length === 0" class="px-6 py-10 text-center text-sm text-slate-500">
        No hay empleados que coincidan con la búsqueda.
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-semibold text-slate-900">Cómo importar</h2>
        <ol class="mt-3 space-y-2 text-sm text-slate-600">
          <li>1. Descarga la plantilla Excel.</li>
          <li>2. Rellena una fila por empleado (el email identifica si se crea o actualiza).</li>
          <li>3. Añade los festivos del año en la hoja Festivos.</li>
          <li>4. Sube el archivo con el botón Importar.</li>
        </ol>
        <p class="mt-3 text-xs text-slate-400">
          Los departamentos nuevos se crean automáticamente. Los saldos iniciales se pueden dejar vacíos
          para calcularlos según el convenio configurado.
        </p>
      </div>

      <div v-if="isAdmin" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-semibold text-slate-900">Acceso de administración</h2>
        <p class="mt-2 text-sm text-slate-600">
          Solo las cuentas con rol <strong>Administración</strong> pueden cambiar la configuración de
          vacaciones, ver la auditoría e importar plantilla.
        </p>
        <UButton :to="localePath('/ajustes')" class="mt-4" variant="soft" icon="i-lucide-settings">
          Ir a ajustes
        </UButton>
      </div>
    </div>

    <UModal v-model:open="editOpen" title="Editar empleado">
      <template #body>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Nombre</label>
            <UInput v-model="editForm.firstName" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Apellidos</label>
            <UInput v-model="editForm.lastName" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Email</label>
            <UInput v-model="editForm.email" type="email" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Teléfono</label>
            <UInput v-model="editForm.phone" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Puesto</label>
            <UInput v-model="editForm.position" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Departamento</label>
            <select
              v-model="editForm.departmentId"
              class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Sin departamento</option>
              <option
                v-for="department in departments ?? []"
                :key="department.id"
                :value="department.id"
              >
                {{ department.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Fecha de alta</label>
            <UInput v-model="editForm.startDate" type="date" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-600">Horas semanales</label>
            <UInput v-model.number="editForm.weeklyHours" type="number" min="0" max="60" class="w-full" />
          </div>
          <div class="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 sm:col-span-2">
            <div>
              <p class="text-sm font-medium text-slate-800">Empleado activo</p>
              <p class="text-xs text-slate-500">Desactívalo para reflejar una baja sin borrar el histórico.</p>
            </div>
            <USwitch v-model="editForm.active" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="editOpen = false">Cancelar</UButton>
          <UButton :loading="savingEdit" icon="i-lucide-save" @click="saveEdit">Guardar</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
