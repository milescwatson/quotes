import { invalid, cents, dollars } from './taxonomy-content.mjs';
export function multiple(value = 1, path = '/multiple') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000 || Math.abs(value * 10000 - Math.round(value * 10000)) > 0.000001) invalid(path,'Use a multiple from 0 to 1,000 with at most four decimal places.');
  return value;
}
export function netAmount(list, quoteMultiple) {
  const factor = BigInt(Math.round(quoteMultiple * 10000));
  return dollars((cents(list) * factor + 5000n) / 10000n);
}
export function flatSnapshot(partNumber, description, price, principalId = null, principalName = null) {
  return {content:{schemaVersion:1,productFamilyName:partNumber,productDescription:description,currency:'USD',basePrice:price,separators:[],segments:[]},principalId,principalName};
}
