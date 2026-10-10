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
