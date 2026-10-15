import type { components } from './api.generated'

export type Quote = components['schemas']['Quote']
export type QuotePage = components['schemas']['QuotePage']
export type QuoteOwner = components['schemas']['QuoteOwner']
export type QuoteOwners = components['schemas']['QuoteOwners']
export interface QuoteFilters {
  customer: string
  project: string
  ownerId: string
}
export type QuoteDetail = components['schemas']['QuoteDetail']
export type QuoteLine = components['schemas']['QuoteLine']
type LineInput = components['schemas']['QuoteLineInput']
export type QuoteLineInput = Pick<LineInput, 'id' | 'quantity'> & (
  | { kind?: 'configured'; taxonomyId: string; versionId: string; selections: (string | null)[] }
  | { kind: 'regular'; regularProductId: string }
  | { kind: 'freeform'; partNumber: string; description: string; listPrice: string }
)
export type QuoteSnapshot = components['schemas']['QuoteConfigurationSnapshot']
export type QuoteProduct = components['schemas']['TaxonomyListResponse']['items'][number]
export type LocalQuoteLine = Omit<QuoteLine, 'id'> & { id: string | null; key: string }

export type RegularProduct = components['schemas']['RegularProduct']
