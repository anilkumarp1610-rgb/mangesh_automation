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
    UNIQUE KEY uq_invoice_summary_invoice_id (invoice_id),
    CONSTRAINT fk_summary_log FOREIGN KEY (log_id) REFERENCES invoice_response_log (log_id)
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
