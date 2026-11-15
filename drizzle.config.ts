// Drizzle Kit lee la cadena de Neon desde .env (DATABASE_URL, endpoint -pooler).
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/rrhh',
  },
  // Misma tabla que usa el migrador en runtime; así `drizzle-kit` y la app
  // comparten el registro de migraciones aplicadas.
  migrations: {
    table: '__drizzle_migrations',
    schema: 'drizzle',
  },
  verbose: true,
  strict: true,
})
