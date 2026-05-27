import os, time, logging
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client
import requests

load_dotenv(dotenv_path=os.path.expanduser("~/Escritorio/MACG/credenciales/.env"))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
BOT_TOKEN    = os.getenv("TELEGRAM_BOT_TOKEN")
ADMIN_ID     = 8995849570

db = create_client(SUPABASE_URL, SUPABASE_KEY)
logging.basicConfig(format="%(asctime)s - %(levelname)s - %(message)s", level=logging.WARNING)

def telegram(mensaje):
    try:
        requests.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={"chat_id": ADMIN_ID, "text": mensaje, "parse_mode": "Markdown"}, timeout=10)
    except: pass

def ping_supabase():
    try:
        db.table("zonas").select("id").limit(1).execute()
        return True
    except: return False

def ping_bot():
    try:
        r = requests.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getMe", timeout=10)
        return r.json().get("ok", False)
    except: return False

def revisar_pedidos_sin_repartidor():
    hace_5min = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    pedidos = db.table("pedidos").select("*")\
        .in_("estado", ["pendiente", "buscando_repartidor"])\
        .is_("repartidor_id", "null")\
        .lt("created_at", hace_5min)\
        .execute().data
    if pedidos:
        for p in pedidos:
            telegram(f"⚠️ *Pedido sin repartidor*\n\nID: `{p['id'][:8]}`\nOrigen: {p['origen_texto'][:40]}\nTiempo: +5 min sin asignar")
            db.table("pedidos").update({"estado": "buscando_repartidor"}).eq("id", p["id"]).execute()

def revisar_pedidos_atorados():
    hace_3h = (datetime.utcnow() - timedelta(hours=3)).isoformat()
    pedidos = db.table("pedidos").select("*")\
        .in_("estado", ["recogido", "en_camino"])\
        .lt("created_at", hace_3h)\
        .execute().data
    for p in pedidos:
        telegram(f"🚨 *Pedido atorado*\n\nID: `{p['id'][:8]}`\nEstado: {p['estado']}\nLleva +3 horas en tránsito")

def revisar_ratings_bajos():
    repartidores = db.table("repartidores").select("*")\
        .lt("rating_promedio", 4.0)\
        .eq("activo", True)\
        .execute().data
    for r in repartidores:
        telegram(f"⭐ *Rating bajo*\n\n{r['nombre']} tiene {r['rating_promedio']}/5.0\nRevisar desempeño")

def reporte_semanal():
    ahora = datetime.utcnow()
    if ahora.weekday() == 4 and ahora.hour == 18 and ahora.minute < 1:
        inicio_semana = (ahora - timedelta(days=7)).date().isoformat()
        pedidos = db.table("pedidos").select("*")\
            .eq("estado", "entregado")\
            .gte("created_at", inicio_semana)\
            .execute().data
        total = sum(p["precio"] for p in pedidos)
        comision = sum(p["comision_plataforma"] or 0 for p in pedidos)
        telegram(
            f"📊 *Reporte semanal Nexora*\n\n"
            f"📦 Entregas: {len(pedidos)}\n"
            f"💰 Facturado: ${total:.0f} MXN\n"
            f"🏦 Tu comisión: ${comision:.0f} MXN\n\n"
            f"Recuerda liquidar repartidores hoy."
        )

def ciclo():
    errores = {"supabase": False, "bot": False}
    iteracion = 0

    telegram("🟢 *Supervisor Nexora iniciado*\nMonitoreando sistema cada 60 segundos.")

    while True:
        try:
            # Ping servicios
            if not ping_supabase():
                if not errores["supabase"]:
                    telegram("🔴 *ALERTA: Supabase no responde*")
                    errores["supabase"] = True
            else:
                if errores["supabase"]:
                    telegram("🟢 Supabase recuperado")
                errores["supabase"] = False

            if not ping_bot():
                if not errores["bot"]:
                    telegram("🔴 *ALERTA: Bot de Telegram no responde*")
                    errores["bot"] = True
            else:
                errores["bot"] = False

            # Revisiones cada ciclo
            revisar_pedidos_sin_repartidor()
            revisar_pedidos_atorados()

            # Revisiones cada 10 ciclos (~10 min)
            if iteracion % 10 == 0:
                revisar_ratings_bajos()
                reporte_semanal()

            iteracion += 1
            time.sleep(60)

        except Exception as e:
            telegram(f"💥 *Error en supervisor*\n`{str(e)[:200]}`")
            time.sleep(60)

if __name__ == "__main__":
    ciclo()
