import pandas as pd
from sqlalchemy import create_engine
from urllib.parse import quote_plus

DB_HOST = "localhost"
DB_USER = "sa"
DB_PASSWORD = "Augday@11"
DB_NAME = "airflow"

QUERY = "SELECT * FROM airflow.ap_invoices Where ap_paymentfile_id = 1001  ;"


def fetch_ap_invoices() -> pd.DataFrame:
    engine = create_engine(
        f"mysql+mysqlconnector://{DB_USER}:{quote_plus(DB_PASSWORD)}@{DB_HOST}/{DB_NAME}"
    )
    df = pd.read_sql(QUERY, engine)
    engine.dispose()
    return df


if __name__ == "__main__":
    df = fetch_ap_invoices()
    print(df)
