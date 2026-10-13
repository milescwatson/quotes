import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { HttpError } from './shared.mjs';
export const MAX_BYTES = 512 * 1024;
const MAX_CENTS = 99999999999999n;
export function invalid(path, message, code = 'INVALID_INPUT', status = 422) {
  const error = new HttpError(status, code, message);
  error.fieldErrors = [{ path, code, message }];
  throw error;
}
export function object(value, keys, path = '', required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key)))
    invalid(path, 'Provide the required fields only.');
}
export function bounded(value) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BYTES)
    invalid('', 'Taxonomy exceeds 512 KiB.', 'PAYLOAD_TOO_LARGE', 413);
}
function text(value, limit, path, optional = false, multiline = false) {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(multiline ? value.replace(/[\r\n]/g, '') : value))
    invalid(path, 'Enter valid text without control characters.');
  const result = value.trim();
  if (optional && !result) return null;
  if (!result || [...result].length > limit) invalid(path, `Enter between 1 and ${limit} characters.`);
  return result;
}
export const summary = value => value === undefined ? null : text(value, 500, '/changeSummary', true);
export function cents(value) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const dollars = value => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
function money(value, path) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(value))
    invalid(path, 'Use a nonnegative USD decimal string with at most two decimal places.');
  return dollars(cents(value));
}
function unique(value, seen, path) {
  const key = value.toLowerCase();
  if (seen.has(key)) invalid(path, 'This value must be unique, ignoring case.');
  seen.add(key);
}
function entityId(value, previous, seen, path) {
  if (value === null) return randomUUID();
  if (typeof value !== 'string' || !previous.has(value) || seen.has(value))
    invalid(path, 'Use a retained ID from this parent or null for a new item.');
  seen.add(value);
  return value;
}
export function normalizeContent(input, previous = null) {
  object(input, ['productFamilyName', 'productDescription', 'separators', 'currency', 'basePrice', 'segments'], '/content', ['productFamilyName', 'currency', 'basePrice', 'segments']);
  if (input.currency !== 'USD') invalid('/content/currency', 'Currency must be USD.');
  if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 50)
    invalid('/content/segments', 'Provide 1–50 segments.', 'TAXONOMY_LIMIT_EXCEEDED');
  const separators = Object.hasOwn(input, 'separators') ? input.separators : Array(input.segments.length - 1).fill('-');
  if (!Array.isArray(separators) || separators.length !== input.segments.length - 1 || separators.some(s => s !== '-' && s !== ''))
    invalid('/content/separators', 'Provide one separator (- or blank) per gap.');
  const result = { schemaVersion: 1,
    productDescription: text(input.productDescription === undefined ? null : input.productDescription, 1000, '/content/productDescription', true, true),
    separators: [...separators],
    productFamilyName: text(input.productFamilyName, 120, '/content/productFamilyName'),
    currency: 'USD', basePrice: money(input.basePrice, '/content/basePrice'), segments: [] };
  const oldSegments = new Map((previous?.segments || []).map(s => [s.id, s]));
  const segmentIds = new Set(), placeholders = new Set(), names = new Set();
  let count = 0, maximum = cents(result.basePrice);
  result.segments = input.segments.map((s, i) => {
    const path = `/content/segments/${i}`;
    object(s, ['id', 'placeholder', 'name', 'description', 'defaultOptionIndex', 'options'], path, ['id', 'placeholder', 'name', 'defaultOptionIndex', 'options']);
    const id = entityId(s.id, oldSegments, segmentIds, `${path}/id`);
    const placeholder = text(s.placeholder, 32, `${path}/placeholder`);
    const name = text(s.name, 120, `${path}/name`, true);
    unique(placeholder, placeholders, `${path}/placeholder`);
    if (name !== null) unique(name, names, `${path}/name`);
    if (!Array.isArray(s.options) || s.options.length < 1 || s.options.length > 500 || (count += s.options.length) > 2000)
      invalid(`${path}/options`, 'Provide 1–500 options per segment and at most 2,000 total.', 'TAXONOMY_LIMIT_EXCEEDED');
    const oldOptions = new Map((oldSegments.get(id)?.options || []).map(o => [o.id, o]));
    const optionIds = new Set(), codes = new Set();
    const options = s.options.map((o, j) => {
      const op = `${path}/options/${j}`;
      object(o, ['id', 'code', 'description', 'price'], op);
      const optionId = entityId(o.id, oldOptions, optionIds, `${op}/id`);
      const code = text(o.code, 64, `${op}/code`);
      if (/\s/u.test(code)) invalid(`${op}/code`, 'Codes cannot contain whitespace.');
      unique(code, codes, `${op}/code`);
      return { id: optionId, code, description: text(o.description, 1000, `${op}/description`, true), price: money(o.price, `${op}/price`) };
    });
    maximum += options.reduce((max, o) => cents(o.price) > max ? cents(o.price) : max, 0n);
    const index = s.defaultOptionIndex;
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= options.length))
      invalid(`${path}/defaultOptionIndex`, 'Choose a default from this segment or null.');
    return { id, placeholder, name, description: text(s.description === undefined ? null : s.description, 1000, `${path}/description`, true, true), defaultOptionId: index === null ? null : options[index].id, options };
  });
  if (maximum > MAX_CENTS) invalid('/content', 'The maximum configured price exceeds the USD limit.', 'PRICE_OUT_OF_RANGE');
  bounded(result);
  return result;
}
export function checkedSnapshot(content) {
  try {
    object(content, ['schemaVersion', 'productFamilyName', 'productDescription', 'separators', 'currency', 'basePrice', 'segments'], '', ['schemaVersion', 'productFamilyName', 'currency', 'basePrice', 'segments']);
    if (content.schemaVersion !== 1) throw new Error('Unsupported format');
    const input = { productFamilyName: content.productFamilyName, productDescription: content.productDescription, separators: withDefaults(content).separators, currency: content.currency,
      basePrice: content.basePrice, segments: content.segments.map(s => {
        object(s, ['id', 'placeholder', 'name', 'description', 'defaultOptionId', 'options'], '', ['id', 'placeholder', 'name', 'defaultOptionId', 'options']);
        if (typeof s.id !== 'string' || !s.id || s.options.some(o => typeof o.id !== 'string' || !o.id)) throw new Error('Invalid ID');
        return { id: s.id, placeholder: s.placeholder, name: s.name, description: s.description,
          defaultOptionIndex: s.defaultOptionId === null ? null : s.options.findIndex(o => o.id === s.defaultOptionId), options: s.options };
      }) };
    const normalized = normalizeContent(input, content);
    if (!isDeepStrictEqual(normalized, withDefaults(content))) throw new Error('Noncanonical snapshot');
    return content;
  } catch { throw new Error('Stored taxonomy integrity failure'); }
}
function withDefaults(content) {
  return { productDescription: null, separators: Array(Math.max(0, content.segments.length - 1)).fill('-'), ...content,
    segments: content.segments.map(s => ({ description: null, ...s })) };
}
export const sameContent = (a, b) => isDeepStrictEqual(withDefaults(a), withDefaults(b));
export function configure(content, selections) {
  if (!Array.isArray(selections) || selections.length > content.segments.length)
    invalid('/selections', 'Provide one choice per segment at most.');
  const choices = new Map();
  selections.forEach((s, i) => {
    object(s, ['segmentId', 'optionId'], `/selections/${i}`);
    const segment = content.segments.find(segment => segment.id === s.segmentId);
    if (!segment || choices.has(s.segmentId) || !segment.options.some(o => o.id === s.optionId))
      invalid(`/selections/${i}`, 'Choose an option from the current segment.');
    choices.set(s.segmentId, s.optionId);
  });
  let total = cents(content.basePrice);
  const resolved = content.segments.map(s => {
    const id = choices.get(s.id) ?? (s.options.length === 1 ? s.options[0].id : s.defaultOptionId);
    const option = s.options.find(o => o.id === id);
    if (!option) invalid('/selections', `Choose an option for ${s.placeholder}.`, 'SELECTION_REQUIRED');
    total += cents(option.price);
    return { segmentId: s.id, placeholder: s.placeholder, name: s.name, optionId: option.id,
      code: option.code, description: option.description, price: option.price };
  });
  if (total > MAX_CENTS) invalid('/selections', 'Configured price exceeds the USD limit.', 'PRICE_OUT_OF_RANGE');
  return { productFamilyName: content.productFamilyName, partNumber: resolved.map((s, i) => (i ? (content.separators?.[i - 1] ?? '-') : '') + s.code).join(''),
    currency: 'USD', basePrice: content.basePrice, unitPrice: dollars(total), selections: resolved };
}
