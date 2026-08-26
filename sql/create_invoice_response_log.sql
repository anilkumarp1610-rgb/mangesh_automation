-- ============================================================================
-- Invoice response Log Table
-- Stores one row per Get Invoice API call: the raw response body, HTTP status,
-- success flag, and the datetime the call was made. All downstream tables
-- (invoice_summary, invoice_detail, ...) reference this table via log_id.
-- ============================================================================

USE airflow;

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
