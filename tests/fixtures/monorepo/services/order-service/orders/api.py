from fastapi import FastAPI, APIRouter
from orders.models import Order
from orders.db import get_session

app = FastAPI()
router = APIRouter()

class OrderHandler:
    pass

@router.get("/orders")
def list_orders():
    session = get_session()
    return session.query(Order).all()
