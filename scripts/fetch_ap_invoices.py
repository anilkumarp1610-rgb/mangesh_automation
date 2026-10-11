import pandas as pd

from config import load_config
from db import dispose_engines, get_engine

QUERY = "SELECT * FROM ap_invoices WHERE ap_paymentfile_id = 1001"


def fetch_ap_invoices() -> pd.DataFrame:
    """DB settings come from the MYSQL_* environment / the project .env (see config.py)."""
    try:
        return pd.read_sql(QUERY, get_engine(load_config().mysql))
    finally:
        dispose_engines()


if __name__ == "__main__":
    df = fetch_ap_invoices()
    print(df)
