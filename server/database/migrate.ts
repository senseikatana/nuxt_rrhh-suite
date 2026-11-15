import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'
import { closeDb, createDb } from './client-pg'

const db = createDb()

await migrate(db, { migrationsFolder: resolve(import.meta.dir, 'migrations') })
await closeDb()

console.log('✓ Migraciones aplicadas en PostgreSQL')
