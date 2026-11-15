import { z } from 'zod'
import * as schema from '../database/schema'
import { isValidIsoDate } from '../services/leave/working-days'

/**
 * Esquemas de validación compartidos de la capa ERP.
 *
 * Validar en el boundary convierte una sorpresa de runtime (un `NaN` que llega
 * a `numeric`, un enum que revienta en Postgres) en un 400 claro. El módulo HR
 * ya usa zod; estos esquemas unifican el estilo en el ERP.
 */

/** Fecha ISO (YYYY-MM-DD) que Postgres puede aceptar en una columna `date`. */
export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, 'Fecha inválida (YYYY-MM-DD)')

/** Cuerpos de texto comunes. */
export const codeSchema = z.string().trim().min(1).max(60)
export const nameSchema = z.string().trim().min(1).max(120)
export const noteSchema = z.string().trim().max(500).nullable().optional()

/** Cantidades y precios: finitos y con signo acotado. */
export const positiveQuantity = z.number().finite().positive()
export const nonNegativeAmount = z.number().finite().min(0)

/** IDs: texto no vacío (UUIDs). */
export const idSchema = z.string().trim().min(1)

export const salesLineInput = z.object({
  itemId: idSchema,
  quantity: positiveQuantity,
  unitPrice: nonNegativeAmount,
})

export const salesOrderCreate = z.object({
  customerId: idSchema,
  deliveryDate: isoDateSchema.nullable().optional(),
  notes: noteSchema,
  lines: z.array(salesLineInput).min(1),
})

export const salesStatusChange = z.object({
  status: z.enum(schema.erpSalesOrders.status.enumValues as [string, ...string[]]),
  note: noteSchema,
})

export const purchaseLineInput = z.object({
  itemId: idSchema,
  quantity: positiveQuantity,
  unitCost: nonNegativeAmount,
})

export const purchaseOrderCreate = z.object({
  vendorId: idSchema,
  expectedDate: isoDateSchema.nullable().optional(),
  lines: z.array(purchaseLineInput).min(1),
})

export const receiptRequest = z.object({
  reference: noteSchema,
  lines: z
    .array(
      z.object({
        lineId: idSchema,
        quantityReceived: nonNegativeAmount,
      }),
    )
    .optional()
    .nullable(),
})

export const qualityDecision = z.object({
  passed: z.boolean(),
  note: noteSchema,
  lines: z
    .array(
      z.object({
        lineId: idSchema,
        status: z.enum(schema.qualityStatusEnum.enumValues as [string, ...string[]]),
      }),
    )
    .optional()
    .nullable(),
})

export const demandGenerate = z.object({
  coverageRatio: z.number().finite().min(0.1).max(10).default(1),
  horizonDays: z.number().int().min(1).max(365).default(30),
})

/**
 * Campos editables de artículos. Se declaran sin defaults para que
 * `itemUpdate = ...partial()` no rellene valores ausentes: un PATCH que solo
 * cambia la descripción no debe resetear unidad, precios, stock ni ubicación.
 */
const itemFields = {
  code: codeSchema,
  description: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(10),
  unitCost: nonNegativeAmount,
  unitPrice: nonNegativeAmount,
  stock: nonNegativeAmount,
  minStock: nonNegativeAmount,
  location: z.string().trim().max(20),
  category: z.string().trim().max(50).nullable().optional(),
}

export const itemCreate = z.object({
  ...itemFields,
  unit: itemFields.unit.default('EA'),
  unitCost: itemFields.unitCost.default(0),
  unitPrice: itemFields.unitPrice.default(0),
  stock: itemFields.stock.default(0),
  minStock: itemFields.minStock.default(0),
  location: itemFields.location.default('A-01'),
})

export const itemUpdate = z.object(itemFields).partial()

export const stockAdjust = z.object({
  quantity: z.number().finite().refine((v) => v !== 0, 'must be non-zero'),
  reason: z.string().trim().min(1).max(500),
})

/** Campos de cliente sin defaults, para que el PATCH no los rellene. */
const customerFields = {
  code: codeSchema,
  name: nameSchema,
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  postalCode: z.string().trim().max(10).nullable().optional(),
  country: z.string().trim().max(60),
  taxId: z.string().trim().max(30).nullable().optional(),
}

export const customerCreate = z.object({
  ...customerFields,
  country: customerFields.country.default('Spain'),
})

export const customerUpdate = z.object(customerFields).partial()

/** Campos de proveedor sin defaults, para que el PATCH no los rellene. */
const vendorFields = {
  code: codeSchema,
  name: nameSchema,
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365),
  qualityRating: z.number().finite().min(0).max(10),
}

export const vendorCreate = z.object({
  ...vendorFields,
  leadTimeDays: vendorFields.leadTimeDays.default(7),
  qualityRating: vendorFields.qualityRating.default(5),
})

export const vendorUpdate = z.object(vendorFields).partial()

export const routeCreate = z.object({
  code: codeSchema,
  carrier: z.string().trim().min(1).max(60),
  date: isoDateSchema,
  status: z
    .enum(schema.routeStatusEnum.enumValues as [string, ...string[]])
    .default('PLANNED')
    .transform((v) => v as (typeof schema.routeStatusEnum.enumValues)[number]),
  stops: z.number().int().min(0).default(0),
})

/** Filtros de listado: enums y paginación acotados. */
export function enumFilter<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.array(z.enum(values))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional()
}

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * Parsea y devuelve los datos o lanza un 400 con los errores de zod.
 * Uso: `const body = parseOrThrow(schema, await readBody(event))`.
 */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schemaToUse: T,
  input: unknown,
  label = 'Invalid payload',
): z.infer<T> {
  const result = schemaToUse.safeParse(input)
  if (!result.success) {
    const first = result.error.issues[0]
    const detail = first ? `${first.path.join('.') || 'value'}: ${first.message}` : 'invalid'
    throw createError({ statusCode: 400, statusMessage: `${label} — ${detail}` })
  }
  return result.data
}
