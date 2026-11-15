export interface AiStatus {
  configured: boolean
  model: string
  host: string
  canUse: boolean
}

/**
 * Estado del asistente compartido entre la página y el botón flotante, para no
 * pedir `/api/ai/status` dos veces ni mostrar estados distintos.
 */
export function useAiStatus() {
  const status = useState<AiStatus | null>('ai-status', () => null)
  const loaded = useState<boolean>('ai-status-loaded', () => false)
  const requestFetch = useRequestFetch()

  async function refresh() {
    try {
      status.value = await requestFetch<AiStatus>('/api/ai/status')
    } catch {
      status.value = null
    } finally {
      loaded.value = true
    }
    return status.value
  }

  const ready = computed(() => Boolean(status.value?.configured && status.value?.canUse))

  return { status, loaded, ready, refresh }
}
