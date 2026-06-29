import sqlite3
from kivymd.uix.screen import MDScreen


class LoginScreen(MDScreen):

    def go_to_register(self):
        self.manager.current = "register"

    def login_user(self):

        email = self.ids.email.text
        password = self.ids.password.text

        conn = sqlite3.connect("library.db")
        cursor = conn.cursor()

        cursor.execute(
            "SELECT * FROM users WHERE email=? AND password=?",
            (email, password)
        )

        user = cursor.fetchone()

        conn.close()

        if user:
            print("Login Successful")
            self.manager.current = "dashboard"
        else:
            print("Invalid Email or Password")