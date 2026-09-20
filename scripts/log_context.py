import contextvars

# Set (and reset, via a try/finally) around the block of code processing one
# payment file -- sync_payment_files.py's per-batch loop, and
# process_invoices.py::process_payment_file() -- so db_log_handler.DbLogHandler
# can tag every log record emitted in that scope with the batch it belongs to,
# without threading an explicit `extra=` through every single logger call.
current_payment_file_detail_id = contextvars.ContextVar(
    "current_payment_file_detail_id", default=None
)
