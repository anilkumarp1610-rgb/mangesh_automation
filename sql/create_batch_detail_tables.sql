-- ============================================================================
-- Standalone DDL for the payment-file-sync feature (scripts/sync_payment_files.py)
-- that a pre-existing database won't have yet:
--   ap_payment_file_details             <- gains 11 columns for the raw Get Payment
--                                           Batches API record (client, amounts, etc.)
--   ap_batch_invoice_details            <- raw invoiceAPBatchDetails[] entry (flat fields)
--   ap_batch_invoice_allocation_values  <- child rows of ap_batch_invoice_details.allocationValues[]
--   ap_batch_invoice_custom             <- child rows of ap_batch_invoice_details.custom[]
--
-- Safe to run against an existing database: ADD COLUMN IF NOT EXISTS / CREATE
-- TABLE IF NOT EXISTS throughout (requires MySQL 8.0.29+ for the former).
-- Requires ap_payment_file_details to already exist (see sql/create_tables.sql
-- / sql/migrate_payment_file_processing.sql). This is the same DDL as in
-- sql/create_tables.sql -- kept here standalone so it can be applied on its
-- own to a database that already has everything else.
--
-- Note: an earlier version of this script created a separate ap_batch_details
-- table instead of adding these columns directly to ap_payment_file_details.
-- If you already ran that version, use sql/migrate_merge_ap_batch_details.sql
-- instead (or in addition, it's idempotent) to fold that table in.
-- ============================================================================

USE airflow;

-- Raw response of the Get Payment Batches API -- GET /invoices/invoiceAPBatches
-- -- these columns hold the API record for whichever batch sync_payment_files.py
-- just inserted this row for. ap_batch_status/processed_date/log_id remain
-- pipeline-owned, distinct from the upstream ap_payment_file_status column.
ALTER TABLE ap_payment_file_details
    ADD COLUMN IF NOT EXISTS client                VARCHAR(200),
    ADD COLUMN IF NOT EXISTS ap_created_date       DATETIME,
    ADD COLUMN IF NOT EXISTS ap_payment_file_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS no_of_invoices        INT,
    ADD COLUMN IF NOT EXISTS no_of_vendors         INT,
    ADD COLUMN IF NOT EXISTS earliest_due_date     DATETIME,
    ADD COLUMN IF NOT EXISTS currency              VARCHAR(10),
    ADD COLUMN IF NOT EXISTS invoice_amount        DECIMAL(18,2),
    ADD COLUMN IF NOT EXISTS allocated_amount      DECIMAL(18,2),
    ADD COLUMN IF NOT EXISTS detail_invoice_amount DECIMAL(18,2),
    ADD COLUMN IF NOT EXISTS fetched_datetime      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Raw response of the Get Invoice List API -- GET
-- /invoices/invoiceAPBatchesDetails?paymentFileId=... -- one row per
-- invoiceAPBatchDetails[] entry, keyed to the ap_payment_file_details row that
-- triggered the pull. Its nested allocationValues[]/custom[] arrays are
-- normalized into the two child tables below, keeping the API response shape
-- as-is rather than flattening it into JSON.
CREATE TABLE IF NOT EXISTS ap_batch_invoice_details (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ap_payment_file_detail_id   INT NOT NULL,
    ap_batch_name                VARCHAR(100),
    client                       VARCHAR(200),
    organization                 VARCHAR(200),
    account_number               VARCHAR(100),
    vendor                       VARCHAR(200),
    account_hierarchy            VARCHAR(200),
    phase_detail                 VARCHAR(200),
    invoice_cycle                VARCHAR(100),
    invoice_type                 VARCHAR(100),
    invoice_processing_type      VARCHAR(100),
    invoice_source                VARCHAR(100),
    payment_term                 VARCHAR(100),
    payment_mode                 VARCHAR(100),
    pay_group                    VARCHAR(100),
    profit_center                VARCHAR(100),
    company_code                 VARCHAR(100),
    billing_address               VARCHAR(500),
    account_owner                 VARCHAR(200),
    invoice_number                VARCHAR(100),
    invoice_id                    BIGINT,
    invoice_status                VARCHAR(50),
    invoice_date                  DATETIME,
    billing_period_from           DATETIME,
    billing_period_to             DATETIME,
    invoice_month_year            VARCHAR(20),
    payment_due_date              DATETIME,
    total_amount_due              DECIMAL(18,2),
    past_due_balance              DECIMAL(18,2),
    total_current_charges         DECIMAL(18,2),
    sub_account_number            VARCHAR(100),
    wtn_or_circuit_id              VARCHAR(100),
    wtn                            VARCHAR(100),
    circuit_number                 VARCHAR(100),
    invoice_amount                 DECIMAL(18,2),
    sales_tax_amount               DECIMAL(18,2),
    distribution_line              INT,
    is_deleted                     VARCHAR(10),
    posting_date                   DATETIME,
    vendor_code                    VARCHAR(100),
    vendor_remit_address_id        VARCHAR(100),
    remit_address                  VARCHAR(500),
    fetched_datetime                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_batch_invoice_details_invoice_number (invoice_number),
    KEY ix_batch_invoice_details_payment_file_detail_id (ap_payment_file_detail_id),
    CONSTRAINT fk_batch_invoice_details_payment_file FOREIGN KEY (ap_payment_file_detail_id)
        REFERENCES ap_payment_file_details (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- invoiceAPBatchDetails[].allocationValues[] -- child rows of ap_batch_invoice_details,
-- one row per array entry.
CREATE TABLE IF NOT EXISTS ap_batch_invoice_allocation_values (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    batch_invoice_detail_id     BIGINT NOT NULL,
    allocation1                 VARCHAR(200),
    allocation2                 VARCHAR(200),
    allocation3                 VARCHAR(200),
    allocation4                 VARCHAR(200),
    allocation5                 VARCHAR(200),
    allocation6                 VARCHAR(200),
    allocation7                 VARCHAR(200),
    allocation8                 VARCHAR(200),
    allocation9                 VARCHAR(200),
    allocation10                VARCHAR(200),
    allocation11                VARCHAR(200),
    allocation12                VARCHAR(200),
    allocated_charges           DECIMAL(18,2),
    CONSTRAINT fk_batch_invoice_allocation_values_detail FOREIGN KEY (batch_invoice_detail_id)
        REFERENCES ap_batch_invoice_details (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- invoiceAPBatchDetails[].custom[] -- child rows of ap_batch_invoice_details,
-- one row per array entry.
CREATE TABLE IF NOT EXISTS ap_batch_invoice_custom (
    id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
    batch_invoice_detail_id     BIGINT NOT NULL,
    account_custom1             VARCHAR(200),
    account_custom2             VARCHAR(200),
    account_custom3             VARCHAR(200),
    account_custom4             VARCHAR(200),
    account_custom5             VARCHAR(200),
    account_custom6             VARCHAR(200),
    account_custom7             VARCHAR(200),
    account_custom8             VARCHAR(200),
    account_custom9             VARCHAR(200),
    account_custom10            VARCHAR(200),
    CONSTRAINT fk_batch_invoice_custom_detail FOREIGN KEY (batch_invoice_detail_id)
        REFERENCES ap_batch_invoice_details (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
