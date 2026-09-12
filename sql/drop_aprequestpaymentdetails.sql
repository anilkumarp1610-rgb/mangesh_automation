-- ============================================================================
-- Drops the legacy airflow.aprequestpaymentdetails table.
--
-- Background: this table (request_detail_id, request_id, payment_flie_id,
-- ap_batch_name) predates the Get Payment Batches API integration
-- (scripts/sync_payment_files.py). It has no interface_id column and its
-- payment-file ids don't overlap with ap_payment_file_details' -- it was
-- never read by any script in this repo (confirmed via full-repo search).
-- ap_payment_file_details is now the single source of truth for payment-file
-- batches: sync_payment_files.py populates it per interface_id directly from
-- the upstream API (fromDate/toDate window), which is the same information
-- aprequestpaymentdetails used to hold, so no data migration is needed here.
-- ============================================================================

USE airflow;

DROP TABLE IF EXISTS aprequestpaymentdetails;
