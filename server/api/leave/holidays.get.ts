import { getContext } from '../../utils/hr'
import { getHolidayDates } from '../../utils/leave'

export default defineEventHandler(async (event) => {
  const { db, org } = await getContext(event)
  const query = getQuery(event)
  const year = Number(query.year ?? new Date().getFullYear())
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createError({ statusCode: 400, statusMessage: 'Año inválido' })
  }

  const dates = await getHolidayDates(db, org.id, year)

  return { year, dates, count: dates.length }
})
