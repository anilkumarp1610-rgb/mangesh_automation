"""Shared MySQL connection pool.

One SQLAlchemy engine (and so one connection pool) per process and database,
used by everything: the pipeline's business connection (get_connection), the
log handler's dedicated connection, and the pandas CSV exports (get_engine).
Closing a connection returns it to the pool instead of dropping it.

Pool settings: size from MySql.PoolSize (default 5), pool_pre_ping to replace
connections the server has dropped, pool_recycle so none outlives MySQL's
wait_timeout. A run needs 3 at once (main + log handler + a CSV export).
"""
import threading
from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from config import MySqlConfig

_POOL_RECYCLE_SECONDS = 1800

_engines: dict[tuple, Engine] = {}
_lock = threading.Lock()


def get_engine(cfg: MySqlConfig) -> Engine:
    key = (cfg.host, cfg.user, cfg.database)
    with _lock:
        engine = _engines.get(key)
        if engine is None:
            engine = create_engine(
                f"mysql+mysqlconnector://{cfg.user}:{quote_plus(cfg.password)}"
                f"@{cfg.host}/{cfg.database}",
                pool_size=cfg.pool_size,
                max_overflow=0,
                pool_pre_ping=True,
                pool_recycle=_POOL_RECYCLE_SECONDS,
            )
            _engines[key] = engine
        return engine


def get_connection(cfg: MySqlConfig):
    """A pooled DBAPI connection: use .cursor()/.commit()/.rollback() as before;
    .close() hands it back to the pool (rolling back anything uncommitted)."""
    return get_engine(cfg).raw_connection()


def set_autocommit(conn, value: bool) -> None:
    """Set autocommit on the real driver connection behind a pooled one (setting
    it on the pool proxy would not reach the server). Reset it to False before
    close(), or the next borrower of this connection inherits it."""
    conn.driver_connection.autocommit = value


def dispose_engines() -> None:
    """Close every pooled connection. Call once at the end of a run/process."""
    with _lock:
        engines = list(_engines.values())
        _engines.clear()
    for engine in engines:
        engine.dispose()
