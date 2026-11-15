import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'
import * as schema from './schema'

/**
 * Cliente de base de datos del runtime (Nitro).
 *
 * Usa el driver **serverless de Neon** (`@neondatabase/serverless` + WebSocket),
 * que funciona tanto en Node (dev/SSR) como en Cloudflare Workers/Pages.
 *
 * Motivo: `pg` abre TCP crudo y no es fiable en Cloudflare Workers. El driver
 * serverless mantiene la misma API de Drizzle (incluidas las transacciones vía
 * `drizzle-orm/neon-serverless`) y habla con Neon por WebSocket.
 *
 * Los scripts de migración/seed/reset siguen usando `./client-pg` (node-postgres),
 * porque el migrador de Drizzle necesita el driver Node.
 *
 * En Cloudflare el `DATABASE_URL` se toma del entorno del Worker (con
 * `nodejs_compat`, las variables/secretos están disponibles en `process.env`).
 */
export type Db = NeonDatabase<typeof schema>

let pool: Pool | null = null
let db: Db | null = null

export function createDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida. Configura la cadena de conexión de Neon en el entorno.',
    )
  }

  pool = new Pool({ connectionString })
  db = drizzle(pool, { schema })
  return db
}

export function getDb(): Db {
  return db ?? createDb()
}

export async function closeDb() {
  await pool?.end()
  pool = null
  db = null
}
