// Money formatting, shared by every page that shows an amount.
//
// Extracted from the proposals page rather than reimplemented: two
// formatters drift, and the first symptom is the same figure rendering
// differently on two screens, which reads as a data problem.

/**
 * Formats an amount for display.
 *
 * PostgREST returns `numeric` as a string to avoid the precision loss
 * that JSON numbers would cause, so both shapes have to be accepted.
 */
export function money(amount: string | number | null, currency: string): string {
  if (amount === null) return '—'
  const value = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(value)
  } catch {
    // An unexpected currency code must not blank the whole page.
    return `${value.toFixed(2)} ${currency}`
  }
}

/**
 * Sums amounts per currency, never across them.
 *
 * Adding 400 EUR to 400 GBP produces 800 of nothing. A total that mixes
 * currencies is not an approximation, it is a wrong number presented
 * with the same confidence as a right one.
 */
export function sumByCurrency(
  rows: readonly { amount: string | number | null; currency: string }[]
): { currency: string; total: number }[] {
  const sums = new Map<string, number>()
  for (const row of rows) {
    const value = typeof row.amount === 'number' ? row.amount : Number(row.amount ?? 0)
    if (!Number.isFinite(value)) continue
    sums.set(row.currency, (sums.get(row.currency) ?? 0) + value)
  }
  return [...sums.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total)
}
