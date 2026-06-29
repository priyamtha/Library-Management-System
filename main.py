from kivymd.app import MDApp
from kivy.lang import Builder
from kivy.uix.screenmanager import ScreenManager

from screens.login_screen import LoginScreen
from screens.register_screen import RegisterScreen
from screens.dashboard_screen import DashboardScreen


class WindowManager(ScreenManager):
    pass


class SmartLibrary(MDApp):
    def build(self):

        Builder.load_file("kv/login.kv")
        Builder.load_file("kv/register.kv")
        Builder.load_file("kv/dashboard.kv")

        sm = WindowManager()

        sm.add_widget(LoginScreen(name="login"))
        sm.add_widget(RegisterScreen(name="register"))
        sm.add_widget(DashboardScreen(name="dashboard"))

        return sm


SmartLibrary().run()