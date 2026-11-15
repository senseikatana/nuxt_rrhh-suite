<script setup lang="ts">
/**
 * Botón flotante del asistente.
 *
 * Vive en el layout para estar disponible en cualquier página. A la derecha y
 * por encima de la barra de navegación móvil. Solo se muestra si la IA está
 * configurada y el usuario tiene permisos.
 *
 * Las secciones pueden abrirlo con contexto propio mediante `useAssistant()`.
 */
const route = useRoute()
const { ready, loaded, refresh } = useAiStatus()
const { open, module, prompt, nonce, close, toggle } = useAssistant()

// En la propia página del asistente el botón sería redundante.
const visible = computed(() => loaded.value && ready.value && route.path !== '/asistente')

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(
  () => route.path,
  () => close(),
)

onMounted(async () => {
  if (!loaded.value) await refresh()
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div v-if="visible">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="translate-y-2 opacity-0"
    >
      <section
        v-if="open"
        class="fixed inset-x-3 bottom-24 z-40 flex max-h-[72vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[400px]"
        role="dialog"
        aria-label="Asistente de contenido"
      >
        <header class="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
          <div class="flex items-center gap-2">
            <span class="rounded-lg bg-sky-100 p-1.5 text-sky-700">
              <UIcon name="i-lucide-sparkles" class="size-4" />
            </span>
            <div>
              <p class="text-sm font-semibold text-slate-900">Asistente</p>
              <p class="text-[11px] text-slate-500">
                {{ module ? `Sección: ${module}` : 'Crea y edita contenido del sitio' }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="tap-target rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar asistente"
            @click="close"
          >
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <AiChatPanel
          compact
          :module="module"
          :seed-prompt="prompt"
          :seed-nonce="nonce"
          @changed="() => {}"
        />
      </section>
    </Transition>

    <button
      type="button"
      class="fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/30 transition hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
      :aria-expanded="open"
      aria-label="Abrir asistente de contenido"
      @click="toggle"
    >
      <UIcon :name="open ? 'i-lucide-x' : 'i-lucide-sparkles'" class="size-6" />
    </button>
  </div>
</template>
