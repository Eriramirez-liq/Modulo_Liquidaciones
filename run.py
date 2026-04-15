"""
Punto de entrada de la aplicación Flask — App Conciliación SDLs
Uso: python run.py
"""
import os
from dotenv import load_dotenv

load_dotenv()

from app import create_app

app = create_app()

if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    port  = int(os.getenv("PORT", 5000))
    print(f"\n🚀 BIA Energy — Conciliación SDL")
    print(f"   Servidor corriendo en: http://localhost:{port}")
    print(f"   Modo debug: {debug}\n")
    app.run(host="0.0.0.0", port=port, debug=debug)
