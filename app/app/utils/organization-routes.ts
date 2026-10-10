// URL aliases are labels only; the API still authorizes every request by ID.
export async function organizationRouteId(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id.toLowerCase()))
  return Array.from(new Uint8Array(digest).slice(0, 6), byte => byte.toString(16).padStart(2, '0')).join('')
}
