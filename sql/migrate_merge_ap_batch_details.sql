-- ============================================================================
-- Merges ap_batch_details into ap_payment_file_details (single source of
-- truth for a payment-file batch, instead of a 1:1-shadow table).
--
-- Background: ap_batch_details was a 1:1 raw-capture table for the Get
-- Payment Batches API response, inserted in the same transaction as its
-- parent ap_payment_file_details row and never queried independently.
-- Splitting them bought nothing once payment-file rows started coming from
-- the API instead of manual UI entry -- same reasoning as retiring
-- aprequestpaymentdetails (see sql/drop_aprequestpaymentdetails.sql).
--
-- ap_payment_file_details keeps its 3 existing pipeline-owned tracking
-- columns untouched (ap_batch_status, processed_date, log_id) and gains 11
-- new columns holding the API metadata that used to live in ap_batch_details.
-- ap_batch_details.id, .ap_payment_file_detail_id, .payment_file_id, and
-- .ap_batch_name are dropped as redundant (the parent row already has an id
-- and its own ap_batch_name / ap_batch_payment_file_id).
--
-- If ap_batch_details already has rows when you run this (this repo's own
-- dev DB had 0), UNCOMMENT the UPDATE ... JOIN backfill below before the
-- DROP TABLE, or that data will be lost.
-- ============================================================================

USE airflow;

ALTER TABLE ap_payment_file_details
    ADD COLUMN client                VARCHAR(200)   AFTER log_id,
    ADD COLUMN ap_created_date       DATETIME       AFTER client,
    ADD COLUMN ap_payment_file_status VARCHAR(50)   AFTER ap_created_date,
    ADD COLUMN no_of_invoices        INT            AFTER ap_payment_file_status,
    ADD COLUMN no_of_vendors         INT            AFTER no_of_invoices,
    ADD COLUMN earliest_due_date     DATETIME       AFTER no_of_vendors,
    ADD COLUMN currency              VARCHAR(10)    AFTER earliest_due_date,
    ADD COLUMN invoice_amount        DECIMAL(18,2)  AFTER currency,
    ADD COLUMN allocated_amount      DECIMAL(18,2)  AFTER invoice_amount,
    ADD COLUMN detail_invoice_amount DECIMAL(18,2)  AFTER allocated_amount,
    ADD COLUMN fetched_datetime      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER detail_invoice_amount;

-- Uncomment and run BEFORE the DROP TABLE below if ap_batch_details has rows:
-- UPDATE ap_payment_file_details b
-- JOIN ap_batch_details d ON d.ap_payment_file_detail_id = b.id
-- SET b.client = d.client,
--     b.ap_created_date = d.ap_created_date,
--     b.ap_payment_file_status = d.ap_payment_file_status,
--     b.no_of_invoices = d.no_of_invoices,
--     b.no_of_vendors = d.no_of_vendors,
--     b.earliest_due_date = d.earliest_due_date,
--     b.currency = d.currency,
--     b.invoice_amount = d.invoice_amount,
--     b.allocated_amount = d.allocated_amount,
--     b.detail_invoice_amount = d.detail_invoice_amount,
--     b.fetched_datetime = d.fetched_datetime;

DROP TABLE IF EXISTS ap_batch_details;
