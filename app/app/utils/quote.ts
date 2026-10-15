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
  if (line.kind === 'regular' || line.kind === 'freeform') return c.productFamilyName
  return c.segments.map((s, i) => (i ? (c.separators ?? Array(c.segments.length - 1).fill('-'))[i - 1] : '') + (s.options.find(o => o.id === line.selections[i])?.code ?? s.placeholder)).join('')
}
export function validMultiple(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1000 && Math.abs(value * 10000 - Math.round(value * 10000)) < 0.000001
}
export function adjustedAmount(list: string, quoteMultiple = 1) {
  if (!validMultiple(quoteMultiple)) return '0.00'
  const amount = (BigInt(list.replace('.', '')) * BigInt(Math.round(quoteMultiple * 10000)) + 5000n) / 10000n
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`
}
export function lineInput(line: LocalQuoteLine): QuoteLineInput {
  const common = { id: line.id, quantity: line.quantity }
  if (line.kind === 'regular') return { ...common, kind: 'regular', regularProductId: line.regularProductId! }
  if (line.kind === 'freeform') return { ...common, kind: 'freeform', partNumber: line.snapshot.content.productFamilyName, description: line.snapshot.content.productDescription ?? '', listPrice: line.snapshot.content.basePrice }
  return { ...common, taxonomyId: line.taxonomyId!, versionId: line.versionId!, selections: [...line.selections] }
}
