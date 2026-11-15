<script setup lang="ts">
/**
 * `/erp` ya no es una pantalla.
 *
 * Se conserva solo como redirección para enlaces antiguos: entra directamente
 * al primer módulo que el rol ERP del usuario tenga permitido (Ventas para
 * admin/buyer/logistics, Compras para quality…). Así el menú no obliga a pasar
 * por un panel intermedio.
 */
definePageMeta({ layout: 'default' })

const erpSession = useErpSession()
const localePath = useLocalePath()

if (!erpSession.loaded.value) {
  await erpSession.refresh()
}

const firstModule = erpSession.navigation.value[0]
await navigateTo(
  firstModule ? localePath({ name: firstModule.routeName }) : localePath('/'),
  { replace: true },
)
</script>

<template>
  <p class="text-sm text-slate-500">Abriendo el módulo…</p>
</template>
