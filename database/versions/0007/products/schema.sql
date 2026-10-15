-- Additive migration after 0006. One statement per transaction; await async validation.
ALTER TABLE public.regular_products ADD COLUMN principal_id bigint;
ALTER TABLE public.regular_products ADD CONSTRAINT regular_products_principal_fk
  FOREIGN KEY (principal_id) REFERENCES public.principals(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE ASYNC public.regular_products VALIDATE CONSTRAINT regular_products_principal_fk;
