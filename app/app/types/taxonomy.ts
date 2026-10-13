import type { components } from './api.generated'
export type Principal = components['schemas']['Principal']
export type PrincipalPage = components['schemas']['PrincipalListResponse']
export type Taxonomy = components['schemas']['Taxonomy']
export type TaxonomyPage = components['schemas']['TaxonomyListResponse']
export type TaxonomyInput = components['schemas']['TaxonomyContentInput']
export type FieldError = { path: string; code: string; message: string }
export type OptionDraft = { key: string; id: string | null; code: string; description: string; price: string }
export type SegmentDraft = { key: string; id: string | null; placeholder: string; name: string | null; description: string; defaultKey: string | null; options: OptionDraft[] }
export type ConfigurationDraft = { productFamilyName: string; productDescription: string; separators: ('-' | '')[]; principalId: string; basePrice: string; currency: 'USD'; segments: SegmentDraft[] }
