import { describe, expect, it } from 'vitest'
import { recurringExpenseDates } from './recurrence'

describe('recurring expenses', () => {
  it('keeps the intended calendar day for monthly expenses', () => {
    expect(recurringExpenseDates('2026-01-31', 'monthly', '2026-04-30')).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30',
    ])
  })

  it('supports weekly and inclusive end dates', () => {
    expect(recurringExpenseDates('2026-09-01', 'weekly', '2026-10-01', '2026-09-15')).toEqual([
      '2026-09-08', '2026-09-15',
    ])
  })

  it('supports yearly leap-day expenses', () => {
    expect(recurringExpenseDates('2024-02-29', 'yearly', '2027-12-31')).toEqual([
      '2025-02-28', '2026-02-28', '2027-02-28',
    ])
  })
})
