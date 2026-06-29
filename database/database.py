import sqlite3

conn = sqlite3.connect("library.db")

cursor = conn.cursor()

cursor.execute("""
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fullname TEXT,
    email TEXT UNIQUE,
    password TEXT
)
""")

conn.commit()
conn.close()

print("Database Created Successfully")