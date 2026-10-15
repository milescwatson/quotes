import { createApp } from '../app.mjs';
import { createLambdaHandler } from '../lambda.mjs';
import { verifiedIdentityLookup } from '../authentication.mjs';
// Independent expected mappings for route injection tests.
export const mappings = [
  ['GET', '/organizations/:orgId/regular-products', 'regularProducts', 'list'],
  ['POST', '/organizations/:orgId/regular-products', 'regularProducts', 'save'],
  ['PUT', '/organizations/:orgId/regular-products/:productId', 'regularProducts', 'save'],
  ['POST', '/me/bootstrap', 'identity', 'bootstrapProfile'],
  ['GET', '/me', 'identity', 'readProfile'],
  ['PATCH', '/me', 'identity', 'updateProfile'],
  ['GET', '/me/organizations', 'identity', 'listProfileOrganizations'],
  ['GET','/organizations/:orgId/domains','identity','listOrganizationDomains'],
  ['PUT','/organizations/:orgId/domains','identity','updateOrganizationDomains'],
  ['GET','/organizations/:orgId/taxonomies/:taxonomyId/sharing','taxonomy','readTaxonomySharing'],
  ['PUT','/organizations/:orgId/taxonomies/:taxonomyId/sharing','taxonomy','updateTaxonomySharing'],
  ['GET', '/organizations/:orgId', 'identity', 'readOrganization'],
  ['PATCH', '/organizations/:orgId', 'identity', 'updateOrganization'],
  ['GET', '/organizations/:orgId/members', 'identity', 'listMembers'],
  ['POST', '/organizations/:orgId/members', 'identity', 'addMember'],
  [
    'PATCH',
    '/organizations/:orgId/members/:membershipId',
    'identity',
    'updateMember',
  ],
  [
    'DELETE',
    '/organizations/:orgId/members/:membershipId',
    'identity',
    'removeMember',
  ],
  ['GET', '/organizations/:orgId/quotes', 'identity', 'listQuotes'],
  ['GET', '/organizations/:orgId/quotes/:quoteId', 'identity', 'readQuote'],
  ['POST', '/organizations/:orgId/quotes', 'identity', 'createQuote'],
  ['PUT', '/organizations/:orgId/quotes/:quoteId', 'identity', 'updateQuote'],
  ['POST', '/organizations/:orgId/quotes/:quoteId/archive', 'identity', 'archiveQuote'],
  ['POST', '/organizations/:orgId/quotes/:quoteId/restore', 'identity', 'restoreQuote'],
  [
    'GET',
    '/organizations/:orgId/quote-owners',
    'identity',
    'listEligibleOwners',
  ],
  [
    'PATCH',
    '/organizations/:orgId/quotes/:quoteId',
    'identity',
    'updateQuoteOwner',
  ],
  ['GET', '/organizations/:orgId/taxonomies', 'taxonomy', 'listTaxonomies'],
  ['POST', '/organizations/:orgId/taxonomies', 'taxonomy', 'createTaxonomy'],
  [
    'GET',
    '/organizations/:orgId/taxonomies/:taxonomyId',
    'taxonomy',
    'readTaxonomy',
  ],
  [
    'POST',
    '/organizations/:orgId/taxonomies/:taxonomyId/versions',
    'taxonomy',
    'saveTaxonomyVersion',
  ],
  [
    'POST',
    '/organizations/:orgId/taxonomies/:taxonomyId/preview',
    'taxonomy',
    'previewTaxonomy',
  ],
  [
    'POST',
    '/organizations/:orgId/taxonomies/:taxonomyId/archive',
    'taxonomy',
    'archiveTaxonomy',
  ],
  ['GET', '/organizations/:orgId/principals', 'principals', 'listPrincipals'],
  ['POST', '/organizations/:orgId/principals', 'principals', 'createPrincipal'],
];
export const taxonomyRoutes = mappings
  .filter((row) => row[2] === 'taxonomy')
  .map(([method, path]) => `${method} ${path.replace(/:([\w]+)/g, '{$1}')}`);
export const principalRoutes = mappings
  .filter((row) => row[2] === 'principals')
  .map(([method, path]) => `${method} ${path.replace(/:([\w]+)/g, '{$1}')}`);
export function createHandler({ env, services, fetchUser }) {
  return createLambdaHandler(
    createApp({
      services: { identity: {}, taxonomy: {}, principals: {}, ...services },
      config: env,
      identityLookup: verifiedIdentityLookup(env, fetchUser),
    }),
  );
}
