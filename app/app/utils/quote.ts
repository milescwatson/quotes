import type { LocalQuoteLine, QuoteLineInput } from '~/types/quotes'
export function quoteAmount(line: LocalQuoteLine) {
  const content = line.snapshot.content
  const cents = (value: string) => { const [w, f = ''] = value.split('.'); return BigInt(w!) * 100n + BigInt(f.padEnd(2, '0')) }
  const unit = cents(content.basePrice) + content.segments.reduce((sum, s, i) => sum + cents(s.options.find(o => o.id === line.selections[i])?.price || '0.00'), 0n)
  const dollars = (v: bigint) => `${v / 100n}.${String(v % 100n).padStart(2, '0')}`
  return { unitPrice: dollars(unit), lineTotal: dollars(unit * BigInt(Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0)) }
}
export function quoteNumber(line: LocalQuoteLine) {
  const c = line.snapshot.content
  return c.segments.map((s, i) => (i ? (c.separators ?? Array(c.segments.length - 1).fill('-'))[i - 1] : '') + (s.options.find(o => o.id === line.selections[i])?.code ?? s.placeholder)).join('')
}
export function lineInput(line: LocalQuoteLine): QuoteLineInput { return { id: line.id, taxonomyId: line.taxonomyId, versionId: line.versionId, selections: [...line.selections], quantity: line.quantity } }
