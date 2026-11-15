/**
 * Herramientas del asistente de contenido.
 *
 * El modelo NUNCA toca la base de datos directamente: solo puede invocar estas
 * herramientas, cada una valida sus argumentos con zod y opera siempre dentro
 * de la organización del usuario. Cada acción de escritura queda auditada.
 *
 * Cada herramienta declara un `module`, que permite filtrar el catálogo según
 * la sección desde la que se abre el asistente (Empleados, Turnos, Gastos…).
 * Así el modelo recibe 4-6 herramientas relevantes en vez de treinta.
 */
import { and, between, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { z } from 'zod'
import type { Db } from '../../database/client'
import * as schema from '../../database/schema'
import { countLeaveDays } from '../leave/working-days'
import { endOfLocalDay, startOfLocalDay, zonedDateTime } from '../attendance/time'
import { recordAudit } from '../../utils/audit'
import { getHolidayDates } from '../../utils/leave'
import { getSettingsForOrg } from '../../utils/hr'
import type { Role } from '../../utils/session'
import type { ToolSpec } from './client'

export type AiModule =
  | 'contenido'
  | 'empleados'
  | 'fichaje'
  | 'turnos'
  | 'gastos'
  | 'nominas'
  | 'reclutamiento'
  | 'vacaciones'
  | 'denuncias'

export interface ToolContext {
  db: Db
  user: { id: string; name: string; role: Role }
  employee?: { id: string } | null
  org: { id: string; name: string; timezone: string }
  event: H3Event
}

export interface ToolResult {
  summary: string
  data?: unknown
}

interface ToolDefinition {
  module: AiModule
  spec: ToolSpec
  mutate: boolean
  run: (ctx: ToolContext, args: unknown) => Promise<ToolResult>
}

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)')

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

function invalid(error: z.ZodError) {
  return createError({
    statusCode: 400,
    statusMessage: error.issues.map((issue) => issue.message).join('. '),
  })
}

async function findEmployee(
  ctx: ToolContext,
  ref: { id?: string | null; email?: string | null },
) {
  if (!ref.id && !ref.email) {
    throw createError({ statusCode: 400, statusMessage: 'Indica employeeEmail o employeeId' })
  }
  const [row] = await ctx.db
    .select()
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.orgId, ctx.org.id),
        ref.id
          ? eq(schema.employees.id, ref.id)
          : sql`lower(${schema.employees.email}) = lower(${ref.email})`,
      ),
    )
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Empleado no encontrado' })
  return row
}

async function findDepartment(ctx: ToolContext, name: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.departments)
    .where(
      and(
        eq(schema.departments.orgId, ctx.org.id),
        sql`lower(${schema.departments.name}) = lower(${name})`,
      ),
    )
    .limit(1)
  return row ?? null
}

async function findJob(ctx: ToolContext, ref: { id?: string | null; title?: string | null }) {
  if (!ref.id && !ref.title) {
    throw createError({ statusCode: 400, statusMessage: 'Indica el id o el título de la oferta' })
  }
  const [row] = await ctx.db
    .select()
    .from(schema.jobPostings)
    .where(
      and(
        eq(schema.jobPostings.orgId, ctx.org.id),
        ref.id
          ? eq(schema.jobPostings.id, ref.id)
          : sql`lower(${schema.jobPostings.title}) = lower(${ref.title})`,
      ),
    )
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Oferta no encontrada' })
  return row
}

/* ------------------------------------------------------------------ */
/* Contenido del sitio                                                */
/* ------------------------------------------------------------------ */

const CONTENT_KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const contentKey = z
  .string()
  .min(3)
  .max(80)
  .regex(CONTENT_KEY, 'Formato de clave: "dashboard.banner" (minúsculas, punto o guion)')

/* ------------------------------------------------------------------ */

export const TOOLS: Record<string, ToolDefinition> = {
  /* ---------------------------- Contenido ---------------------------- */
  list_content: {
    module: 'contenido',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_content',
        description: 'Lista los bloques de contenido editables del sitio.',
        parameters: {
          type: 'object',
          properties: { prefix: { type: 'string', description: 'Filtra por prefijo' } },
        },
      },
    },
    async run(ctx, raw) {
      const args = z.object({ prefix: z.string().max(40).optional() }).parse(parseArgs(raw))
      const rows = await ctx.db
        .select()
        .from(schema.contentBlocks)
        .where(eq(schema.contentBlocks.orgId, ctx.org.id))
        .orderBy(desc(schema.contentBlocks.updatedAt))
      const filtered = args.prefix ? rows.filter((r) => r.key.startsWith(args.prefix!)) : rows
      return {
        summary: `${filtered.length} bloque(s)`,
        data: filtered.map((r) => ({ key: r.key, locale: r.locale, title: r.title, body: r.body })),
      }
    },
  },

  upsert_content: {
    module: 'contenido',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'upsert_content',
        description:
          'Crea o actualiza un bloque de contenido del sitio. Claves habituales: dashboard.banner, dashboard.welcome, site.footer, policy.vacaciones.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Clave estable, p. ej. "dashboard.banner"' },
            title: { type: 'string', description: 'Título opcional' },
            body: { type: 'string', description: 'Texto completo' },
            locale: { type: 'string', description: 'Idioma, por defecto "es"' },
          },
          required: ['key', 'body'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          key: contentKey,
          body: z.string().min(1).max(5000),
          title: z.string().max(160).nullable().optional(),
          locale: z.string().min(2).max(5).default('es'),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)
      const { key, body, title, locale } = parsed.data

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
        return { summary: `Contenido "${key}" actualizado`, data: { key, updated: true } }
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
      return { summary: `Contenido "${key}" creado`, data: { key, updated: false } }
    },
  },

  delete_content: {
    module: 'contenido',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'delete_content',
        description: 'Elimina un bloque de contenido por su clave.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Clave del bloque' },
            locale: { type: 'string', description: 'Idioma, por defecto "es"' },
          },
          required: ['key'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ key: contentKey, locale: z.string().min(2).max(5).default('es') })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const deleted = await ctx.db
        .delete(schema.contentBlocks)
        .where(
          and(
            eq(schema.contentBlocks.orgId, ctx.org.id),
            eq(schema.contentBlocks.key, parsed.data.key),
            eq(schema.contentBlocks.locale, parsed.data.locale),
          ),
        )
        .returning({ id: schema.contentBlocks.id })

      if (!deleted.length) {
        throw createError({ statusCode: 404, statusMessage: `No existe "${parsed.data.key}"` })
      }
      return { summary: `Contenido "${parsed.data.key}" eliminado` }
    },
  },

  /* ---------------------------- Empleados ---------------------------- */
  list_employees: {
    module: 'empleados',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_employees',
        description: 'Lista los empleados con su id, email, departamento y estado.',
        parameters: {
          type: 'object',
          properties: { includeInactive: { type: 'boolean', description: 'Incluir bajas' } },
        },
      },
    },
    async run(ctx, raw) {
      const args = z.object({ includeInactive: z.boolean().default(false) }).parse(parseArgs(raw))
      const rows = await ctx.db
        .select({
          id: schema.employees.id,
          firstName: schema.employees.firstName,
          lastName: schema.employees.lastName,
          email: schema.employees.email,
          position: schema.employees.position,
          startDate: schema.employees.startDate,
          weeklyHours: schema.employees.weeklyHours,
          active: schema.employees.active,
          department: schema.departments.name,
        })
        .from(schema.employees)
        .leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
        .where(eq(schema.employees.orgId, ctx.org.id))
        .orderBy(schema.employees.lastName)

      const filtered = args.includeInactive ? rows : rows.filter((r) => r.active)
      return { summary: `${filtered.length} empleado(s)`, data: filtered }
    },
  },

  create_employee: {
    module: 'empleados',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_employee',
        description: 'Da de alta un empleado en la empresa.',
        parameters: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            position: { type: 'string', description: 'Puesto, p. ej. "Camarero/a"' },
            department: { type: 'string', description: 'Nombre del departamento' },
            startDate: { type: 'string', description: 'Fecha de alta YYYY-MM-DD' },
            weeklyHours: { type: 'number', description: 'Horas semanales, por defecto 40' },
          },
          required: ['firstName', 'lastName', 'email', 'startDate'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          firstName: z.string().min(1).max(60),
          lastName: z.string().min(1).max(60),
          email: z.string().email(),
          phone: z.string().max(40).nullable().optional(),
          position: z.string().max(80).nullable().optional(),
          department: z.string().max(80).nullable().optional(),
          startDate: ISO_DATE,
          weeklyHours: z.number().min(0).max(60).default(40),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)
      const data = parsed.data

      const [duplicate] = await ctx.db
        .select({ id: schema.employees.id })
        .from(schema.employees)
        .where(
          and(
            eq(schema.employees.orgId, ctx.org.id),
            sql`lower(${schema.employees.email}) = lower(${data.email})`,
          ),
        )
        .limit(1)
      if (duplicate) {
        throw createError({ statusCode: 409, statusMessage: `Ya existe un empleado con ${data.email}` })
      }

      const department = data.department ? await findDepartment(ctx, data.department) : null
      const id = crypto.randomUUID()
      const now = new Date()

      await ctx.db.insert(schema.employees).values({
        id,
        orgId: ctx.org.id,
        departmentId: department?.id ?? null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone ?? null,
        position: data.position ?? null,
        startDate: data.startDate,
        weeklyHours: data.weeklyHours,
        active: true,
        createdAt: now,
        updatedAt: now,
      })

      return {
        summary: `Empleado ${data.firstName} ${data.lastName} creado`,
        data: { id, departmentId: department?.id ?? null },
      }
    },
  },

  update_employee: {
    module: 'empleados',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'update_employee',
        description:
          'Actualiza un empleado (puesto, departamento, horas, contacto) o lo da de baja con active=false.',
        parameters: {
          type: 'object',
          properties: {
            employeeEmail: { type: 'string' },
            employeeId: { type: 'string' },
            position: { type: 'string' },
            department: { type: 'string' },
            phone: { type: 'string' },
            weeklyHours: { type: 'number' },
            active: { type: 'boolean' },
          },
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          employeeEmail: z.string().email().optional(),
          employeeId: z.string().optional(),
          position: z.string().max(80).optional(),
          department: z.string().max(80).optional(),
          phone: z.string().max(40).optional(),
          weeklyHours: z.number().min(0).max(60).optional(),
          active: z.boolean().optional(),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const employee = await findEmployee(ctx, {
        id: parsed.data.employeeId,
        email: parsed.data.employeeEmail,
      })

      const patch: Partial<typeof schema.employees.$inferInsert> = { updatedAt: new Date() }
      if (parsed.data.position !== undefined) patch.position = parsed.data.position
      if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone
      if (parsed.data.weeklyHours !== undefined) patch.weeklyHours = parsed.data.weeklyHours
      if (parsed.data.active !== undefined) patch.active = parsed.data.active
      if (parsed.data.department !== undefined) {
        const department = await findDepartment(ctx, parsed.data.department)
        if (!department) {
          throw createError({
            statusCode: 404,
            statusMessage: `No existe el departamento "${parsed.data.department}"`,
          })
        }
        patch.departmentId = department.id
      }

      await ctx.db.update(schema.employees).set(patch).where(eq(schema.employees.id, employee.id))

      return {
        summary: `Empleado ${employee.firstName} ${employee.lastName} actualizado`,
        data: { id: employee.id, ...patch },
      }
    },
  },

  list_departments: {
    module: 'empleados',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_departments',
        description: 'Lista los departamentos de la empresa.',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run(ctx) {
      const rows = await ctx.db
        .select({ id: schema.departments.id, name: schema.departments.name, minCoverage: schema.departments.minCoverage })
        .from(schema.departments)
        .where(eq(schema.departments.orgId, ctx.org.id))
      return { summary: `${rows.length} departamento(s)`, data: rows }
    },
  },

  create_department: {
    module: 'empleados',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_department',
        description: 'Crea un departamento nuevo.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            color: { type: 'string', description: 'Color hex, p. ej. #0ea5e9' },
            minCoverage: { type: 'number', description: 'Personas mínimas trabajando' },
          },
          required: ['name'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          name: z.string().min(2).max(60),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0ea5e9'),
          minCoverage: z.number().int().min(0).max(100).default(0),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      if (await findDepartment(ctx, parsed.data.name)) {
        throw createError({ statusCode: 409, statusMessage: 'Ese departamento ya existe' })
      }

      const id = crypto.randomUUID()
      await ctx.db.insert(schema.departments).values({
        id,
        orgId: ctx.org.id,
        name: parsed.data.name,
        color: parsed.data.color,
        minCoverage: parsed.data.minCoverage,
        createdAt: new Date(),
      })
      return { summary: `Departamento "${parsed.data.name}" creado`, data: { id } }
    },
  },

  /* ----------------------------- Fichaje ----------------------------- */
  list_clock_events: {
    module: 'fichaje',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_clock_events',
        description: 'Lista los fichajes de entrada/salida en un rango de fechas.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'YYYY-MM-DD' },
            to: { type: 'string', description: 'YYYY-MM-DD' },
            employeeEmail: { type: 'string' },
          },
          required: ['from', 'to'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ from: ISO_DATE, to: ISO_DATE, employeeEmail: z.string().email().optional() })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const conditions = [
        eq(schema.clockEvents.orgId, ctx.org.id),
        gte(schema.clockEvents.occurredAt, startOfLocalDay(parsed.data.from, ctx.org.timezone)),
        lt(schema.clockEvents.occurredAt, endOfLocalDay(parsed.data.to, ctx.org.timezone)),
      ]
      if (parsed.data.employeeEmail) {
        const employee = await findEmployee(ctx, { email: parsed.data.employeeEmail })
        conditions.push(eq(schema.clockEvents.employeeId, employee.id))
      }

      const rows = await ctx.db
        .select({
          employeeEmail: schema.employees.email,
          occurredAt: schema.clockEvents.occurredAt,
          direction: schema.clockEvents.direction,
          corrected: schema.clockEvents.corrected,
          note: schema.clockEvents.note,
        })
        .from(schema.clockEvents)
        .innerJoin(schema.employees, eq(schema.clockEvents.employeeId, schema.employees.id))
        .where(and(...conditions))
        .orderBy(schema.clockEvents.occurredAt)

      return { summary: `${rows.length} fichaje(s)`, data: rows }
    },
  },

  create_clock_event: {
    module: 'fichaje',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_clock_event',
        description:
          'Añade un fichaje manual (corrección) para un empleado en una fecha y hora concretas.',
        parameters: {
          type: 'object',
          properties: {
            employeeEmail: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            time: { type: 'string', description: 'HH:MM' },
            direction: { type: 'string', enum: ['in', 'out'] },
            note: { type: 'string', description: 'Motivo de la corrección' },
          },
          required: ['employeeEmail', 'date', 'time', 'direction'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          employeeEmail: z.string().email(),
          date: ISO_DATE,
          time: TIME,
          direction: z.enum(['in', 'out']),
          note: z.string().max(300).optional(),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const employee = await findEmployee(ctx, { email: parsed.data.employeeEmail })
      const occurredAt = zonedDateTime(parsed.data.date, parsed.data.time, ctx.org.timezone)

      await ctx.db.insert(schema.clockEvents).values({
        id: crypto.randomUUID(),
        orgId: ctx.org.id,
        employeeId: employee.id,
        occurredAt,
        direction: parsed.data.direction,
        source: 'web',
        corrected: true,
        note: parsed.data.note ?? 'Corrección vía asistente',
      })

      return {
        summary: `${parsed.data.direction === 'in' ? 'Entrada' : 'Salida'} de ${employee.firstName} el ${parsed.data.date} a las ${parsed.data.time}`,
      }
    },
  },

  /* ----------------------------- Turnos ------------------------------ */
  list_shift_patterns: {
    module: 'turnos',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_shift_patterns',
        description: 'Lista los turnos definidos (mañana, tarde, noche…).',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run(ctx) {
      const rows = await ctx.db
        .select({
          id: schema.shiftPatterns.id,
          name: schema.shiftPatterns.name,
          startTime: schema.shiftPatterns.startTime,
          endTime: schema.shiftPatterns.endTime,
          color: schema.shiftPatterns.color,
        })
        .from(schema.shiftPatterns)
        .where(eq(schema.shiftPatterns.orgId, ctx.org.id))
      return { summary: `${rows.length} turno(s)`, data: rows }
    },
  },

  create_shift_pattern: {
    module: 'turnos',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_shift_pattern',
        description: 'Crea un turno reutilizable con hora de inicio y fin.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Ej. "Mañana"' },
            startTime: { type: 'string', description: 'HH:MM' },
            endTime: { type: 'string', description: 'HH:MM' },
            color: { type: 'string', description: 'Color hex' },
          },
          required: ['name', 'startTime', 'endTime'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          name: z.string().min(2).max(40),
          startTime: TIME,
          endTime: TIME,
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const id = crypto.randomUUID()
      await ctx.db.insert(schema.shiftPatterns).values({
        id,
        orgId: ctx.org.id,
        name: parsed.data.name,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        color: parsed.data.color,
        departmentId: null,
      })
      return { summary: `Turno "${parsed.data.name}" creado`, data: { id } }
    },
  },

  delete_shift_pattern: {
    module: 'turnos',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'delete_shift_pattern',
        description: 'Elimina un turno por su nombre.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z.object({ name: z.string().min(2).max(40) }).safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const [pattern] = await ctx.db
        .select()
        .from(schema.shiftPatterns)
        .where(
          and(
            eq(schema.shiftPatterns.orgId, ctx.org.id),
            sql`lower(${schema.shiftPatterns.name}) = lower(${parsed.data.name})`,
          ),
        )
        .limit(1)
      if (!pattern) throw createError({ statusCode: 404, statusMessage: 'Turno no encontrado' })

      await ctx.db.delete(schema.shiftPatterns).where(eq(schema.shiftPatterns.id, pattern.id))
      return { summary: `Turno "${pattern.name}" eliminado` }
    },
  },

  list_shift_assignments: {
    module: 'turnos',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_shift_assignments',
        description: 'Lista las asignaciones de turno en un rango de fechas.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'YYYY-MM-DD' },
            to: { type: 'string', description: 'YYYY-MM-DD' },
            employeeEmail: { type: 'string' },
          },
          required: ['from', 'to'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ from: ISO_DATE, to: ISO_DATE, employeeEmail: z.string().email().optional() })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const conditions = [
        eq(schema.shiftAssignments.orgId, ctx.org.id),
        between(schema.shiftAssignments.date, parsed.data.from, parsed.data.to),
      ]
      if (parsed.data.employeeEmail) {
        const employee = await findEmployee(ctx, { email: parsed.data.employeeEmail })
        conditions.push(eq(schema.shiftAssignments.employeeId, employee.id))
      }

      const rows = await ctx.db
        .select({
          id: schema.shiftAssignments.id,
          date: schema.shiftAssignments.date,
          employeeEmail: schema.employees.email,
          pattern: schema.shiftPatterns.name,
          startTime: schema.shiftAssignments.startTime,
          endTime: schema.shiftAssignments.endTime,
        })
        .from(schema.shiftAssignments)
        .innerJoin(schema.employees, eq(schema.shiftAssignments.employeeId, schema.employees.id))
        .leftJoin(schema.shiftPatterns, eq(schema.shiftAssignments.patternId, schema.shiftPatterns.id))
        .where(and(...conditions))
        .orderBy(schema.shiftAssignments.date)

      return { summary: `${rows.length} asignación(es)`, data: rows }
    },
  },

  assign_shift: {
    module: 'turnos',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'assign_shift',
        description: 'Asigna un turno a un empleado en una fecha (crea o reemplaza).',
        parameters: {
          type: 'object',
          properties: {
            employeeEmail: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            patternName: { type: 'string', description: 'Nombre del turno' },
          },
          required: ['employeeEmail', 'date', 'patternName'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ employeeEmail: z.string().email(), date: ISO_DATE, patternName: z.string().min(2) })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const employee = await findEmployee(ctx, { email: parsed.data.employeeEmail })
      const [pattern] = await ctx.db
        .select()
        .from(schema.shiftPatterns)
        .where(
          and(
            eq(schema.shiftPatterns.orgId, ctx.org.id),
            sql`lower(${schema.shiftPatterns.name}) = lower(${parsed.data.patternName})`,
          ),
        )
        .limit(1)
      if (!pattern) throw createError({ statusCode: 404, statusMessage: 'Turno no encontrado' })

      const [existing] = await ctx.db
        .select()
        .from(schema.shiftAssignments)
        .where(
          and(
            eq(schema.shiftAssignments.employeeId, employee.id),
            eq(schema.shiftAssignments.date, parsed.data.date),
          ),
        )
        .limit(1)

      if (existing) {
        await ctx.db
          .update(schema.shiftAssignments)
          .set({ patternId: pattern.id, startTime: pattern.startTime, endTime: pattern.endTime })
          .where(eq(schema.shiftAssignments.id, existing.id))
      } else {
        await ctx.db.insert(schema.shiftAssignments).values({
          id: crypto.randomUUID(),
          orgId: ctx.org.id,
          employeeId: employee.id,
          date: parsed.data.date,
          patternId: pattern.id,
          startTime: pattern.startTime,
          endTime: pattern.endTime,
          notes: null,
        })
      }

      return {
        summary: `${employee.firstName} ${employee.lastName} → ${pattern.name} el ${parsed.data.date}`,
      }
    },
  },

  delete_shift_assignment: {
    module: 'turnos',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'delete_shift_assignment',
        description: 'Quita el turno de un empleado en una fecha.',
        parameters: {
          type: 'object',
          properties: {
            employeeEmail: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
          },
          required: ['employeeEmail', 'date'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ employeeEmail: z.string().email(), date: ISO_DATE })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const employee = await findEmployee(ctx, { email: parsed.data.employeeEmail })
      const deleted = await ctx.db
        .delete(schema.shiftAssignments)
        .where(
          and(
            eq(schema.shiftAssignments.orgId, ctx.org.id),
            eq(schema.shiftAssignments.employeeId, employee.id),
            eq(schema.shiftAssignments.date, parsed.data.date),
          ),
        )
        .returning({ id: schema.shiftAssignments.id })

      if (!deleted.length) {
        throw createError({ statusCode: 404, statusMessage: 'No había turno ese día' })
      }
      return { summary: `Turno de ${employee.firstName} el ${parsed.data.date} eliminado` }
    },
  },

  /* ----------------------------- Gastos ------------------------------ */
  list_expenses: {
    module: 'gastos',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_expenses',
        description: 'Lista las notas de gasto con su estado e importe.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'],
            },
          },
        },
      },
    },
    async run(ctx, raw) {
      const args = z
        .object({ status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'reimbursed']).optional() })
        .parse(parseArgs(raw))

      const conditions = [eq(schema.expenseReports.orgId, ctx.org.id)]
      if (args.status) conditions.push(eq(schema.expenseReports.status, args.status))

      const rows = await ctx.db
        .select({
          id: schema.expenseReports.id,
          status: schema.expenseReports.status,
          total: schema.expenseReports.total,
          createdAt: schema.expenseReports.createdAt,
          employeeEmail: schema.employees.email,
        })
        .from(schema.expenseReports)
        .innerJoin(schema.employees, eq(schema.expenseReports.employeeId, schema.employees.id))
        .where(and(...conditions))
        .orderBy(desc(schema.expenseReports.createdAt))

      return { summary: `${rows.length} gasto(s)`, data: rows }
    },
  },

  create_expense: {
    module: 'gastos',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_expense',
        description:
          'Crea una nota de gasto con una línea. Si no se indica empleado, se usa la ficha del usuario.',
        parameters: {
          type: 'object',
          properties: {
            employeeEmail: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            category: { type: 'string', description: 'Dietas, Transporte, …' },
            description: { type: 'string' },
            amount: { type: 'number' },
            submit: { type: 'boolean', description: 'Enviar a validación directamente' },
          },
          required: ['date', 'category', 'amount'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          employeeEmail: z.string().email().optional(),
          date: ISO_DATE,
          category: z.string().min(1).max(60),
          description: z.string().max(300).optional(),
          amount: z.number().positive(),
          submit: z.boolean().default(false),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const employee = parsed.data.employeeEmail
        ? await findEmployee(ctx, { email: parsed.data.employeeEmail })
        : ctx.employee
          ? { id: ctx.employee.id }
          : null
      if (!employee) {
        throw createError({ statusCode: 400, statusMessage: 'Indica employeeEmail' })
      }

      const id = crypto.randomUUID()
      const now = new Date()
      await ctx.db.transaction(async (tx) => {
        await tx.insert(schema.expenseReports).values({
          id,
          orgId: ctx.org.id,
          employeeId: employee.id,
          status: parsed.data.submit ? 'submitted' : 'draft',
          total: Math.round(parsed.data.amount * 100) / 100,
          notes: null,
          submittedAt: parsed.data.submit ? now : null,
          createdAt: now,
        })
        await tx.insert(schema.expenseLines).values({
          id: crypto.randomUUID(),
          reportId: id,
          date: parsed.data.date,
          category: parsed.data.category,
          description: parsed.data.description ?? null,
          amount: parsed.data.amount,
          tax: 0,
          attachmentPath: null,
        })
      })

      return { summary: `Gasto de ${parsed.data.amount} € creado`, data: { id } }
    },
  },

  decide_expense: {
    module: 'gastos',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'decide_expense',
        description: 'Aprueba, rechaza o marca como reembolsada una nota de gasto.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            action: { type: 'string', enum: ['approve', 'reject', 'reimburse'] },
          },
          required: ['id', 'action'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ id: z.string().min(1), action: z.enum(['approve', 'reject', 'reimburse']) })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const [report] = await ctx.db
        .select()
        .from(schema.expenseReports)
        .where(
          and(eq(schema.expenseReports.id, parsed.data.id), eq(schema.expenseReports.orgId, ctx.org.id)),
        )
        .limit(1)
      if (!report) throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })

      const transitions = {
        approve: { from: 'submitted', to: 'approved' },
        reject: { from: 'submitted', to: 'rejected' },
        reimburse: { from: 'approved', to: 'reimbursed' },
      } as const
      const transition = transitions[parsed.data.action]
      if (report.status !== transition.from) {
        throw createError({
          statusCode: 409,
          statusMessage: `No se puede pasar de ${report.status} a ${transition.to}`,
        })
      }

      await ctx.db
        .update(schema.expenseReports)
        .set({
          status: transition.to,
          approvedBy: ctx.employee?.id ?? null,
          approvedAt: parsed.data.action === 'reject' ? null : new Date(),
        })
        .where(eq(schema.expenseReports.id, report.id))

      return { summary: `Gasto ${transition.to}`, data: { id: report.id, status: transition.to } }
    },
  },

  /* ---------------------------- Nóminas ------------------------------ */
  list_payroll_periods: {
    module: 'nominas',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_payroll_periods',
        description: 'Lista los periodos de nómina con su estado y coste.',
        parameters: { type: 'object', properties: {} },
      },
    },
    async run(ctx) {
      const periods = await ctx.db
        .select()
        .from(schema.payrollPeriods)
        .where(eq(schema.payrollPeriods.orgId, ctx.org.id))
        .orderBy(desc(schema.payrollPeriods.year), desc(schema.payrollPeriods.month))

      const result = []
      for (const period of periods) {
        const slips = await ctx.db
          .select({ gross: schema.payslips.gross })
          .from(schema.payslips)
          .where(eq(schema.payslips.periodId, period.id))
        result.push({
          id: period.id,
          year: period.year,
          month: period.month,
          status: period.status,
          employeeCount: slips.length,
          totalGross: Math.round(slips.reduce((sum, s) => sum + s.gross, 0) * 100) / 100,
        })
      }
      return { summary: `${result.length} periodo(s)`, data: result }
    },
  },

  create_payroll_period: {
    module: 'nominas',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_payroll_period',
        description: 'Abre un periodo de nómina (mes y año).',
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'number' },
            month: { type: 'number', description: '1-12' },
          },
          required: ['year', 'month'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const [existing] = await ctx.db
        .select()
        .from(schema.payrollPeriods)
        .where(
          and(
            eq(schema.payrollPeriods.orgId, ctx.org.id),
            eq(schema.payrollPeriods.year, parsed.data.year),
            eq(schema.payrollPeriods.month, parsed.data.month),
          ),
        )
        .limit(1)
      if (existing) throw createError({ statusCode: 409, statusMessage: 'Ese periodo ya existe' })

      const id = crypto.randomUUID()
      await ctx.db.insert(schema.payrollPeriods).values({
        id,
        orgId: ctx.org.id,
        year: parsed.data.year,
        month: parsed.data.month,
        status: 'open',
      })
      return { summary: `Periodo ${parsed.data.month}/${parsed.data.year} abierto`, data: { id } }
    },
  },

  close_payroll_period: {
    module: 'nominas',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'close_payroll_period',
        description: 'Cierra un periodo de nómina (deja de admitir cambios).',
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'number' },
            month: { type: 'number' },
          },
          required: ['year', 'month'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ year: z.number().int(), month: z.number().int().min(1).max(12) })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const [period] = await ctx.db
        .select()
        .from(schema.payrollPeriods)
        .where(
          and(
            eq(schema.payrollPeriods.orgId, ctx.org.id),
            eq(schema.payrollPeriods.year, parsed.data.year),
            eq(schema.payrollPeriods.month, parsed.data.month),
          ),
        )
        .limit(1)
      if (!period) throw createError({ statusCode: 404, statusMessage: 'Periodo no encontrado' })
      if (period.status === 'closed') {
        throw createError({ statusCode: 409, statusMessage: 'Ya está cerrado' })
      }

      await ctx.db
        .update(schema.payrollPeriods)
        .set({ status: 'closed' })
        .where(eq(schema.payrollPeriods.id, period.id))
      return { summary: `Periodo ${parsed.data.month}/${parsed.data.year} cerrado` }
    },
  },

  list_payslips: {
    module: 'nominas',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_payslips',
        description: 'Lista las nóminas de un periodo.',
        parameters: {
          type: 'object',
          properties: { year: { type: 'number' }, month: { type: 'number' } },
          required: ['year', 'month'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({ year: z.number().int(), month: z.number().int().min(1).max(12) })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const rows = await ctx.db
        .select({
          employeeEmail: schema.employees.email,
          gross: schema.payslips.gross,
          net: schema.payslips.net,
        })
        .from(schema.payslips)
        .innerJoin(schema.payrollPeriods, eq(schema.payslips.periodId, schema.payrollPeriods.id))
        .innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id))
        .where(
          and(
            eq(schema.payrollPeriods.orgId, ctx.org.id),
            eq(schema.payrollPeriods.year, parsed.data.year),
            eq(schema.payrollPeriods.month, parsed.data.month),
          ),
        )

      return { summary: `${rows.length} nómina(s)`, data: rows }
    },
  },

  upsert_payslip: {
    module: 'nominas',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'upsert_payslip',
        description: 'Carga o actualiza la nómina de un empleado en un periodo abierto.',
        parameters: {
          type: 'object',
          properties: {
            employeeEmail: { type: 'string' },
            year: { type: 'number' },
            month: { type: 'number' },
            gross: { type: 'number' },
            net: { type: 'number' },
          },
          required: ['employeeEmail', 'year', 'month', 'gross', 'net'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          employeeEmail: z.string().email(),
          year: z.number().int(),
          month: z.number().int().min(1).max(12),
          gross: z.number().min(0),
          net: z.number().min(0),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const [period] = await ctx.db
        .select()
        .from(schema.payrollPeriods)
        .where(
          and(
            eq(schema.payrollPeriods.orgId, ctx.org.id),
            eq(schema.payrollPeriods.year, parsed.data.year),
            eq(schema.payrollPeriods.month, parsed.data.month),
          ),
        )
        .limit(1)
      if (!period) throw createError({ statusCode: 404, statusMessage: 'Periodo no encontrado' })
      if (period.status === 'closed') {
        throw createError({ statusCode: 409, statusMessage: 'El periodo está cerrado' })
      }

      const employee = await findEmployee(ctx, { email: parsed.data.employeeEmail })
      const [existing] = await ctx.db
        .select()
        .from(schema.payslips)
        .where(
          and(eq(schema.payslips.periodId, period.id), eq(schema.payslips.employeeId, employee.id)),
        )
        .limit(1)

      const values = {
        id: existing?.id ?? crypto.randomUUID(),
        periodId: period.id,
        employeeId: employee.id,
        gross: parsed.data.gross,
        net: parsed.data.net,
        filePath: null,
        departmentId: employee.departmentId,
      }

      if (existing) {
        await ctx.db.update(schema.payslips).set(values).where(eq(schema.payslips.id, values.id))
      } else {
        await ctx.db.insert(schema.payslips).values(values)
      }

      return {
        summary: `Nómina de ${employee.firstName} ${employee.lastName} guardada`,
        data: { id: values.id, updated: Boolean(existing) },
      }
    },
  },

  /* -------------------------- Reclutamiento -------------------------- */
  list_job_postings: {
    module: 'reclutamiento',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_job_postings',
        description: 'Lista las ofertas de empleo con su id y estado.',
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
    module: 'reclutamiento',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_job_posting',
        description: 'Crea y publica una oferta de empleo.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string', description: 'Funciones, requisitos y condiciones' },
            department: { type: 'string' },
            publish: { type: 'boolean' },
          },
          required: ['title', 'description'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          title: z.string().min(3).max(120),
          description: z.string().min(10).max(5000),
          department: z.string().max(80).nullable().optional(),
          publish: z.boolean().default(true),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)
      const data = parsed.data

      const department = data.department ? await findDepartment(ctx, data.department) : null
      const id = crypto.randomUUID()
      const now = new Date()

      await ctx.db.insert(schema.jobPostings).values({
        id,
        orgId: ctx.org.id,
        title: data.title,
        description: data.description,
        departmentId: department?.id ?? null,
        status: data.publish ? 'published' : 'draft',
        publishedAt: data.publish ? now : null,
        closesAt: null,
      })

      return {
        summary: `Oferta "${data.title}" ${data.publish ? 'publicada' : 'en borrador'}`,
        data: { id },
      }
    },
  },

  update_job_posting: {
    module: 'reclutamiento',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'update_job_posting',
        description: 'Actualiza una oferta (título, descripción o estado).',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            titleMatch: { type: 'string', description: 'Título exacto actual' },
            newTitle: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'published', 'closed'] },
          },
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          id: z.string().optional(),
          titleMatch: z.string().min(3).optional(),
          newTitle: z.string().min(3).max(120).optional(),
          description: z.string().min(10).max(5000).optional(),
          status: z.enum(['draft', 'published', 'closed']).optional(),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const job = await findJob(ctx, { id: parsed.data.id, title: parsed.data.titleMatch })
      const patch: Partial<typeof schema.jobPostings.$inferInsert> = {}
      if (parsed.data.newTitle) patch.title = parsed.data.newTitle
      if (parsed.data.description) patch.description = parsed.data.description
      if (parsed.data.status) {
        patch.status = parsed.data.status
        if (parsed.data.status === 'published' && !job.publishedAt) patch.publishedAt = new Date()
      }
      if (!Object.keys(patch).length) {
        throw createError({ statusCode: 400, statusMessage: 'Nada que actualizar' })
      }

      await ctx.db.update(schema.jobPostings).set(patch).where(eq(schema.jobPostings.id, job.id))
      return { summary: `Oferta "${patch.title ?? job.title}" actualizada`, data: { id: job.id } }
    },
  },

  list_candidates: {
    module: 'reclutamiento',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_candidates',
        description: 'Lista las candidaturas, opcionalmente filtradas por oferta.',
        parameters: {
          type: 'object',
          properties: { jobTitle: { type: 'string' } },
        },
      },
    },
    async run(ctx, raw) {
      const args = z.object({ jobTitle: z.string().optional() }).parse(parseArgs(raw))
      const conditions = [eq(schema.jobPostings.orgId, ctx.org.id)]
      if (args.jobTitle) {
        conditions.push(sql`lower(${schema.jobPostings.title}) = lower(${args.jobTitle})`)
      }

      const rows = await ctx.db
        .select({
          id: schema.candidates.id,
          name: schema.candidates.name,
          email: schema.candidates.email,
          stage: schema.candidates.stage,
          jobTitle: schema.jobPostings.title,
        })
        .from(schema.candidates)
        .innerJoin(schema.jobPostings, eq(schema.candidates.jobPostingId, schema.jobPostings.id))
        .where(and(...conditions))
        .orderBy(desc(schema.candidates.createdAt))

      return { summary: `${rows.length} candidatura(s)`, data: rows }
    },
  },

  create_candidate: {
    module: 'reclutamiento',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_candidate',
        description: 'Registra una candidatura en una oferta.',
        parameters: {
          type: 'object',
          properties: {
            jobTitle: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['jobTitle', 'name', 'email'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          jobTitle: z.string().min(3),
          name: z.string().min(2).max(120),
          email: z.string().email(),
          phone: z.string().max(40).optional(),
          notes: z.string().max(2000).optional(),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const job = await findJob(ctx, { title: parsed.data.jobTitle })
      if (job.status === 'closed') {
        throw createError({ statusCode: 409, statusMessage: 'La oferta está cerrada' })
      }

      const id = crypto.randomUUID()
      await ctx.db.insert(schema.candidates).values({
        id,
        jobPostingId: job.id,
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
        cvPath: null,
        stage: 'new',
        notes: parsed.data.notes ?? null,
        createdAt: new Date(),
      })
      return { summary: `Candidatura de ${parsed.data.name} registrada`, data: { id } }
    },
  },

  update_candidate: {
    module: 'reclutamiento',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'update_candidate',
        description: 'Mueve una candidatura de etapa o actualiza sus notas.',
        parameters: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email del candidato' },
            jobTitle: { type: 'string' },
            stage: {
              type: 'string',
              enum: ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'],
            },
            notes: { type: 'string' },
          },
          required: ['email'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          email: z.string().email(),
          jobTitle: z.string().optional(),
          stage: z.enum(['new', 'screening', 'interview', 'offer', 'hired', 'rejected']).optional(),
          notes: z.string().max(2000).optional(),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const conditions = [
        eq(schema.jobPostings.orgId, ctx.org.id),
        sql`lower(${schema.candidates.email}) = lower(${parsed.data.email})`,
      ]
      if (parsed.data.jobTitle) {
        conditions.push(sql`lower(${schema.jobPostings.title}) = lower(${parsed.data.jobTitle})`)
      }

      const [candidate] = await ctx.db
        .select({ id: schema.candidates.id, name: schema.candidates.name, stage: schema.candidates.stage })
        .from(schema.candidates)
        .innerJoin(schema.jobPostings, eq(schema.candidates.jobPostingId, schema.jobPostings.id))
        .where(and(...conditions))
        .limit(1)
      if (!candidate) throw createError({ statusCode: 404, statusMessage: 'Candidatura no encontrada' })

      const patch: Partial<typeof schema.candidates.$inferInsert> = {}
      if (parsed.data.stage) patch.stage = parsed.data.stage
      if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes
      if (!Object.keys(patch).length) {
        throw createError({ statusCode: 400, statusMessage: 'Nada que actualizar' })
      }

      await ctx.db.update(schema.candidates).set(patch).where(eq(schema.candidates.id, candidate.id))
      return { summary: `Candidatura de ${candidate.name} actualizada`, data: { id: candidate.id } }
    },
  },

  /* --------------------------- Vacaciones ---------------------------- */
  list_leave_requests: {
    module: 'vacaciones',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_leave_requests',
        description: 'Lista las solicitudes de vacaciones/permisos.',
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'number' },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
            employeeEmail: { type: 'string' },
          },
        },
      },
    },
    async run(ctx, raw) {
      const args = z
        .object({
          year: z.number().int().optional(),
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
          employeeEmail: z.string().email().optional(),
        })
        .parse(parseArgs(raw))

      const conditions = [eq(schema.leaveRequests.orgId, ctx.org.id)]
      if (args.status) conditions.push(eq(schema.leaveRequests.status, args.status))
      if (args.employeeEmail) {
        const employee = await findEmployee(ctx, { email: args.employeeEmail })
        conditions.push(eq(schema.leaveRequests.employeeId, employee.id))
      }
      if (args.year) {
        conditions.push(sql`${schema.leaveRequests.startDate} like ${`${args.year}-%`}`)
      }

      const rows = await ctx.db
        .select({
          id: schema.leaveRequests.id,
          employeeEmail: schema.employees.email,
          startDate: schema.leaveRequests.startDate,
          endDate: schema.leaveRequests.endDate,
          days: schema.leaveRequests.days,
          status: schema.leaveRequests.status,
        })
        .from(schema.leaveRequests)
        .innerJoin(schema.employees, eq(schema.leaveRequests.employeeId, schema.employees.id))
        .where(and(...conditions))
        .orderBy(desc(schema.leaveRequests.startDate))

      return { summary: `${rows.length} solicitud(es)`, data: rows }
    },
  },

  create_leave_request: {
    module: 'vacaciones',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'create_leave_request',
        description:
          'Crea una solicitud de vacaciones. Los días se calculan con el calendario laboral y los festivos.',
        parameters: {
          type: 'object',
          properties: {
            employeeEmail: { type: 'string' },
            leaveType: { type: 'string', description: 'Código o nombre, p. ej. VAC o Vacaciones' },
            startDate: { type: 'string', description: 'YYYY-MM-DD' },
            endDate: { type: 'string', description: 'YYYY-MM-DD' },
            reason: { type: 'string' },
          },
          required: ['employeeEmail', 'startDate', 'endDate'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          employeeEmail: z.string().email(),
          leaveType: z.string().default('VAC'),
          startDate: ISO_DATE,
          endDate: ISO_DATE,
          reason: z.string().max(500).optional(),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      if (parsed.data.endDate < parsed.data.startDate) {
        throw createError({ statusCode: 400, statusMessage: 'La fecha de fin es anterior al inicio' })
      }

      const employee = await findEmployee(ctx, { email: parsed.data.employeeEmail })
      const [leaveType] = await ctx.db
        .select()
        .from(schema.leaveTypes)
        .where(
          and(
            eq(schema.leaveTypes.orgId, ctx.org.id),
            sql`(lower(${schema.leaveTypes.code}) = lower(${parsed.data.leaveType}) or lower(${schema.leaveTypes.name}) = lower(${parsed.data.leaveType}))`,
          ),
        )
        .limit(1)
      if (!leaveType) throw createError({ statusCode: 404, statusMessage: 'Tipo de permiso no encontrado' })

      const settings = await getSettingsForOrg(ctx.db, ctx.org.id)
      const yearStart = Number(parsed.data.startDate.slice(0, 4))
      const yearEnd = Number(parsed.data.endDate.slice(0, 4))
      const holidays = [
        ...new Set([
          ...(await getHolidayDates(ctx.db, ctx.org.id, yearStart)),
          ...(await getHolidayDates(ctx.db, ctx.org.id, yearEnd)),
        ]),
      ]
      const days = countLeaveDays(parsed.data.startDate, parsed.data.endDate, {
        mode: settings.vacationMode,
        holidays,
        workweek: settings.workweek,
      })
      if (days <= 0) {
        throw createError({ statusCode: 400, statusMessage: 'El rango no contiene días laborables' })
      }

      const status = leaveType.requiresApproval ? 'pending' : 'approved'
      const id = crypto.randomUUID()
      const now = new Date()

      await ctx.db.insert(schema.leaveRequests).values({
        id,
        orgId: ctx.org.id,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        days,
        status,
        reason: parsed.data.reason ?? null,
        decidedBy: status === 'approved' ? employee.id : null,
        decidedAt: status === 'approved' ? now : null,
        createdAt: now,
        updatedAt: now,
      })

      return {
        summary: `${days} día(s) de ${leaveType.name} para ${employee.firstName} (${status})`,
        data: { id, days, status },
      }
    },
  },

  cancel_leave_request: {
    module: 'vacaciones',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'cancel_leave_request',
        description: 'Cancela una solicitud de vacaciones por su id.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z.object({ id: z.string().min(1) }).safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const [request] = await ctx.db
        .select()
        .from(schema.leaveRequests)
        .where(
          and(eq(schema.leaveRequests.id, parsed.data.id), eq(schema.leaveRequests.orgId, ctx.org.id)),
        )
        .limit(1)
      if (!request) throw createError({ statusCode: 404, statusMessage: 'Solicitud no encontrada' })
      if (request.status === 'cancelled') {
        throw createError({ statusCode: 409, statusMessage: 'Ya está cancelada' })
      }

      await ctx.db
        .update(schema.leaveRequests)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(schema.leaveRequests.id, request.id))
      return { summary: 'Solicitud cancelada', data: { id: request.id } }
    },
  },

  /* ---------------------------- Denuncias ---------------------------- */
  list_whistle_reports: {
    module: 'denuncias',
    mutate: false,
    spec: {
      type: 'function',
      function: {
        name: 'list_whistle_reports',
        description: 'Lista las denuncias del canal con su estado y código.',
        parameters: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['new', 'in_review', 'resolved', 'closed'] } },
        },
      },
    },
    async run(ctx, raw) {
      const args = z
        .object({ status: z.enum(['new', 'in_review', 'resolved', 'closed']).optional() })
        .parse(parseArgs(raw))

      const conditions = [eq(schema.whistleReports.orgId, ctx.org.id)]
      if (args.status) conditions.push(eq(schema.whistleReports.status, args.status))

      const rows = await ctx.db
        .select({
          id: schema.whistleReports.id,
          trackingCode: schema.whistleReports.trackingCode,
          category: schema.whistleReports.category,
          status: schema.whistleReports.status,
          createdAt: schema.whistleReports.createdAt,
        })
        .from(schema.whistleReports)
        .where(and(...conditions))
        .orderBy(desc(schema.whistleReports.createdAt))

      return { summary: `${rows.length} denuncia(s)`, data: rows }
    },
  },

  update_whistle_report: {
    module: 'denuncias',
    mutate: true,
    spec: {
      type: 'function',
      function: {
        name: 'update_whistle_report',
        description: 'Cambia el estado de una denuncia y/o responde al denunciante.',
        parameters: {
          type: 'object',
          properties: {
            trackingCode: { type: 'string', description: 'Código WD-XXXXXXXX' },
            status: { type: 'string', enum: ['new', 'in_review', 'resolved', 'closed'] },
            message: { type: 'string', description: 'Respuesta al denunciante' },
          },
          required: ['trackingCode'],
        },
      },
    },
    async run(ctx, raw) {
      const parsed = z
        .object({
          trackingCode: z.string().regex(/^WD-[A-Z0-9]{8}$/i),
          status: z.enum(['new', 'in_review', 'resolved', 'closed']).optional(),
          message: z.string().min(1).max(3000).optional(),
        })
        .safeParse(parseArgs(raw))
      if (!parsed.success) throw invalid(parsed.error)

      const [report] = await ctx.db
        .select()
        .from(schema.whistleReports)
        .where(
          and(
            eq(schema.whistleReports.orgId, ctx.org.id),
            eq(schema.whistleReports.trackingCode, parsed.data.trackingCode.toUpperCase()),
          ),
        )
        .limit(1)
      if (!report) throw createError({ statusCode: 404, statusMessage: 'Denuncia no encontrada' })

      const now = new Date()
      await ctx.db.transaction(async (tx) => {
        if (parsed.data.status) {
          await tx
            .update(schema.whistleReports)
            .set({ status: parsed.data.status, updatedAt: now })
            .where(eq(schema.whistleReports.id, report.id))
        }
        if (parsed.data.message) {
          await tx.insert(schema.whistleMessages).values({
            id: crypto.randomUUID(),
            reportId: report.id,
            authorType: 'company',
            body: parsed.data.message,
            createdAt: now,
          })
        }
      })

      return {
        summary: `Denuncia ${report.trackingCode} actualizada`,
        data: { status: parsed.data.status ?? report.status },
      }
    },
  },
}

/**
 * Catálogo de herramientas.
 *
 * Con `module` se devuelven solo las de esa sección (más el contenido, que es
 * transversal); sin módulo se devuelven todas para el botón flotante global.
 */
export function toolSpecsFor(module?: AiModule): ToolSpec[] {
  const all = Object.values(TOOLS)
  const selected = module
    ? all.filter((tool) => tool.module === module || (module !== 'contenido' && tool.module === 'contenido'))
    : all
  return selected.map((tool) => tool.spec)
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
