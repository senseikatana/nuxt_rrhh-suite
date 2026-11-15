import { randomUUID } from 'node:crypto'

/**
 * Normaliza el nombre de una empresa a un slug legible (sin acentos ni símbolos).
 * `Fundación Onada` -> `fundacion-onada`.
 */
export function slugifyOrgName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Identificador de organización con formato `org-<nombre>-<uuid>`.
 *
 * Incluye el nombre legible para poder identificar la empresa a simple vista y
 * un UUID para garantizar unicidad entre instalaciones y despliegues.
 */
export function generateOrgId(name: string, uuid: string = randomUUID()): string {
  return `org-${slugifyOrgName(name)}-${uuid}`
}
