import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * Cliente PostgreSQL "clásico" (node-postgres) para scripts y migraciones.
 *
 * Se usa SOLO en procesos Node (migrate/seed/reset/tests), que necesitan el
 * migrador de drizzle sobre `pg`. El runtime de la app usa `./client`
 * (driver serverless de Neon), que funciona tanto en Node como en Cloudflare.
 */
export type PgDb = NodePgDatabase<typeof schema>

let pool: Pool | null = null
let db: PgDb | null = null

function sslFor(connectionString: string) {
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(connectionString)) return undefined
  // Neon exige TLS. El pooler usa certificados válidos, pero algunos entornos
  // intermedios no incluyen la CA; se mantiene el cifrado sin verificar la cadena.
  return { rejectUnauthorized: false }
}

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida. Configura la cadena de conexión de PostgreSQL/Neon en .env',
    )
  }

  return new Pool({
    connectionString,
    ssl: sslFor(connectionString),
    max: 10,
    idleTimeoutMillis: 30_000,
  })
}

export function createDb(connectionString = process.env.DATABASE_URL): PgDb {
  pool = createPool(connectionString)
  db = drizzle(pool, { schema })
  return db
}

export function getDb(): PgDb {
  return db ?? createDb()
}

export async function closeDb() {
  await pool?.end()
  pool = null
  db = null
}
