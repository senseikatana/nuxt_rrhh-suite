export type AssistantModule =
  | 'contenido'
  | 'empleados'
  | 'fichaje'
  | 'turnos'
  | 'gastos'
  | 'nominas'
  | 'reclutamiento'
  | 'vacaciones'
  | 'denuncias'

export interface OpenAssistantOptions {
  /** Sección desde la que se abre: filtra las herramientas del agente. */
  module?: AssistantModule
  /** Texto precargado en el campo de mensaje. */
  prompt?: string
}

/**
 * Estado global del asistente flotante.
 *
 * Cualquier sección puede abrirlo con su contexto y una petición precargada
 * (`openWith`), y el launcher del layout lo pinta. `nonce` permite reenviar el
 * mismo prompt dos veces seguidas y que se vuelva a aplicar.
 */
export function useAssistant() {
  const open = useState<boolean>('ai-panel-open', () => false)
  const module = useState<AssistantModule | null>('ai-panel-module', () => null)
  const prompt = useState<string>('ai-panel-prompt', () => '')
  const nonce = useState<number>('ai-panel-nonce', () => 0)

  function openWith(options: OpenAssistantOptions = {}) {
    module.value = options.module ?? null
    prompt.value = options.prompt ?? ''
    nonce.value += 1
    open.value = true
  }

  function close() {
    open.value = false
  }

  function toggle() {
    open.value = !open.value
  }

  return { open, module, prompt, nonce, openWith, close, toggle }
}
