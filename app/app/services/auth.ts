import {
  UserManager,
  WebStorageStateStore,
  InMemoryWebStorage,
} from 'oidc-client-ts'
import { ApiError, safeDestination } from '~/types/identity'
export function createAuth(config: {
  cognitoUserPoolId: string
  cognitoClientId: string
  cognitoDomain: string
}) {
  let manager: UserManager | undefined
  function getManager() {
    if (
      !config.cognitoUserPoolId ||
      !config.cognitoClientId ||
      !config.cognitoDomain
    )
      throw new ApiError(
        503,
        'CONFIGURATION',
        'Sign-in is not configured yet. Please contact your administrator.',
      )
    const region = config.cognitoUserPoolId.split('_')[0]
    manager ??= new UserManager({
      authority: `https://cognito-idp.${region}.amazonaws.com/${config.cognitoUserPoolId}`,
      client_id: config.cognitoClientId,
      redirect_uri: `${location.origin}/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile quotes-api/access',
      userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
      stateStore: new WebStorageStateStore({ store: sessionStorage }),
      automaticSilentRenew: false,
      loadUserInfo: false,
      monitorSession: false,
    })
    return manager
  }
  let renewing: Promise<import('oidc-client-ts').User | null> | undefined
  return {
    async signIn(destination: string) {
      await getManager().signinRedirect({
        state: { destination: safeDestination(destination) },
      })
    },
    async complete() {
      const user = await getManager().signinRedirectCallback()
      history.replaceState({}, '', '/auth/callback')
      return safeDestination(
        (user.state as { destination?: string })?.destination,
      )
    },
    async token() {
      let user = await getManager().getUser()
      if (user && (user.expires_in ?? 0) < 30 && user.refresh_token) {
        renewing ??= getManager()
          .signinSilent()
          .finally(() => {
            renewing = undefined
          })
        try {
          user = await renewing
        } catch {
          await getManager().removeUser()
          user = null
        }
      }
      if (!user || user.expired)
        throw new ApiError(
          401,
          'SESSION_EXPIRED',
          'Your session has expired. Please sign in again.',
        )
      return user.access_token
    },
    async signOut() {
      if (manager) {
        try {
          await manager.revokeTokens(['refresh_token'])
        } catch {
          /* Always clear the local session. */
        }
        await manager.removeUser()
      }
      if (config.cognitoDomain && config.cognitoClientId) {
        const url = new URL('/logout', config.cognitoDomain)
        url.searchParams.set('client_id', config.cognitoClientId)
        url.searchParams.set('logout_uri', location.origin)
        location.assign(url.href)
      }
    },
    async clear() {
      if (manager) await manager.removeUser()
    },
  }
}
