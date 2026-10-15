import { createRegularProductService } from './regular-products.mjs';
import { getPool, transactions } from './database.mjs';
import { createIdentityService } from './identity.mjs';
import { createTaxonomyService } from './taxonomy.mjs';
import { createPrincipalService } from './principals.mjs';
import { createApp } from './app.mjs';
import { createLambdaHandler } from './lambda.mjs';
// Pool creation stays lazy; health and session need no database connection.
const services = {
  regularProducts: createRegularProductService(work => transactions(getPool())(work)),
  identity: createIdentityService((work) => transactions(getPool())(work)),
  taxonomy: createTaxonomyService((work) =>
    transactions(getPool(), { attempts: 1 })(work),
  ),
  principals: createPrincipalService((work) =>
    transactions(getPool(), { attempts: 1 })(work),
  ),
};
export const handler = createLambdaHandler(createApp({ services }));
