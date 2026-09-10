-- Tracker migration 001
-- The tracker UI creates AP batches directly, so `id` must be assigned by MySQL.
-- create_tables.sql defines ap_payment_file_details.id as a plain INT PK (rows
-- were previously supplied with explicit ids by upstream loaders).
ALTER TABLE ap_payment_file_details MODIFY id INT NOT NULL AUTO_INCREMENT;
