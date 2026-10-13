import type { ConfigurationDraft, SegmentDraft, OptionDraft, Taxonomy, TaxonomyInput, FieldError } from '~/types/taxonomy'
export const blankConfiguration = (): ConfigurationDraft => ({ productFamilyName: '', productDescription: '', separators: [], principalId: '', basePrice: '', currency: 'USD', segments: [] })
export const blankOption = (): OptionDraft => ({ key: crypto.randomUUID(), id: null, code: '', description: '', price: '0.00' })
export const blankSegment = (): SegmentDraft => ({ key: crypto.randomUUID(), id: null, placeholder: '', name: null, description: '', defaultKey: null, options: [] })
export function fromTaxonomy(t: Taxonomy): ConfigurationDraft {
  return { productFamilyName: t.version.content.productFamilyName, productDescription: t.version.content.productDescription ?? '', separators: [...(t.version.content.separators ?? Array(Math.max(0, t.version.content.segments.length - 1)).fill('-'))], principalId: t.principalId, basePrice: t.version.content.basePrice, currency: 'USD',
    segments: t.version.content.segments.map(s => ({ key: s.id, id: s.id, placeholder: s.placeholder, name: s.name, description: s.description ?? '', defaultKey: s.defaultOptionId,
      options: s.options.map(o => ({ key: o.id, id: o.id, code: o.code, description: o.description ?? '', price: o.price })) })) }
}
export function formatPrice(raw: string, emptyZero = false): string | null {
  let value = raw.trim()
  if (!value) return emptyZero ? '0.00' : null
  value = value.replace(/^(?:USD\s*|\$\s*)/i, '').replace(/\s*USD$/i, '').trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.\d*)?$/.test(value) || !/\d/.test(value)) return null
  value = value.replaceAll(',', '')
  const [whole = '', fraction = ''] = value.split('.')
  // Bound work before BigInt conversion of arbitrary pasted text.
  if (whole.length > 100 || fraction.length > 100) return null
  let cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2))
  if ((fraction[2] || '0') >= '5') cents++
  if (cents > 99999999999999n) return null
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}
export function displayPrice(raw: string): string {
  const value = formatPrice(raw)
  if (value === null) return raw
  const [whole, fraction] = value.split('.')
  return `$${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`
}
const cents = (value: string) => BigInt(value.replace('.', ''))
export function configurationInput(draft: ConfigurationDraft): { content: TaxonomyInput; errors: FieldError[] } {
  const errors: FieldError[] = []
  const error = (path: string, message: string) => errors.push({ path, message, code: 'INVALID_INPUT' })
  const text = (raw: string, max: number, path: string, optional = false, multiline = false) => {
    const value = raw.trim()
    if ((!value && !optional) || [...value].length > max || /[\p{Cc}\p{Cs}]/u.test(multiline ? raw.replace(/[\r\n]/g, '') : raw)) error(path, `Enter ${optional ? 'up to' : '1–'}${max} characters without control characters.`)
    return value
  }
  const price = (raw: string, path: string, emptyZero = false) => {
    const value = formatPrice(raw, emptyZero)
    if (value === null) error(path, 'Enter a valid nonnegative USD amount.')
    return value ?? raw
  }
  const seen = (value: string, used: Set<string>, path: string) => {
    if (used.has(value.toLowerCase())) error(path, 'This value must be unique, ignoring case.')
    used.add(value.toLowerCase())
  }
  if (!/^[1-9]\d{0,18}$/.test(draft.principalId)) error('/principalId', 'Choose a principal.')
  if (!draft.segments.length || draft.segments.length > 50) error('/content/segments', 'Add 1–50 segments.')
  if (draft.separators.length !== Math.max(0, draft.segments.length - 1) || draft.separators.some(s => s !== '-' && s !== '')) error('/content/separators', 'Provide one separator (- or blank) per gap.')
  const labels = new Set<string>(), names = new Set<string>()
  let count = 0
  const content: TaxonomyInput = { productFamilyName: text(draft.productFamilyName, 120, '/content/productFamilyName'), productDescription: text(draft.productDescription, 1000, '/content/productDescription', true, true) || null, separators: [...draft.separators], currency: draft.currency,
    basePrice: price(draft.basePrice, '/content/basePrice', true), segments: draft.segments.map((s, i) => {
      const path = `/content/segments/${i}`, codes = new Set<string>()
      const placeholder = text(s.placeholder, 32, `${path}/placeholder`)
      seen(placeholder, labels, `${path}/placeholder`)
      const name = text(s.name ?? '', 120, `${path}/name`, true) || null
      if (name) seen(name, names, `${path}/name`)
      count += s.options.length
      if (!s.options.length || s.options.length > 500) error(`${path}/options`, 'Add 1–500 options.')
      return { id: s.id, placeholder, name, description: text(s.description, 1000, `${path}/description`, true, true) || null, defaultOptionIndex: s.defaultKey === null ? null : s.options.findIndex(o => o.key === s.defaultKey), options: s.options.map((o, j) => {
        const op = `${path}/options/${j}`, code = text(o.code, 64, `${op}/code`)
        if (/\s/u.test(code)) error(`${op}/code`, 'Codes cannot contain whitespace.')
        seen(code, codes, `${op}/code`)
        return { id: o.id, code, description: text(o.description, 1000, `${op}/description`, true) || null, price: price(o.price, `${op}/price`) }
      }) }
    }) }
  if (count > 2000) error('/content/segments', 'Use at most 2,000 options in total.')
  if (!errors.length) {
    const maximum = cents(content.basePrice) + content.segments.reduce((sum, s) => sum + s.options.reduce((max, o) => cents(o.price) > max ? cents(o.price) : max, 0n), 0n)
    if (maximum > 99999999999999n) error('/content', 'The maximum configured price exceeds the USD limit.')
  }
  if (new TextEncoder().encode(JSON.stringify({ principalId: draft.principalId, content })).length > 512 * 1024) error('/content', 'Configuration exceeds 512 KiB.')
  return { content, errors }
}
export function draftFingerprint(draft: ConfigurationDraft) {
  // Raw text stays dirty even when invalid; omit rendering-only identities.
  return JSON.stringify(draft, (key, value) => key === 'key' ? undefined : value)
}
