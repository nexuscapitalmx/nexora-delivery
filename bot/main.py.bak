import os
import logging
from dotenv import load_dotenv
from telegram import Update, ReplyKeyboardMarkup, KeyboardButton
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
from supabase import create_client

load_dotenv(dotenv_path=os.path.expanduser("~/Escritorio/MACG/credenciales/.env"))

TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

# ── HELPERS ──────────────────────────────────────────────────────────────────

def get_repartidor(telegram_id: int):
    r = supabase.table("repartidores").select("*").eq("telegram_id", telegram_id).execute()
    return r.data[0] if r.data else None

def menu_principal():
    return ReplyKeyboardMarkup([
        ["🟢 Activarme", "🔴 Desactivarme"],
        ["📦 Pedido activo", "💰 Mis ganancias"],
        ["📊 Mi perfil"]
    ], resize_keyboard=True)

# ── COMANDOS ─────────────────────────────────────────────────────────────────

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)

    if not repartidor:
        await update.message.reply_text(
            "⛔ No estás registrado como repartidor.\n"
            "Contacta al administrador para darte de alta."
        )
        return

    nombre = repartidor["nombre"]
    nivel = repartidor["nivel"]
    estrellas = "⭐" * nivel

    await update.message.reply_text(
        f"Hola *{nombre}* {estrellas}\n\n"
        f"Bienvenido al panel de repartidores Nexora.\n"
        f"Usa los botones para gestionar tu turno.",
        parse_mode="Markdown",
        reply_markup=menu_principal()
    )

async def activar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor:
        await update.message.reply_text("⛔ No estás registrado.")
        return

    supabase.table("repartidores").update({"disponible": True}).eq("telegram_id", telegram_id).execute()
    await update.message.reply_text("🟢 Estás *activo*. Recibirás pedidos en tu zona.", parse_mode="Markdown")

async def desactivar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor:
        await update.message.reply_text("⛔ No estás registrado.")
        return

    supabase.table("repartidores").update({"disponible": False}).eq("telegram_id", telegram_id).execute()
    await update.message.reply_text("🔴 Estás *inactivo*. No recibirás pedidos.", parse_mode="Markdown")

async def perfil(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor:
        await update.message.reply_text("⛔ No estás registrado.")
        return

    estado = "🟢 Activo" if repartidor["disponible"] else "🔴 Inactivo"
    nivel = repartidor["nivel"]
    niveles = {1: "Básico", 2: "Pro", 3: "Elite"}

    await update.message.reply_text(
        f"📊 *Tu perfil*\n\n"
        f"👤 {repartidor['nombre']}\n"
        f"📍 Zona: {repartidor['zona'] or 'Sin asignar'}\n"
        f"🏆 Nivel: {niveles[nivel]} {'⭐' * nivel}\n"
        f"⭐ Rating: {repartidor['rating_promedio']}/5.0\n"
        f"📦 Entregas totales: {repartidor['entregas_totales']}\n"
        f"💰 Ganancias esta semana: ${repartidor['ganancias_semana']} MXN\n"
        f"Estado: {estado}",
        parse_mode="Markdown"
    )

async def ganancias(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor:
        await update.message.reply_text("⛔ No estás registrado.")
        return

    pagos = supabase.table("pagos")\
        .select("*")\
        .eq("repartidor_id", repartidor["id"])\
        .order("created_at", desc=True)\
        .limit(5)\
        .execute()

    if not pagos.data:
        await update.message.reply_text(
            f"💰 Esta semana: *${repartidor['ganancias_semana']} MXN*\n\n"
            "Aún no tienes pagos registrados.",
            parse_mode="Markdown"
        )
        return

    historial = "\n".join([
        f"• {p['semana_inicio']} → ${p['monto_total']} MXN ({'✅' if p['pagado'] else '⏳'})"
        for p in pagos.data
    ])

    await update.message.reply_text(
        f"💰 Esta semana: *${repartidor['ganancias_semana']} MXN*\n\n"
        f"Últimos pagos:\n{historial}",
        parse_mode="Markdown"
    )

async def pedido_activo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor:
        await update.message.reply_text("⛔ No estás registrado.")
        return

    pedido = supabase.table("pedidos")\
        .select("*")\
        .eq("repartidor_id", repartidor["id"])\
        .in_("estado", ["aceptado", "recogido", "en_camino"])\
        .execute()

    if not pedido.data:
        await update.message.reply_text("📭 No tienes pedidos activos en este momento.")
        return

    p = pedido.data[0]
    await update.message.reply_text(
        f"📦 *Pedido activo*\n\n"
        f"🏠 Recoger en: {p['origen_texto']}\n"
        f"📍 Entregar en: {p['destino_texto']}\n"
        f"📝 Descripción: {p['descripcion'] or 'Sin descripción'}\n"
        f"💰 Tu ganancia: ${p['ganancia_repartidor']} MXN\n"
        f"Estado: {p['estado']}",
        parse_mode="Markdown"
    )

async def mensaje_texto(update: Update, context: ContextTypes.DEFAULT_TYPE):
    texto = update.message.text
    if texto == "🟢 Activarme":
        await activar(update, context)
    elif texto == "🔴 Desactivarme":
        await desactivar(update, context)
    elif texto == "📊 Mi perfil":
        await perfil(update, context)
    elif texto == "💰 Mis ganancias":
        await ganancias(update, context)
    elif texto == "📦 Pedido activo":
        await pedido_activo(update, context)

# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, mensaje_texto))
    logger.info("Bot Nexora Repartidores iniciado...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
