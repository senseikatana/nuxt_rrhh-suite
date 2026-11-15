import { and, desc, eq } from 'drizzle-orm'
import * as schema from '../../database/schema'
import { getContext } from '../../utils/hr'
import { isManagerOrAdmin } from '../../utils/session'

/**
 * Contenido editable del sitio.
 *
 * - Con `?key=`: devuelve ese bloque (cualquier usuario autenticado), que es
 *   lo que consumen las páginas para pintar banners y avisos.
 * - Sin `key`: devuelve todos los bloques de la organización (solo mandos y
 *   administración, porque incluye textos en borrador).
 */
export default defineEventHandler(async (event) => {
  const { db, user, org } = await getContext(event)
  const query = getQuery(event)
  const key = typeof query.key === 'string' ? query.key : null
  const locale = typeof query.locale === 'string' ? query.locale : 'es'

  if (key) {
    const [block] = await db
      .select()
      .from(schema.contentBlocks)
      .where(
        and(
          eq(schema.contentBlocks.orgId, org.id),
          eq(schema.contentBlocks.key, key),
          eq(schema.contentBlocks.locale, locale),
        ),
      )
      .limit(1)

    return block ?? null
  }

  if (!isManagerOrAdmin(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Sin permisos' })
  }

  return db
    .select()
    .from(schema.contentBlocks)
    .where(eq(schema.contentBlocks.orgId, org.id))
    .orderBy(desc(schema.contentBlocks.updatedAt))
})
