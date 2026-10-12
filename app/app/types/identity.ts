import type { components } from './api.generated'
export type Profile = components['schemas']['Profile']
export type Organization = components['schemas']['Organization']
export type Member = components['schemas']['Member']
export type Role = Member['role']
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}
export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public fieldErrors?: { path: string; code: string; message: string }[],
    public currentVersionId?: string,
  ) {
    super(message)
  }
}
export function safeDestination(value: unknown) {
  return typeof value === 'string' &&
    /^\/(organizations|profile)(\/|\?|$)/.test(value) &&
    !value.includes('\\')
    ? value
    : '/'
}
