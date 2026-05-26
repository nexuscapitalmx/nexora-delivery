import os
import logging
from dotenv import load_dotenv
from telegram import Update, ReplyKeyboardMarkup, ReplyKeyboardRemove
from telegram.ext import Application, CommandHandler, MessageHandler, ConversationHandler, filters, ContextTypes
from supabase import create_client

load_dotenv(dotenv_path=os.path.expanduser("~/Escritorio/MACG/credenciales/.env"))

TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
ADMIN_ID = 8995849570

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
logging.basicConfig(format="%(asctime)s - %(levelname)s - %(message)s", level=logging.WARNING)

# ── ESTADOS DEL CONVERSATION HANDLER ─────────────────────────────────────────
NOMBRE, TELEFONO, ZONA = range(3)

# ── HELPERS ───────────────────────────────────────────────────────────────────
def get_repartidor(telegram_id: int):
    r = supabase.table("repartidores").select("*").eq("telegram_id", telegram_id).execute()
    return r.data[0] if r.data else None

def menu_principal():
    return ReplyKeyboardMarkup([
        ["🟢 Activarme", "🔴 Desactivarme"],
        ["📦 Pedido activo", "💰 Mis ganancias"],
        ["📊 Mi perfil"]
    ], resize_keyboard=True)

def zonas_keyboard():
    return ReplyKeyboardMarkup([
        ["roma_condesa", "centro"],
        ["norte", "sur"],
        ["oriente", "poniente"]
    ], resize_keyboard=True, one_time_keyboard=True)

# ── REGISTRO ──────────────────────────────────────────────────────────────────
async def registro_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)

    if repartidor:
        if repartidor["activo"]:
            await update.message.reply_text("Ya estás registrado.", reply_markup=menu_principal())
        else:
            await update.message.reply_text("⏳ Tu registro está pendiente de aprobación. Te avisamos pronto.")
        return ConversationHandler.END

    await update.message.reply_text(
        "👋 Bienvenido a *Nexora Delivery*.\n\n"
        "Vamos a registrarte como repartidor. Son 3 preguntas rápidas.\n\n"
        "¿Cuál es tu nombre completo?",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardRemove()
    )
    return NOMBRE

async def registro_nombre(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["nombre"] = update.message.text.strip()
    await update.message.reply_text("📱 ¿Cuál es tu número de teléfono? (10 dígitos)")
    return TELEFONO

async def registro_telefono(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telefono = update.message.text.strip().replace(" ", "").replace("-", "")
    if not telefono.isdigit() or len(telefono) != 10:
        await update.message.reply_text("⚠️ Ingresa un número válido de 10 dígitos.")
        return TELEFONO
    context.user_data["telefono"] = telefono
    await update.message.reply_text("📍 ¿En qué zona operas principalmente?", reply_markup=zonas_keyboard())
    return ZONA

async def registro_zona(update: Update, context: ContextTypes.DEFAULT_TYPE):
    zonas_validas = ["roma_condesa", "centro", "norte", "sur", "oriente", "poniente"]
    zona = update.message.text.strip().lower()
    if zona not in zonas_validas:
        await update.message.reply_text("⚠️ Selecciona una zona válida del teclado.")
        return ZONA

    telegram_id = update.effective_user.id
    nombre = context.user_data["nombre"]
    telefono = context.user_data["telefono"]

    # Guarda en BD con activo=False (pendiente de aprobación)
    supabase.table("repartidores").insert({
        "telegram_id": telegram_id,
        "nombre": nombre,
        "telefono": telefono,
        "zona": zona,
        "activo": False,
        "disponible": False
    }).execute()

    # Notifica al admin
    await context.bot.send_message(
        chat_id=ADMIN_ID,
        text=f"🆕 *Nuevo repartidor solicita registro*\n\n"
             f"👤 Nombre: {nombre}\n"
             f"📱 Teléfono: {telefono}\n"
             f"📍 Zona: {zona}\n"
             f"🆔 Telegram ID: `{telegram_id}`\n\n"
             f"Para aprobar: `/aprobar {telegram_id}`\n"
             f"Para rechazar: `/rechazar {telegram_id}`",
        parse_mode="Markdown"
    )

    await update.message.reply_text(
        "✅ *Solicitud enviada.*\n\n"
        "El administrador revisará tu perfil y te notificará en breve.\n"
        "Normalmente tomamos menos de 24 horas.",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardRemove()
    )
    return ConversationHandler.END

async def registro_cancelar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Registro cancelado.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END

# ── ADMIN: APROBAR / RECHAZAR ─────────────────────────────────────────────────
async def aprobar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return

    if not context.args:
        await update.message.reply_text("Uso: /aprobar TELEGRAM_ID")
        return

    telegram_id = int(context.args[0])
    repartidor = get_repartidor(telegram_id)

    if not repartidor:
        await update.message.reply_text("❌ No encontré ese repartidor.")
        return

    supabase.table("repartidores").update({"activo": True}).eq("telegram_id", telegram_id).execute()

    await context.bot.send_message(
        chat_id=telegram_id,
        text="🎉 *¡Fuiste aprobado como repartidor Nexora!*\n\n"
             "Ya puedes activarte y recibir pedidos.\n"
             "Usa /start para ver tu panel.",
        parse_mode="Markdown"
    )
    await update.message.reply_text(f"✅ Repartidor {repartidor['nombre']} aprobado.")

async def rechazar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return

    if not context.args:
        await update.message.reply_text("Uso: /rechazar TELEGRAM_ID")
        return

    telegram_id = int(context.args[0])
    repartidor = get_repartidor(telegram_id)

    if not repartidor:
        await update.message.reply_text("❌ No encontré ese repartidor.")
        return

    supabase.table("repartidores").delete().eq("telegram_id", telegram_id).execute()

    await context.bot.send_message(
        chat_id=telegram_id,
        text="Lo sentimos, tu solicitud no fue aprobada en este momento.\n"
             "Puedes intentarlo de nuevo más adelante."
    )
    await update.message.reply_text(f"❌ Repartidor {repartidor['nombre']} rechazado y eliminado.")

# ── PANEL REPARTIDOR ──────────────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)

    if not repartidor:
        await update.message.reply_text(
            "No estás registrado. Usa /registro para solicitar acceso."
        )
        return

    if not repartidor["activo"]:
        await update.message.reply_text("⏳ Tu registro está pendiente de aprobación.")
        return

    nivel = repartidor["nivel"]
    niveles = {1: "Básico", 2: "Pro", 3: "Elite"}
    await update.message.reply_text(
        f"Hola *{repartidor['nombre']}* {'⭐' * nivel}\n\n"
        f"Panel de repartidores Nexora — Nivel {niveles[nivel]}\n"
        f"Usa los botones para gestionar tu turno.",
        parse_mode="Markdown",
        reply_markup=menu_principal()
    )

async def activar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor or not repartidor["activo"]:
        await update.message.reply_text("⛔ No tienes acceso.")
        return
    supabase.table("repartidores").update({"disponible": True}).eq("telegram_id", telegram_id).execute()
    await update.message.reply_text("🟢 Estás *activo*. Recibirás pedidos en tu zona.", parse_mode="Markdown")

async def desactivar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor or not repartidor["activo"]:
        await update.message.reply_text("⛔ No tienes acceso.")
        return
    supabase.table("repartidores").update({"disponible": False}).eq("telegram_id", telegram_id).execute()
    await update.message.reply_text("🔴 Estás *inactivo*. No recibirás pedidos.", parse_mode="Markdown")

async def perfil(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor or not repartidor["activo"]:
        await update.message.reply_text("⛔ No tienes acceso.")
        return
    estado = "🟢 Activo" if repartidor["disponible"] else "🔴 Inactivo"
    nivel = repartidor["nivel"]
    niveles = {1: "Básico", 2: "Pro", 3: "Elite"}
    await update.message.reply_text(
        f"📊 *Tu perfil*\n\n"
        f"👤 {repartidor['nombre']}\n"
        f"📍 Zona: {repartidor['zona']}\n"
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
    if not repartidor or not repartidor["activo"]:
        await update.message.reply_text("⛔ No tienes acceso.")
        return
    pagos = supabase.table("pagos").select("*").eq("repartidor_id", repartidor["id"]).order("created_at", desc=True).limit(5).execute()
    if not pagos.data:
        await update.message.reply_text(f"💰 Esta semana: *${repartidor['ganancias_semana']} MXN*\n\nAún no tienes pagos registrados.", parse_mode="Markdown")
        return
    historial = "\n".join([f"• {p['semana_inicio']} → ${p['monto_total']} MXN ({'✅' if p['pagado'] else '⏳'})" for p in pagos.data])
    await update.message.reply_text(f"💰 Esta semana: *${repartidor['ganancias_semana']} MXN*\n\nÚltimos pagos:\n{historial}", parse_mode="Markdown")

async def pedido_activo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.effective_user.id
    repartidor = get_repartidor(telegram_id)
    if not repartidor or not repartidor["activo"]:
        await update.message.reply_text("⛔ No tienes acceso.")
        return
    pedido = supabase.table("pedidos").select("*").eq("repartidor_id", repartidor["id"]).in_("estado", ["aceptado", "recogido", "en_camino"]).execute()
    if not pedido.data:
        await update.message.reply_text("📭 No tienes pedidos activos en este momento.")
        return
    p = pedido.data[0]
    await update.message.reply_text(
        f"📦 *Pedido activo*\n\n"
        f"🏠 Recoger en: {p['origen_texto']}\n"
        f"📍 Entregar en: {p['destino_texto']}\n"
        f"📝 {p['descripcion'] or 'Sin descripción'}\n"
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

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()

    registro_handler = ConversationHandler(
        entry_points=[CommandHandler("registro", registro_start)],
        states={
            NOMBRE: [MessageHandler(filters.TEXT & ~filters.COMMAND, registro_nombre)],
            TELEFONO: [MessageHandler(filters.TEXT & ~filters.COMMAND, registro_telefono)],
            ZONA: [MessageHandler(filters.TEXT & ~filters.COMMAND, registro_zona)],
        },
        fallbacks=[CommandHandler("cancelar", registro_cancelar)]
    )

    app.add_handler(registro_handler)
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("aprobar", aprobar))
    app.add_handler(CommandHandler("rechazar", rechazar))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, mensaje_texto))

    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
