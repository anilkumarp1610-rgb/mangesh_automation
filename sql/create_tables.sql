-- ============================================================================
-- airflow.* tables to store Invoice Details API responses
-- Hierarchy:
--   ap_invoices           (1)  --source list of invoice numbers to process-->
--   invoice_response_log  (1)  --logged_into-->  raw API call audit trail
--   invoice_summary       (1)  --> invoice_detail (1)  --> invoice_line_detail (N)
--                                                           --> invoice_service (N)
--                                                                --> invoice_charge (N)
-- ============================================================================

USE airflow;

-- Interface settings, keyed by InterfaceId, one wide row per interface (e.g. CBTS_AP).
-- Secret columns (SFTP_Password, SMTP_Password, Platform_Password, Platform_AppAuthKey,
-- Platform_DB_Password): the tracker (tracker/) writes these AES-256-GCM encrypted as
-- enc:v1:<base64…>. Rows written by other tools may still be plaintext; readers must
-- handle both (scripts/repository.py decrypts enc:v1: values, passes plaintext through).
CREATE TABLE IF NOT EXISTS interfaceconfiguration (
    InterfaceId                  INT AUTO_INCREMENT PRIMARY KEY,
    InterfaceName                VARCHAR(200) NOT NULL,
    SFTP_Host                    VARCHAR(255),
    SFTP_Port                    INT,
    SFTP_UserName                VARCHAR(255),
    SFTP_Password                VARCHAR(500),
    SFTP_RemoteDirectory         VARCHAR(500),
    SMTP_Host                    VARCHAR(255),
    SMTP_Port                    INT,
    SMTP_UserId                  VARCHAR(255),
    SMTP_Password                VARCHAR(500),
    SMTP_UseTLS                  TINYINT(1),
    Platform_InstanceUrl         VARCHAR(500),
    Platform_UserId               VARCHAR(255),
    Platform_Password            VARCHAR(500),
    Platform_AppAuthKey          VARCHAR(500),
    Platform_DB_Server           VARCHAR(50),
    Platform_DB_User             VARCHAR(50),
    Platform_DB_Password         VARCHAR(500),  -- wide enough for the tracker's enc:v1: ciphertext
    Platform_DB_Name             VARCHAR(50),
    Platform_DB_AP_Query         LONGTEXT,
    IsActive                     TINYINT(1) NOT NULL DEFAULT 1,
    CreatedDate                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ModifiedDate                 DATETIME,
    Output_Directory             VARCHAR(500),
    Archive_Directory            VARCHAR(500),
    Email_Enabled                TINYINT(1) NOT NULL DEFAULT 1,
    Email_Sender_Email           VARCHAR(255),
    Email_Sender_Name            VARCHAR(255),
    Email_Recipients_To          LONGTEXT,
    Email_Recipients_Cc          LONGTEXT,
    Email_Subject                VARCHAR(500),
    Email_Body                   LONGTEXT,
    Email_Attachment_Enabled     TINYINT(1) NOT NULL DEFAULT 1,
    Email_Attachment_FilePath    VARCHAR(500),
    Email_Attachment_FileName    VARCHAR(500),
    Failure_Notification_Enabled TINYINT(1) NOT NULL DEFAULT 1,
    Failure_Subject              VARCHAR(500),
    Failure_Body                 LONGTEXT,
    Failure_Recipients_To        LONGTEXT,
    Failure_Recipients_Cc        LONGTEXT,
    output_combined              TINYINT(1),
    output_type                  VARCHAR(50),
    UNIQUE KEY UQ_InterfaceConfiguration_InterfaceName (InterfaceName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 0. AP Invoices Table (source list of invoices to process + last API call outcome)
CREATE TABLE IF NOT EXISTS ap_invoices (
    ap_invoice_id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    ap_invoice_number           VARCHAR(100) NOT NULL,
    ap_paymentfile_id           INT,
    created_date                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ap_invoice_api_status       VARCHAR(50),
    api_response_obj            JSON,
    api_response_status_code    INT,
    KEY ix_ap_invoices_invoice_number (ap_invoice_number),
    KEY ix_ap_invoices_paymentfile_id (ap_paymentfile_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 0a. AP Payment File Details (one row per payment-file batch; ap_batch_status
-- drives the foreach loop in process_invoices.py -- 'New' rows for a given
-- interface are processed, then flipped to 'Success'/'Failure').
-- ap_invoices.ap_paymentfile_id is a foreign key to this table's `id`.
-- `id` is AUTO_INCREMENT: upstream loaders may still supply it explicitly, but the
-- tracker UI (tracker/) inserts batches and needs MySQL to assign it.
--
-- client..fetched_datetime hold the raw Get Payment Batches API record for
-- this batch (formerly a separate 1:1 ap_batch_details table -- merged in
-- since it was always a 1:1 shadow, never queried independently; see
-- sql/migrate_merge_ap_batch_details.sql). ap_batch_status/processed_date/
-- invoice_process_uuid remain pipeline-owned (New/Success/Failure), distinct
-- from the upstream ap_payment_file_status column. invoice_process_uuid holds
-- the current run's UUID (formerly a separate ap_invoices_process_log table,
-- one row per run, referenced via a log_id FK -- merged in since a batch is
-- only ever processed by one run at a time; see
-- sql/migrate_merge_ap_invoices_process_log.sql).
CREATE TABLE IF NOT EXISTS ap_payment_file_details (
    id                          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ap_batch_name               VARCHAR(45),
    ap_batch_payment_file_id    INT,
    interface_id                INT,
    ap_batch_status             VARCHAR(45),
    processed_date               DATETIME,
    invoice_process_uuid         VARCHAR(45),
    client                       VARCHAR(200),
    ap_created_date               DATETIME,
    ap_payment_file_status        VARCHAR(50),
    no_of_invoices                INT,
    no_of_vendors                 INT,
    earliest_due_date             DATETIME,
    currency                      VARCHAR(10),
    invoice_amount                 DECIMAL(18,2),
    allocated_amount               DECIMAL(18,2),
    detail_invoice_amount          DECIMAL(18,2),
    fetched_datetime               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_payment_file_interface_status (interface_id, ap_batch_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 0a-i. AP Batch Invoice Details (raw response of the Get Invoice List API --
-- GET /invoices/invoiceAPBatchesDetails?paymentFileId=... -- one row per
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

-- 0a-ii. AP Batch Invoice Allocation Values (invoiceAPBatchDetails[].allocationValues[]
-- -- child rows of ap_batch_invoice_details, one row per array entry).
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

-- 0a-iii. AP Batch Invoice Custom (invoiceAPBatchDetails[].custom[] -- child
-- rows of ap_batch_invoice_details, one row per array entry).
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

-- 1. Invoice response Log Table (raw API response + datetime, one row per API call)
CREATE TABLE IF NOT EXISTS invoice_response_log (
    log_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    invoice_number      VARCHAR(100) NOT NULL,
    request_url         VARCHAR(2000) NOT NULL,
    http_status_code    INT,
    is_success          TINYINT(1),
    response_message    VARCHAR(500),
    response_body       JSON,
    error_message       TEXT,
    created_datetime    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    invoice_process_uuid VARCHAR(45),
    KEY ix_response_log_invoice_number (invoice_number),
    KEY ix_response_log_created_datetime (created_datetime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Invoice Summary Table (short "records" shape returned by the invoices API)
CREATE TABLE IF NOT EXISTS invoice_summary (
    summary_id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    invoice_id             BIGINT NOT NULL,
    invoice_number          VARCHAR(100) NOT NULL,
    billing_date            DATETIME,
    due_date                DATETIME,
    invoice_created_date    DATETIME,
    account_number          VARCHAR(100),
    account_id              BIGINT,
    total_amount_due        DECIMAL(18,2),
    amount_to_pay           DECIMAL(18,2),
    currency_symbol         VARCHAR(10),
    updated_date            DATETIME,
    created_date            DATETIME,
    account_service_type    VARCHAR(50),
    log_id                  BIGINT,
    fetched_datetime        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    invoice_process_uuid    VARCHAR(45),
    ap_payment_file_detail_id INT,
    UNIQUE KEY uq_invoice_summary_invoice_id (invoice_id),
    CONSTRAINT fk_summary_log FOREIGN KEY (log_id) REFERENCES invoice_response_log (log_id),
    CONSTRAINT fk_summary_payment_file FOREIGN KEY (ap_payment_file_detail_id)
        REFERENCES ap_payment_file_details (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Invoice Detail Table (full "records" shape when expand=true)
CREATE TABLE IF NOT EXISTS invoice_detail (
    detail_id                              BIGINT AUTO_INCREMENT PRIMARY KEY,
    invoice_id                             BIGINT NOT NULL,
    invoice_number                         VARCHAR(100) NOT NULL,
    organization                           VARCHAR(200),
    vendor_name                            VARCHAR(200),
    invoice_step                           VARCHAR(100),
    billing_date                           DATETIME,
    billing_period_from                    DATETIME,
    billing_period_to                      DATETIME,
    due_date                               DATETIME,
    payment_term_date                      DATETIME,
    invoice_received_date                  DATETIME,
    invoice_created_date                   DATETIME,
    account_number                         VARCHAR(100),
    account_id                             BIGINT,
    previous_balance                       DECIMAL(18,2),
    current_charges                        DECIMAL(18,2),
    payment_received_by_vendor             DECIMAL(18,2),
    late_payment_charges                   DECIMAL(18,2),
    balance_forward                        DECIMAL(18,2),
    vendor_adjustments                     DECIMAL(18,2),
    total_amount_due                       DECIMAL(18,2),
    client_adjustments                     DECIMAL(18,2),
    amount_to_pay                          DECIMAL(18,2),
    currency_symbol                        VARCHAR(10),
    customer_invoice_number                VARCHAR(100),
    customer_account_number                VARCHAR(100),
    customer_vendor_name                   VARCHAR(200),
    sla_comments                           TEXT,
    vendor_code                            VARCHAR(100),
    vendor_remit_address_id                VARCHAR(100),
    address                                VARCHAR(500),
    billing_name                           VARCHAR(200),
    billing_street_address                 VARCHAR(300),
    billing_city                           VARCHAR(100),
    billing_state                          VARCHAR(100),
    billing_country                        VARCHAR(100),
    billing_zip_code                       VARCHAR(20),
    invoice_type                           VARCHAR(50),
    updated_date                           DATETIME,
    created_date                           DATETIME,
    invoice_approved_not_approved_date     DATETIME,
    invoice_apporved_notapporved_by        VARCHAR(200), -- spelling matches source API field "invoiceApporvedNotapporvedBy"
    invoice_paid_date                      DATETIME,
    remit_city                             VARCHAR(100),
    remit_zip_code                         VARCHAR(20),
    remit_state                            VARCHAR(100),
    remit_country                          VARCHAR(100),
    remit_street_address                   VARCHAR(300),
    allocation_hierarchy                   VARCHAR(200),
    invoice_created_by                     VARCHAR(200),
    invoice_received_by                    VARCHAR(200),
    invoice_submitted_by                   VARCHAR(200),
    invoice_submitted_date                 DATETIME,
    invoice_reviewed_by                    VARCHAR(200),
    invoice_reviewed_date                  DATETIME,
    invoice_validated_by                   VARCHAR(200),
    invoice_validated_date                 DATETIME,
    ap_file_created_by                     VARCHAR(200),
    ap_file_created_date                   DATETIME,
    submitted_to_ap_date                   DATETIME,
    submitted_to_ap_by                     VARCHAR(200),
    is_sla_applicable                      VARCHAR(10),
    validation_iteration_count             INT,
    is_completed                           INT,
    prev_invoice_id                        BIGINT,
    is_auto_validated                      VARCHAR(10),
    is_auto_approved                       VARCHAR(10),
    is_auto_reviewed                       VARCHAR(10),
    is_locked                              INT,
    locked_by                              VARCHAR(200),
    ap_file_sent_date                      DATETIME,
    ap_file_sent_by                        VARCHAR(200),
    remit_address_match_flag               INT,
    invoice_variance_amount                DECIMAL(18,2),
    invoice_variance_percentage            DECIMAL(9,4),
    reason                                  VARCHAR(500),
    account_service_type                   VARCHAR(50),
    log_id                                  BIGINT,
    fetched_datetime                       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_invoice_detail_invoice_id (invoice_id),
    CONSTRAINT fk_detail_summary FOREIGN KEY (invoice_id) REFERENCES invoice_summary (invoice_id),
    CONSTRAINT fk_detail_log FOREIGN KEY (log_id) REFERENCES invoice_response_log (log_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4a. Invoice Line Detail Table (wrapper item of "invoiceDetails" array -> serviceTotalCount)
CREATE TABLE IF NOT EXISTS invoice_line_detail (
    line_detail_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
    detail_id            BIGINT NOT NULL,
    service_total_count  INT,
    created_datetime     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_linedetail_detail FOREIGN KEY (detail_id) REFERENCES invoice_detail (detail_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4b. Invoice Services Table ("invoiceServices" array under invoiceDetails)
CREATE TABLE IF NOT EXISTS invoice_service (
    service_pk              BIGINT AUTO_INCREMENT PRIMARY KEY,
    line_detail_id           BIGINT NOT NULL,
    service_index            INT,          -- source field "index"
    api_invoice_detail_id    BIGINT,        -- source field "invoiceDetailId" (as returned by API, not our own detail_id)
    sakon_service_id         BIGINT,
    service_id               VARCHAR(100),
    btn                       VARCHAR(100),
    sub_account_number        VARCHAR(100),
    CONSTRAINT fk_service_linedetail FOREIGN KEY (line_detail_id) REFERENCES invoice_line_detail (line_detail_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4c. Invoice Charges Table ("invoiceCharges" array under invoiceServices)
CREATE TABLE IF NOT EXISTS invoice_charge (
    charge_pk                BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_pk                BIGINT NOT NULL,
    invoice_charge_usage_id    BIGINT,
    sakon_service_detail_id    BIGINT,
    component1_type            VARCHAR(100),
    component                  VARCHAR(200),
    component1_id              BIGINT,
    description                VARCHAR(500),
    component2_id              BIGINT,
    current_month_charges      DECIMAL(18,2),
    previous_month_charges     DECIMAL(18,2),
    inventory_charge           DECIMAL(18,2),
    expected_rate               DECIMAL(18,4),
    usage_unit1_label           VARCHAR(100),
    usage_unit1_value           DECIMAL(18,4),
    usage_unit2_label           VARCHAR(100),
    usage_unit2_value           DECIMAL(18,4),
    CONSTRAINT fk_charge_service FOREIGN KEY (service_pk) REFERENCES invoice_service (service_pk) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



-- Base/seed records for ap_invoices. INSERT IGNORE keeps this script re-runnable:
-- rows are skipped (not duplicated or errored) if their ap_invoice_id already exists.
INSERT IGNORE INTO airflow.ap_invoices
(
    ap_invoice_id,
    ap_invoice_number,
    ap_paymentfile_id,
    created_date,
    ap_invoice_api_status,
    api_response_obj,
    api_response_status_code
)
VALUES
(1, 'INV-10001', 1001, '2026-08-26 05:00:00', 'SUCCESS', '{"invoice_id":1}', 200),
(2, 'INV-10002', 1002, '2026-08-26 05:01:00', 'SUCCESS', '{"invoice_id":2}', 200),
(3, 'INV-10003', 1003, '2026-08-26 05:02:00', 'PENDING', '{"invoice_id":3}', 202),
(4, 'INV-10004', 1004, '2026-08-26 05:03:00', 'FAILED',  '{"invoice_id":4}', 500),
(5, 'INV-10005', 1005, '2026-08-26 05:04:00', 'SUCCESS', '{"invoice_id":5}', 200),
(6, 'INV-10006', 1006, '2026-08-26 05:05:00', 'PENDING', '{"invoice_id":6}', 202),
(7, 'INV-10007', 1007, '2026-08-26 05:06:00', 'SUCCESS', '{"invoice_id":7}', 200),
(8, 'INV-10008', 1008, '2026-08-26 05:07:00', 'FAILED',  '{"invoice_id":8}', 400),
(9, 'INV-10009', 1009, '2026-08-26 05:08:00', 'SUCCESS', '{"invoice_id":9}', 200),
(10, 'INV-10010', 1010, '2026-08-26 05:09:00', 'PENDING', '{"invoice_id":10}', 202);

-- Base/seed records for ap_payment_file_details -- one open ('New') batch per
-- ap_paymentfile_id used above, and interface_id=1 to match the CBTS_AP row
-- seeded into interfaceconfiguration elsewhere. INSERT IGNORE keeps this
-- re-runnable.
INSERT IGNORE INTO airflow.ap_payment_file_details
(id, ap_batch_name, ap_batch_payment_file_id, interface_id, ap_batch_status, processed_date, log_id)
VALUES
(1001, 'CBTS_AP_BATCH_1001', 1001, 1, 'New', NULL, NULL),
(1002, 'CBTS_AP_BATCH_1002', 1002, 1, 'New', NULL, NULL),
(1003, 'CBTS_AP_BATCH_1003', 1003, 1, 'New', NULL, NULL),
(1004, 'CBTS_AP_BATCH_1004', 1004, 1, 'New', NULL, NULL),
(1005, 'CBTS_AP_BATCH_1005', 1005, 1, 'New', NULL, NULL),
(1006, 'CBTS_AP_BATCH_1006', 1006, 1, 'New', NULL, NULL),
(1007, 'CBTS_AP_BATCH_1007', 1007, 1, 'New', NULL, NULL),
(1008, 'CBTS_AP_BATCH_1008', 1008, 1, 'New', NULL, NULL),
(1009, 'CBTS_AP_BATCH_1009', 1009, 1, 'New', NULL, NULL),
(1010, 'CBTS_AP_BATCH_1010', 1010, 1, 'New', NULL, NULL);
