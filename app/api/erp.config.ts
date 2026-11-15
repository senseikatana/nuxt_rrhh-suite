import { defineApiConfig } from 'katanakit-js'

/**
 * Registro de la API ERP con katanakit-js.
 *
 * Los endpoints son las rutas Nitro same-origin de `server/api/erp/*`. El
 * cliente de katanakit-js devuelve siempre un `SafeResult` (`{ ok, data, error }`)
 * y nunca lanza en trabajo async, así el manejo de errores queda en el `if (ok)`.
 *
 * `baseUri` se declara relativa aquí, pero katanakit construye la URL con
 * `new URL(base + path)`, que exige un origen absoluto. `useErpApi()` vuelve a
 * registrar la config con el origin real de la petición; si se dejara relativa,
 * todas las llamadas fallarían con "Failed to construct 'URL': Invalid URL".
 */
export const erpApiConfig = {
  baseUri: '/api/erp',
  endpoints: {
    // Dashboard
    dashboardSummary: '/dashboard/summary',

    // Ventas
    salesOrders: '/sales/orders',
    salesOrder: '/sales/orders/:id',
    salesOrderStatus: '/sales/orders/:id/status',

    // Compras
    purchaseOrders: '/purchases/orders',
    purchaseOrder: '/purchases/orders/:id',
    purchaseReceive: '/purchases/orders/:id/receive',
    purchaseQuality: '/purchases/orders/:id/quality',

    // Almacén
    items: '/warehouse/items',
    item: '/warehouse/items/:id',
    itemAdjust: '/warehouse/items/:id/adjust',

    // Terceros
    customers: '/customers',
    customer: '/customers/:id',
    vendors: '/vendors',
    vendor: '/vendors/:id',

    // Planificación
    demand: '/demand',
    demandGenerate: '/demand/generate',
    routes: '/routes',

    // Actividad
    activity: '/activity',
  },
}

export default defineApiConfig({ erp: erpApiConfig })
