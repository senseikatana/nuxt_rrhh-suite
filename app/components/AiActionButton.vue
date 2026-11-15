<script setup lang="ts">
/**
 * Abre el asistente flotante con el contexto de la sección actual.
 * Si la IA no está configurada, no se muestra: no dejamos un botón muerto.
 */
import type { AssistantModule } from '~/composables/useAssistant'

const props = withDefaults(
  defineProps<{
    module: AssistantModule
    prompt: string
    label?: string
    size?: 'xs' | 'sm' | 'md' | 'lg'
  }>(),
  { label: 'IA', size: 'md' },
)

const { openWith } = useAssistant()
const { ready } = useAiStatus()

function open() {
  openWith({ module: props.module, prompt: props.prompt })
}
</script>

<template>
  <UButton
    v-if="ready"
    color="neutral"
    variant="soft"
    icon="i-lucide-sparkles"
    :size="size"
    :aria-label="`Crear con IA: ${label}`"
    @click="open"
  >
    {{ label }}
  </UButton>
</template>
