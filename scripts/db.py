import mysql.connector
from mysql.connector import MySQLConnection

from config import MySqlConfig


def get_connection(cfg: MySqlConfig) -> MySQLConnection:
    return mysql.connector.connect(
        host=cfg.host,
        user=cfg.user,
        password=cfg.password,
        database=cfg.database,
    )
