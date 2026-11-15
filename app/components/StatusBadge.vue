<script setup lang="ts">
const props = defineProps<{ status: string }>()

const map: Record<string, { label: string; color: 'warning' | 'success' | 'error' | 'neutral' | 'info' }> = {
  // Permisos
  draft: { label: 'Borrador', color: 'neutral' },
  pending: { label: 'Pendiente', color: 'warning' },
  approved: { label: 'Aprobada', color: 'success' },
  rejected: { label: 'Rechazada', color: 'error' },
  cancelled: { label: 'Cancelada', color: 'neutral' },
  // Gastos
  submitted: { label: 'Enviado', color: 'warning' },
  reimbursed: { label: 'Reembolsado', color: 'success' },
  // Nóminas
  open: { label: 'Abierto', color: 'success' },
  closed: { label: 'Cerrado', color: 'neutral' },
  // Reclutamiento
  published: { label: 'Publicada', color: 'success' },
  new: { label: 'Nueva', color: 'warning' },
  screening: { label: 'Cribado', color: 'info' },
  interview: { label: 'Entrevista', color: 'warning' },
  offer: { label: 'Oferta', color: 'success' },
  hired: { label: 'Contratado', color: 'success' },
  // Denuncias
  in_review: { label: 'En revisión', color: 'warning' },
  resolved: { label: 'Resuelta', color: 'success' },
}

const item = computed(() => map[props.status] ?? { label: props.status, color: 'neutral' as const })
</script>

<template>
  <UBadge :color="item.color" variant="subtle" size="sm">{{ item.label }}</UBadge>
</template>
