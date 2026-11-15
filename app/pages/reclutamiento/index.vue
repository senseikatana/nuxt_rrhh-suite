<script setup lang="ts">
interface Job {
  id: string
  title: string
  description: string
  departmentId: string | null
  departmentName: string | null
  status: 'draft' | 'published' | 'closed'
  publishedAt: string | null
  closesAt: string | null
  candidates: Record<string, number>
  candidateCount: number
}

interface Candidate {
  id: string
  jobPostingId: string
  jobTitle: string
  name: string
  email: string
  phone: string | null
  stage: 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'
  notes: string | null
  createdAt: string
}

interface Department {
  id: string
  name: string
}

const { isManager } = useSession()
const toast = useToast()
const { confirm } = useDialogs()

const jobs = ref<Job[]>([])
const candidates = ref<Candidate[]>([])
const departments = ref<Department[]>([])
const selectedJobId = ref<string | null>(null)
const loading = ref(true)
const loadingCandidates = ref(false)
const error = ref('')
const jobFormOpen = ref(false)
const candidateFormOpen = ref(false)
const saving = ref(false)

const stages = [
  { value: 'new', label: 'Nuevo' },
  { value: 'screening', label: 'Cribado' },
  { value: 'interview', label: 'Entrevista' },
  { value: 'offer', label: 'Oferta' },
  { value: 'hired', label: 'Contratado' },
  { value: 'rejected', label: 'Rechazado' },
] as const

const jobForm = reactive({
  title: '',
  description: '',
  departmentId: '',
  closesAt: '',
  publish: true,
})

const candidateForm = reactive({
  name: '',
  email: '',
  phone: '',
  notes: '',
})

function errorMessage(e: unknown) {
  const err = e as { statusMessage?: string; data?: { message?: string; statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Error inesperado'
}

const selectedJob = computed(() => jobs.value.find((job) => job.id === selectedJobId.value) ?? null)
const openPositions = computed(() => jobs.value.filter((job) => job.status === 'published').length)
const totalCandidates = computed(() => jobs.value.reduce((sum, job) => sum + job.candidateCount, 0))

async function loadJobs() {
  loading.value = true
  error.value = ''
  try {
    jobs.value = await $fetch<Job[]>('/api/recruitment/jobs')
    if (!selectedJobId.value && jobs.value.length) selectedJobId.value = jobs.value[0].id
    if (selectedJobId.value) await loadCandidates(selectedJobId.value)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

async function loadCandidates(jobId: string) {
  selectedJobId.value = jobId
  loadingCandidates.value = true
  try {
    candidates.value = await $fetch<Candidate[]>('/api/recruitment/candidates', {
      query: { jobPostingId: jobId },
    })
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    loadingCandidates.value = false
  }
}

async function createJob() {
  if (jobForm.title.trim().length < 3 || jobForm.description.trim().length < 10) {
    toast.add({ title: 'Título y descripción son obligatorios', color: 'error' })
    return
  }
  saving.value = true
  try {
    await $fetch('/api/recruitment/jobs', {
      method: 'POST',
      body: {
        title: jobForm.title,
        description: jobForm.description,
        departmentId: jobForm.departmentId || null,
        closesAt: jobForm.closesAt || null,
        publish: jobForm.publish,
      },
    })
    toast.add({ title: 'Oferta creada', color: 'success' })
    jobFormOpen.value = false
    jobForm.title = ''
    jobForm.description = ''
    jobForm.departmentId = ''
    jobForm.closesAt = ''
    await loadJobs()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function setJobStatus(job: Job, status: 'draft' | 'published' | 'closed') {
  if (status === 'closed') {
    const ok = await confirm({
      title: 'Cerrar oferta',
      description: `Se cerrará "${job.title}" y no admitirá nuevas candidaturas.`,
      danger: true,
      confirmLabel: 'Cerrar oferta',
    })
    if (!ok) return
  }
  try {
    await $fetch(`/api/recruitment/jobs/${job.id}`, { method: 'PATCH', body: { status } })
    toast.add({ title: 'Oferta actualizada', color: 'success' })
    await loadJobs()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

async function createCandidate() {
  if (!selectedJobId.value) return
  if (candidateForm.name.trim().length < 2 || !candidateForm.email.includes('@')) {
    toast.add({ title: 'Nombre y email válidos son obligatorios', color: 'error' })
    return
  }
  saving.value = true
  try {
    await $fetch('/api/recruitment/candidates', {
      method: 'POST',
      body: {
        jobPostingId: selectedJobId.value,
        name: candidateForm.name,
        email: candidateForm.email,
        phone: candidateForm.phone || undefined,
        notes: candidateForm.notes || undefined,
      },
    })
    toast.add({ title: 'Candidatura registrada', color: 'success' })
    candidateFormOpen.value = false
    candidateForm.name = ''
    candidateForm.email = ''
    candidateForm.phone = ''
    candidateForm.notes = ''
    await loadCandidates(selectedJobId.value)
    await loadJobs()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function moveStage(candidate: Candidate, stage: Candidate['stage']) {
  if (candidate.stage === stage) return
  try {
    await $fetch(`/api/recruitment/candidates/${candidate.id}`, {
      method: 'PATCH',
      body: { stage },
    })
    candidate.stage = stage
    toast.add({ title: 'Etapa actualizada', color: 'success' })
    await loadJobs()
  } catch (e) {
    toast.add({ title: errorMessage(e), color: 'error' })
  }
}

onMounted(async () => {
  if (isManager.value) {
    try {
      departments.value = await $fetch<Department[]>('/api/departments')
    } catch {
      departments.value = []
    }
  }
  await loadJobs()
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Reclutamiento"
      subtitle="Ofertas publicadas, candidaturas y proceso de selección por etapas."
    >
      <UButton icon="i-lucide-plus" @click="jobFormOpen = !jobFormOpen">Nueva oferta</UButton>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-3">
      <StatCard label="Ofertas" :value="jobs.length" hint="totales" icon="i-lucide-briefcase" tone="sky" />
      <StatCard label="Publicadas" :value="openPositions" hint="abiertas a candidaturas" icon="i-lucide-megaphone" tone="emerald" />
      <StatCard label="Candidaturas" :value="totalCandidates" hint="recibidas" icon="i-lucide-users" tone="violet" />
    </div>

    <!-- Alta de oferta -->
    <div v-if="jobFormOpen && isManager" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 class="text-sm font-semibold text-slate-900">Nueva oferta</h2>
      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <input v-model="jobForm.title" placeholder="Título del puesto" class="rounded-lg border border-slate-300 px-3 py-2 text-sm lg:col-span-2" >
        <textarea
          v-model="jobForm.description"
          rows="4"
          placeholder="Descripción, requisitos y condiciones"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
        />
        <select v-model="jobForm.departmentId" class="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Sin departamento</option>
          <option v-for="department in departments" :key="department.id" :value="department.id">
            {{ department.name }}
          </option>
        </select>
        <input v-model="jobForm.closesAt" type="date" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" >
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="jobForm.publish" type="checkbox" class="size-4 rounded border-slate-300" >
          Publicar al guardar
        </label>
        <div class="flex justify-end gap-2 lg:col-span-2">
          <UButton color="neutral" variant="ghost" @click="jobFormOpen = false">Cancelar</UButton>
          <UButton :loading="saving" icon="i-lucide-check" @click="createJob">Guardar</UButton>
        </div>
      </div>
    </div>

    <p v-if="error" class="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

    <div v-if="loading" class="py-10 text-center text-sm text-slate-500">Cargando ofertas…</div>

    <EmptyState
      v-else-if="!jobs.length"
      icon="i-lucide-briefcase"
      title="Sin ofertas"
      description="Crea una oferta para empezar a recibir candidaturas."
    />

    <div v-else class="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div class="space-y-2">
        <button
          v-for="job in jobs"
          :key="job.id"
          type="button"
          class="w-full rounded-xl border p-3 text-left transition"
          :class="
            selectedJobId === job.id
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          "
          @click="loadCandidates(job.id)"
        >
          <div class="flex items-start justify-between gap-2">
            <span class="text-sm font-semibold">{{ job.title }}</span>
            <StatusBadge :status="job.status" />
          </div>
          <p class="mt-1 text-xs" :class="selectedJobId === job.id ? 'text-slate-300' : 'text-slate-500'">
            {{ job.departmentName ?? 'General' }} · {{ job.candidateCount }} candidaturas
          </p>
        </button>
      </div>

      <div class="space-y-4">
        <div v-if="selectedJob" class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">{{ selectedJob.title }}</h2>
              <p class="mt-1 max-w-2xl whitespace-pre-line text-sm text-slate-600">{{ selectedJob.description }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-if="selectedJob.status === 'draft'"
                size="xs"
                icon="i-lucide-megaphone"
                @click="setJobStatus(selectedJob, 'published')"
              >
                Publicar
              </UButton>
              <UButton
                v-if="selectedJob.status === 'published'"
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-archive"
                @click="setJobStatus(selectedJob, 'closed')"
              >
                Cerrar
              </UButton>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 class="text-sm font-semibold text-slate-900">Candidaturas</h2>
            <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-plus" @click="candidateFormOpen = !candidateFormOpen">
              Añadir
            </UButton>
          </div>

          <div v-if="candidateFormOpen" class="grid gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:grid-cols-2">
            <input v-model="candidateForm.name" placeholder="Nombre" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
            <input v-model="candidateForm.email" type="email" placeholder="Email" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
            <input v-model="candidateForm.phone" placeholder="Teléfono" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
            <input v-model="candidateForm.notes" placeholder="Notas" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" >
            <div class="flex justify-end gap-2 sm:col-span-2">
              <UButton size="xs" color="neutral" variant="ghost" @click="candidateFormOpen = false">Cancelar</UButton>
              <UButton size="xs" :loading="saving" icon="i-lucide-check" @click="createCandidate">Guardar</UButton>
            </div>
          </div>

          <div v-if="loadingCandidates" class="px-4 py-10 text-center text-sm text-slate-500">Cargando…</div>

          <EmptyState
            v-else-if="!candidates.length"
            icon="i-lucide-user-plus"
            title="Sin candidaturas"
            description="Añade la primera candidatura a esta oferta."
          />

          <ul v-else class="divide-y divide-slate-100">
            <li v-for="candidate in candidates" :key="candidate.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-900">{{ candidate.name }}</p>
                <p class="truncate text-xs text-slate-500">{{ candidate.email }}<span v-if="candidate.phone"> · {{ candidate.phone }}</span></p>
                <p v-if="candidate.notes" class="mt-1 text-xs text-slate-500">{{ candidate.notes }}</p>
              </div>
              <select
                :value="candidate.stage"
                class="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                @change="moveStage(candidate, ($event.target as HTMLSelectElement).value as Candidate['stage'])"
              >
                <option v-for="stage in stages" :key="stage.value" :value="stage.value">{{ stage.label }}</option>
              </select>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
