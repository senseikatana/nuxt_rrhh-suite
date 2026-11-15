import { migrate } from 'drizzle-orm/neon-serverless/migrator'
import { resolve } from 'node:path'

/**
 * Aplica las migraciones pendientes al arrancar el servidor.
 * Es idempotente: Drizzle registra lo aplicado en drizzle.__drizzle_migrations.
 *
 * Usa el migrador del driver de Neon (el mismo que la app) para no mezclar
 * clientes. Se puede desactivar con `DB_AUTO_MIGRATE=false` cuando las
 * migraciones se ejecutan como paso de despliegue (`bun run db:migrate`).
 */
export default defineNitroPlugin(async () => {
  if (process.env.DB_AUTO_MIGRATE === 'false') {
    console.log('[db] Migraciones automáticas desactivadas (DB_AUTO_MIGRATE=false)')
    return
  }

  const db = useDb()
  const folder = process.env.MIGRATIONS_PATH || resolve(process.cwd(), 'server/database/migrations')

  try {
    await migrate(db, { migrationsFolder: folder })
  } catch (error) {
    console.error('[db] No se pudieron aplicar las migraciones:', error)
    throw error
  }
})
