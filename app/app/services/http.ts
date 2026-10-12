import { ApiError, type ApiOptions } from '~/types/identity'
export function createHttp(base: string, token: () => Promise<string>) {
  return async function request<T>(
    path: string,
    options: ApiOptions = {},
  ): Promise<T> {
    if (!base)
      throw new ApiError(
        503,
        'CONFIGURATION',
        'The service is not configured yet. Please try again later.',
      )
    let response: Response
    try {
      response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
        method: options.method ?? 'GET',
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${await token()}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      })
    } catch (error) {
      if (error instanceof ApiError || (error as Error).name === 'AbortError')
        throw error
      throw new ApiError(
        503,
        'NETWORK_ERROR',
        'We could not reach the service. Check your connection and try again.',
      )
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok)
      throw new ApiError(
        response.status,
        data.code ?? 'REQUEST_FAILED',
        data.message ?? 'Something went wrong. Please try again.',
        data.requestId,
        data.fieldErrors,
        data.currentVersionId,
      )
    return data as T
  }
}
