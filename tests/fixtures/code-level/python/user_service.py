from typing import List

class User:
    def __init__(self, name: str):
        self.name = name
    def get_name(self) -> str:
        return self.name
    @property
    def display_name(self) -> str:
        return self.name
    @classmethod
    def anonymous(cls) -> "User":
        return cls("anon")
    @staticmethod
    def is_valid(name: str) -> bool:
        return bool(name)

class UserService(User):
    def __init__(self, users: List[User]):
        self.users = users
    def find_by_name(self, name: str) -> User:
        return None

def format_user(u: User) -> str:
    return u.get_name()

def _internal_helper():
    pass
