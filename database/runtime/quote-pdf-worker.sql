-- Run once as the development database administrator, one statement per transaction.
-- No quote schema changes. Other environments must use their own IAM role ARN.
CREATE ROLE quotes_pdf_worker WITH LOGIN;
GRANT SELECT ON public.quotes, public.organizations, public.users TO quotes_pdf_worker;
AWS IAM GRANT quotes_pdf_worker TO 'arn:aws:iam::415221799122:role/quotes-development-quote-pdf-worker';
