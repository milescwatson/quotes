import { getPool, transactions } from './database.mjs';
import { createQuotePdfWorker } from './quote-pdf-worker.mjs';
export const handler = createQuotePdfWorker(work => transactions(getPool())(work));
