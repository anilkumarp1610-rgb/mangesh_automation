-- ============================================================================
-- Drops the legacy airflow.aprequestdetails table.
--
-- Confirmed via full-repo search (scripts/, tracker/, sql/, dags/, docs/):
-- no script, DAG, or tracker module reads or writes this table. Like
-- aprequestpaymentdetails (see sql/drop_aprequestpaymentdetails.sql, dropped
-- 2026-09-12), it predates the current payment-file-sync flow and isn't part
-- of it.
-- ============================================================================

USE airflow;

DROP TABLE IF EXISTS aprequestdetails;
