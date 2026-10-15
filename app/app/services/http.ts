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
    if (response.ok && options.responseType === 'image') {
      if (response.headers.get('content-type')?.split(';')[0] !== 'image/png')
        throw new ApiError(502, 'INVALID_LOGO', 'The service did not return a logo image. Please try again.')
      return await response.blob() as T
    }
    if (response.ok && options.responseType === 'blob') {
      if (!response.headers.get('content-type')?.startsWith('application/pdf'))
        throw new ApiError(502, 'INVALID_PDF', 'The service did not return a PDF. Please try again.')
      return await response.blob() as T
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
