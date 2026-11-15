/**
 * Herramientas del asistente de contenido.
 *
 * El modelo NUNCA toca la base de datos directamente: solo puede invocar estas
 * herramientas, cada una valida sus argumentos con zod y opera siempre dentro
 * de la organización del usuario. Cada acción de escritura queda auditada.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { z } from 'zod'
import type { Db } from '../../database/client'
import * as schema from '../../database/schema'
import { recordAudit } from '../../utils/audit'
import type { Role } from '../../utils/session'
import type { ToolSpec } from './client'

export interface ToolContext {
  db: Db
  user: { id: string; name: string; role: Role }
  employee?: { id: string } | null
  org: { id: string; name: string }
  event: H3Event
}

export interface ToolResult {
  summary: string
  data?: unknown
}

interface ToolDefinition {
  spec: ToolSpec
  mutate: boolean
  run: (ctx: ToolContext, args: unknown) => Promise<ToolResult>
}

const CONTENT_KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/

const contentKeySchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    CONTENT_KEY,
    'La clave debe tener formato tipo "dashboard.banner" o "site.footer" (minúsculas, números, punto o guion).',
  )

/** Acepta los argumentos como objeto o como string JSON (según el modelo). */
function parseArgs(args: unknown): unknown {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args)
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Argumentos de herramienta inválidos (JSON)' })
    }
  }
  return args ?? {}
}

function validationError(error: z.ZodError) {
  return createError({
    statusCode: 400,
    statusMessage: error.issues.map((issue) => issue.message).join('. '),
  })
}

/* ------------------------------------------------------------------ */
/* Contenido del sitio                                                */
/* ------------------------------------------------------------------ */

const upsertContentSchema = z.object({
  key: contentKeySchema,
  body: z.string().min(1, 'El cuerpo no puede estar vacío').max(5000),
  title: z.string().max(160).nullable().optional(),
  locale: z.string().min(2).max(5).default('es'),
})

const deleteContentSchema = z.object({
  key: contentKeySchema,
  locale: z.string().min(2).max(5).default('es'),
})

const listContentSchema = z.object({
  prefix: z.string().max(40).optional(),
})

/* ------------------------------------------------------------------ */
/* Reclutamiento                                                      */
/* ------------------------------------------------------------------ */

const createJobSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(5000),
  department: z.string().max(80).nullable().optional(),
  publish: z.boolean().default(true),
})

const updateJobSchema = z.object({
  id: z.string().min(1).optional(),
  titleMatch: z.string().min(3).max(120).optional(),
  newTitle: z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(5000).optional(),
  status: z.enum(['draft', 'published', 'closed']).optional(),
})

/* ------------------------------------------------------------------ */

export const TOOLS: Record<string, ToolDefinition> = {
  list_content: {
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_content',
        description:
          'Lista los bloques de contenido editables del sitio (clave, título y texto). Úsalo antes de modificar algo existente.',
        parameters: {
          type: 'object',
          properties: {
            prefix: { type: 'string', description: 'Filtra por prefijo, por ejemplo "dashboard"' },
          },
        },
      },
    },
    async run(ctx, raw) {
      const args = listContentSchema.parse(parseArgs(raw))
      const rows = await ctx.db
        .select()
        .from(schema.contentBlocks)
        .where(eq(schema.contentBlocks.orgId, ctx.org.id))
        .orderBy(desc(schema.contentBlocks.updatedAt))

      const filtered = args.prefix
        ? rows.filter((row) => row.key.startsWith(args.prefix!))
        : rows

      return {
        summary: `${filtered.length} bloque(s) de contenido`,
        data: filtered.map((row) => ({
          key: row.key,
          locale: row.locale,
          title: row.title,
          body: row.body,
        })),
      }
    },
  },

  upsert_content: {
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'upsert_content',
        description:
          'Crea o actualiza un bloque de contenido del sitio. Si la clave ya existe, la sobrescribe. Claves habituales: dashboard.banner, dashboard.welcome, site.footer, policy.vacaciones.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Clave estable, p. ej. "dashboard.banner"' },
            title: { type: 'string', description: 'Título opcional del bloque' },
            body: { type: 'string', description: 'Texto completo del bloque' },
            locale: { type: 'string', description: 'Idioma, por defecto "es"' },
          },
          required: ['key', 'body'],
        },
      },
    },
    async run(ctx, raw) {
      const args = upsertContentSchema.safeParse(parseArgs(raw))
      if (!args.success) throw validationError(args.error)
      const { key, body, title, locale } = args.data

      const [existing] = await ctx.db
        .select()
        .from(schema.contentBlocks)
        .where(
          and(
            eq(schema.contentBlocks.orgId, ctx.org.id),
            eq(schema.contentBlocks.key, key),
            eq(schema.contentBlocks.locale, locale),
          ),
        )
        .limit(1)

      const now = new Date()

      if (existing) {
        await ctx.db
          .update(schema.contentBlocks)
          .set({ title: title ?? existing.title, body, updatedBy: ctx.user.id, updatedAt: now })
          .where(eq(schema.contentBlocks.id, existing.id))
        return { summary: `Contenido "${key}" actualizado`, data: { key, locale, updated: true } }
      }

      await ctx.db.insert(schema.contentBlocks).values({
        id: crypto.randomUUID(),
        orgId: ctx.org.id,
        key,
        locale,
        title: title ?? null,
        body,
        updatedBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      })

      return { summary: `Contenido "${key}" creado`, data: { key, locale, updated: false } }
    },
  },

  delete_content: {
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'delete_content',
        description: 'Elimina un bloque de contenido del sitio por su clave.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Clave del bloque a eliminar' },
            locale: { type: 'string', description: 'Idioma, por defecto "es"' },
          },
          required: ['key'],
        },
      },
    },
    async run(ctx, raw) {
      const args = deleteContentSchema.safeParse(parseArgs(raw))
      if (!args.success) throw validationError(args.error)
      const { key, locale } = args.data

      const deleted = await ctx.db
        .delete(schema.contentBlocks)
        .where(
          and(
            eq(schema.contentBlocks.orgId, ctx.org.id),
            eq(schema.contentBlocks.key, key),
            eq(schema.contentBlocks.locale, locale),
          ),
        )
        .returning({ id: schema.contentBlocks.id })

      if (!deleted.length) {
        throw createError({ statusCode: 404, statusMessage: `No existe el contenido "${key}"` })
      }
      return { summary: `Contenido "${key}" eliminado`, data: { key, locale } }
    },
  },

  list_job_postings: {
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_job_postings',
        description: 'Lista las ofertas de empleo de la empresa con su id y estado.',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run(ctx) {
      const rows = await ctx.db
        .select({
          id: schema.jobPostings.id,
          title: schema.jobPostings.title,
          status: schema.jobPostings.status,
          publishedAt: schema.jobPostings.publishedAt,
        })
        .from(schema.jobPostings)
        .where(eq(schema.jobPostings.orgId, ctx.org.id))
        .orderBy(desc(schema.jobPostings.publishedAt))

      return { summary: `${rows.length} oferta(s)`, data: rows }
    },
  },

  create_job_posting: {
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_job_posting',
        description:
          'Crea una oferta de empleo publicada en la sección de reclutamiento del sitio.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Título del puesto' },
            description: {
              type: 'string',
              description: 'Descripción completa: funciones, requisitos y condiciones',
            },
            department: {
              type: 'string',
              description: 'Nombre del departamento; si no existe se deja sin asignar',
            },
            publish: { type: 'boolean', description: 'Publicar ya (por defecto sí)' },
          },
          required: ['title', 'description'],
        },
      },
    },
    async run(ctx, raw) {
      const args = createJobSchema.safeParse(parseArgs(raw))
      if (!args.success) throw validationError(args.error)
      const { title, description, department, publish } = args.data

      let departmentId: string | null = null
      if (department) {
        const [found] = await ctx.db
          .select({ id: schema.departments.id })
          .from(schema.departments)
          .where(
            and(
              eq(schema.departments.orgId, ctx.org.id),
              sql`lower(${schema.departments.name}) = lower(${department})`,
            ),
          )
          .limit(1)
        departmentId = found?.id ?? null
      }

      const id = crypto.randomUUID()
      const now = new Date()
      await ctx.db.insert(schema.jobPostings).values({
        id,
        orgId: ctx.org.id,
        title,
        description,
        departmentId,
        status: publish ? 'published' : 'draft',
        publishedAt: publish ? now : null,
        closesAt: null,
      })

      return {
        summary: `Oferta "${title}" ${publish ? 'publicada' : 'guardada como borrador'}`,
        data: { id, title, status: publish ? 'published' : 'draft', departmentId },
      }
    },
  },

  update_job_posting: {
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'update_job_posting',
        description:
          'Actualiza una oferta de empleo existente (título, descripción o estado). Identifícala por id o por su título actual.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Id de la oferta (recomendado)' },
            titleMatch: { type: 'string', description: 'Título exacto actual, si no hay id' },
            newTitle: { type: 'string', description: 'Nuevo título' },
            description: { type: 'string', description: 'Nueva descripción completa' },
            status: {
              type: 'string',
              enum: ['draft', 'published', 'closed'],
              description: 'Nuevo estado',
            },
          },
        },
      },
    },
    async run(ctx, raw) {
      const args = updateJobSchema.safeParse(parseArgs(raw))
      if (!args.success) throw validationError(args.error)
      const { id, titleMatch, newTitle, description, status } = args.data

      if (!id && !titleMatch) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Indica el id de la oferta o su título actual (titleMatch)',
        })
      }

      const [job] = await ctx.db
        .select()
        .from(schema.jobPostings)
        .where(
          and(
            eq(schema.jobPostings.orgId, ctx.org.id),
            id
              ? eq(schema.jobPostings.id, id)
              : sql`lower(${schema.jobPostings.title}) = lower(${titleMatch})`,
          ),
        )
        .limit(1)

      if (!job) throw createError({ statusCode: 404, statusMessage: 'Oferta no encontrada' })

      const patch: Partial<typeof schema.jobPostings.$inferInsert> = {}
      if (newTitle) patch.title = newTitle
      if (description) patch.description = description
      if (status) {
        patch.status = status
        if (status === 'published' && !job.publishedAt) patch.publishedAt = new Date()
      }

      if (!Object.keys(patch).length) {
        throw createError({ statusCode: 400, statusMessage: 'Nada que actualizar' })
      }

      await ctx.db.update(schema.jobPostings).set(patch).where(eq(schema.jobPostings.id, job.id))

      return {
        summary: `Oferta "${patch.title ?? job.title}" actualizada`,
        data: { id: job.id, ...patch },
      }
    },
  },

  list_departments: {
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_departments',
        description: 'Lista los departamentos de la empresa (para asignar una oferta o contenido).',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run(ctx) {
      const rows = await ctx.db
        .select({ id: schema.departments.id, name: schema.departments.name })
        .from(schema.departments)
        .where(eq(schema.departments.orgId, ctx.org.id))
      return { summary: `${rows.length} departamento(s)`, data: rows }
    },
  },
}

export function toolSpecs(): ToolSpec[] {
  return Object.values(TOOLS).map((tool) => tool.spec)
}

/** Ejecuta una herramienta por nombre, auditando las que escriben. */
export async function runTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOLS[name]
  if (!tool) {
    throw createError({ statusCode: 400, statusMessage: `Herramienta desconocida: ${name}` })
  }

  const result = await tool.run(ctx, rawArgs)

  if (tool.mutate) {
    await recordAudit(
      ctx.db,
      {
        orgId: ctx.org.id,
        actorUserId: ctx.user.id,
        action: `ai.tool.${name}`,
        entity: 'ai_agent',
        entityId: null,
        after: { tool: name, args: parseArgs(rawArgs), summary: result.summary },
      },
      ctx.event,
    )
  }

  return result
}
