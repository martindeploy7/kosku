import { addDays, addMonths } from './dates'
import type { ExpenseRecurrence } from './types'

/** Dates after the template's first transaction that are due by `through`. */
export function recurringExpenseDates(
  start: string,
  recurrence: ExpenseRecurrence,
  through: string,
  end: string | null = null,
) {
  const limit = end && end < through ? end : through
  const dates: string[] = []
  // Guard malformed data from trapping a scheduled worker indefinitely.
  for (let count = 1; count <= 2_000; count++) {
    const cursor = recurrence === 'weekly'
      ? addDays(start, count * 7)
      : addMonths(start, count * (recurrence === 'yearly' ? 12 : 1))
    if (cursor > limit) break
    dates.push(cursor)
  }
  return dates
}
