import { describe, expect, it } from 'vitest'
import { intQuery, stringQuery } from '../../server/utils/erp'

/**
 * Los listados ERP reciben `limit`/`offset`/`search` desde query string.
 * Un valor no numérico no debe convertirse en NaN y llegar a Postgres.
 */

describe('intQuery', () => {
  it('acepta números válidos y los acota', () => {
    expect(intQuery('25', 50, 1, 500)).toBe(25)
    expect(intQuery(0, 50, 1, 500)).toBe(1)
    expect(intQuery('9999', 50, 1, 500)).toBe(500)
    expect(intQuery('12.9', 50, 1, 500)).toBe(12)
  })

  it('usa el valor por defecto con entradas inválidas', () => {
    expect(intQuery('abc', 50, 1, 500)).toBe(50)
    expect(intQuery(undefined, 50, 1, 500)).toBe(50)
    expect(intQuery(['1', '2'], 50, 1, 500)).toBe(50)
    expect(intQuery(Number.NaN, 50, 1, 500)).toBe(50)
  })
})

describe('stringQuery', () => {
  it('normaliza strings y descarta otros tipos', () => {
    expect(stringQuery('  hola  ')).toBe('hola')
    expect(stringQuery('   ')).toBeUndefined()
    expect(stringQuery(['a'])).toBeUndefined()
    expect(stringQuery(undefined)).toBeUndefined()
  })
})
