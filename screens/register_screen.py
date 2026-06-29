import sqlite3
from kivymd.uix.screen import MDScreen


class RegisterScreen(MDScreen):

    def go_to_login(self):
        self.manager.current = "login"

    def register_user(self):

        fullname = self.ids.fullname.text
        email = self.ids.email.text
        password = self.ids.password.text

        if not fullname or not email or not password:
            print("Please fill all fields")
            return

        try:
            conn = sqlite3.connect("library.db")
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO users(fullname, email, password)
                VALUES (?, ?, ?)
            """, (fullname, email, password))

            conn.commit()
            conn.close()

            print("User Registered Successfully")

            self.ids.fullname.text = ""
            self.ids.email.text = ""
            self.ids.password.text = ""

            self.manager.current = "login"

        except sqlite3.IntegrityError:
            print("Email already exists")