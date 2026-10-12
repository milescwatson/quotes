import { test, expect } from '@playwright/test'
import { blankConfiguration, blankSegment, blankOption, configurationInput, formatPrice } from '../app/utils/configuration'
test('price input normalizes common formats with exact cents and rejects invalid input', () => {
  for (const [raw, value] of [['.50','0.50'],['1.','1.00'],['$1,234.567','1234.57'],['USD 000.005','0.01'],['9.999','10.00'],['999999999999.99','999999999999.99']]) expect(formatPrice(raw!)).toBe(value)
  for (const raw of ['','abc','1,23','$-1','1e2','Infinity','999999999999.999','1 23']) expect(formatPrice(raw)).toBeNull()
  expect(formatPrice('', true)).toBe('0.00')
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
