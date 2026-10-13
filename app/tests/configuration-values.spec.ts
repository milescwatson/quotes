import { test, expect } from '@playwright/test'
import { blankConfiguration, blankSegment, blankOption, configurationInput, fromTaxonomy, formatPrice, displayPrice } from '../app/utils/configuration'
test('price input normalizes common formats with exact cents and rejects invalid input', () => {
  for (const [raw, value] of [['.50','0.50'],['1.','1.00'],['$1,234.567','1234.57'],['USD 000.005','0.01'],['9.999','10.00'],['999999999999.99','999999999999.99']]) expect(formatPrice(raw!)).toBe(value)
  for (const raw of ['','abc','1,23','$-1','1e2','Infinity','999999999999.999','1 23']) expect(formatPrice(raw)).toBeNull()
  expect(formatPrice('', true)).toBe('0.00')
  expect(displayPrice('1234.567')).toBe('$1,234.57')
  expect(displayPrice('999999999999.99')).toBe('$999,999,999,999.99')
  expect(displayPrice('')).toBe('')
  expect(displayPrice('invalid')).toBe('invalid')
})
test('default follows its option and all possible prices are validated', () => {
  const draft = blankConfiguration(); draft.productFamilyName = 'F'; draft.principalId = '1'
  const segment = blankSegment(); segment.placeholder = 'X'
  const a = blankOption(), b = blankOption(); a.code = '01'; b.code = '02'; segment.options = [a,b]; segment.defaultKey = a.key; draft.segments.push(segment)
  segment.options.reverse()
  expect(configurationInput(draft).content.segments[0]!.defaultOptionIndex).toBe(1)
  draft.basePrice = '999999999999.99'; a.price = '0.01'
  expect(configurationInput(draft).errors.some(e => e.path === '/content')).toBeTruthy()
})


test('description validation, normalized titles and separator drafts', () => {
  const draft = blankConfiguration(); draft.productFamilyName = 'F'; draft.principalId = '1'
  const segment = blankSegment(); segment.placeholder = 'X'; segment.name = ' Size '
  const option = blankOption(); option.code = '01'; segment.options.push(option); draft.segments.push(segment)
  draft.productDescription = ' Product\nDetails '; segment.description = ' Segment\nDetails '
  const checked = configurationInput(draft)
  expect(checked.errors).toEqual([])
  expect(checked.content.productDescription).toBe('Product\nDetails')
  expect(checked.content.segments[0]!.name).toBe('Size')
  expect(checked.content.segments[0]!.description).toBe('Segment\nDetails')
  draft.productDescription = 'x'.repeat(1001); segment.description = 'x'.repeat(1001); segment.name = 'x'.repeat(121)
  expect(configurationInput(draft).errors.map(e => e.path)).toEqual(expect.arrayContaining(['/content/productDescription', '/content/segments/0/name', '/content/segments/0/description']))
  draft.separators.push('-')
  expect(configurationInput(draft).errors.some(e => e.path === '/content/separators')).toBeTruthy()
  const taxonomy = { principalId: '1', version: { content: { productFamilyName: 'F', basePrice: '0.00', separators: ['-'], segments: [{ id: 's1', placeholder: 'X', name: null, defaultOptionId: null, options: [] }, { id: 's2', placeholder: 'Y', name: null, defaultOptionId: null, options: [] }] } } }
  const loaded = fromTaxonomy(taxonomy as any)
  loaded.separators[0] = ''
  expect(taxonomy.version.content.separators).toEqual(['-'])
  delete (taxonomy.version.content as any).separators
  expect(fromTaxonomy(taxonomy as any).separators).toEqual(['-'])
})
