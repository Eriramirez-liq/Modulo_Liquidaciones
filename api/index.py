"""
Vercel WSGI entry point — importa la factory Flask y expone `app`.
Vercel's Python runtime busca una variable `app` en este módulo.
"""
import sys
import os

# Agrega la raíz del proyecto al path para que `from app import ...` funcione
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app

app = create_app()
