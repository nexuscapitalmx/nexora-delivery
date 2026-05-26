const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let currentUser = null
let currentPedidoId = null
let selectedTipo = 'estandar'
let zonaOrigen = null
let zonaDestino = null
let fotoFile = null
let realtimeChannel = null

// ── NAVEGACIÓN ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById('screen-' + id).classList.add('active')
}

function showStep(n) {
  document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'))
  document.getElementById('step-' + n).classList.add('active')
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
db.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user
    await ensureUsuario(session.user)
    document.getElementById('header-user-name').textContent =
      session.user.email.split('@')[0]
    showScreen('home')
    loadPedidos()
  } else {
    showScreen('login')
  }
})

async function ensureUsuario(user) {
  const { data } = await db.from('usuarios').select('id').eq('email', user.email).single()
  if (!data) {
    await db.from('usuarios').insert({
      email: user.email,
      nombre: user.email.split('@')[0]
    })
  }
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('input-email').value.trim()
  if (!email) return
  const btn = document.getElementById('btn-login')
  btn.textContent = 'Enviando...'
  btn.disabled = true
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href }
  })
  if (error) {
    btn.textContent = 'Continuar'
    btn.disabled = false
    alert('Error: ' + error.message)
  } else {
    btn.textContent = 'Revisa tu correo ✓'
  }
})

// ── HOME ──────────────────────────────────────────────────────────────────────
async function loadPedidos() {
  if (!currentUser) return
  const { data: usuario } = await db.from('usuarios').select('id').eq('email', currentUser.email).single()
  if (!usuario) return

  const { data: pedidos } = await db.from('pedidos')
    .select('*')
    .eq('cliente_id', usuario.id)
    .order('created_at', { ascending: false })
    .limit(10)

  const activos = pedidos?.filter(p => !['entregado','cancelado_cliente','cancelado_sistema'].includes(p.estado)) || []
  document.getElementById('stat-total').textContent = pedidos?.length || 0
  document.getElementById('stat-activos').textContent = activos.length

  const lista = document.getElementById('lista-pedidos')
  if (!pedidos?.length) {
    lista.innerHTML = '<div class="empty-state">Aún no tienes envíos</div>'
    return
  }
  lista.innerHTML = pedidos.map(p => `
    <div class="pedido-item" onclick="verTracking('${p.id}')">
      <div>
        <div class="pedido-dest">${p.destino_texto.substring(0, 35)}...</div>
        <div class="pedido-meta">${new Date(p.created_at).toLocaleDateString('es-MX')} · $${p.precio} MXN</div>
      </div>
      <span class="pedido-estado estado-${p.estado.startsWith('cancelado') ? 'cancelado' : p.estado === 'entregado' ? 'entregado' : 'pendiente'}">
        ${estadoLabel(p.estado)}
      </span>
    </div>
  `).join('')
}

function estadoLabel(e) {
  const map = {
    pendiente: 'Pendiente', buscando_repartidor: 'Buscando',
    aceptado: 'Asignado', recogido: 'Recogido',
    en_camino: 'En camino', entregado: 'Entregado',
    cancelado_cliente: 'Cancelado', cancelado_sistema: 'Cancelado'
  }
  return map[e] || e
}

// ── NUEVO PEDIDO ──────────────────────────────────────────────────────────────
document.getElementById('btn-nuevo-pedido').addEventListener('click', () => {
  showScreen('nuevo')
  showStep(1)
})
document.getElementById('btn-back-nuevo').addEventListener('click', () => showScreen('home'))

// Cotizador en tiempo real
function actualizarCotizador() {
  const origen = document.getElementById('input-origen').value
  const destino = document.getElementById('input-destino').value
  zonaOrigen = detectarZona(origen)
  zonaDestino = detectarZona(destino)

  const tagO = document.getElementById('zona-origen-tag')
  const tagD = document.getElementById('zona-destino-tag')
  tagO.textContent = zonaOrigen ? `Zona: ${zonaOrigen}` : ''
  tagD.textContent = zonaDestino ? `Zona: ${zonaDestino}` : ''

  if (zonaOrigen && zonaDestino) {
    const tarifa = cotizar(zonaOrigen, zonaDestino)
    if (tarifa) {
      document.getElementById('precio-std').textContent = `$${tarifa.base} MXN`
      document.getElementById('precio-exp').textContent = `$${tarifa.express} MXN`
      document.getElementById('cotizador-box').style.display = 'block'
    }
  } else {
    document.getElementById('cotizador-box').style.display = 'none'
  }
}

document.getElementById('input-origen').addEventListener('input', actualizarCotizador)
document.getElementById('input-destino').addEventListener('input', actualizarCotizador)

document.querySelectorAll('.tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTipo = btn.dataset.tipo
  })
})

document.getElementById('btn-step1').addEventListener('click', () => {
  const origen = document.getElementById('input-origen').value.trim()
  const destino = document.getElementById('input-destino').value.trim()
  if (!origen || !destino) { alert('Ingresa origen y destino'); return }
  if (!zonaOrigen || !zonaDestino) { alert('No pude detectar las zonas. Incluye el nombre de la alcaldía o colonia.'); return }
  showStep(2)
})

// Foto
document.getElementById('input-foto').addEventListener('change', (e) => {
  fotoFile = e.target.files[0]
  if (fotoFile) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      document.getElementById('foto-preview').src = ev.target.result
      document.getElementById('foto-preview').style.display = 'block'
      document.getElementById('foto-placeholder').style.display = 'none'
    }
    reader.readAsDataURL(fotoFile)
  }
})

document.getElementById('btn-step2').addEventListener('click', () => {
  if (!fotoFile) { alert('La foto del paquete es obligatoria'); return }
  if (!document.getElementById('check-declaracion').checked) {
    alert('Debes aceptar la declaración de contenido'); return
  }
  // Llenar resumen
  const tarifa = cotizar(zonaOrigen, zonaDestino)
  const precio = selectedTipo === 'express' ? tarifa.express : tarifa.base
  document.getElementById('res-origen').textContent = document.getElementById('input-origen').value
  document.getElementById('res-destino').textContent = document.getElementById('input-destino').value
  document.getElementById('res-tipo').textContent = selectedTipo === 'express' ? '⚡ Express' : 'Estándar'
  document.getElementById('res-precio').textContent = `$${precio} MXN`
  showStep(3)
})

document.getElementById('btn-back-step2').addEventListener('click', () => showStep(1))
document.getElementById('btn-back-step3').addEventListener('click', () => showStep(2))

document.getElementById('btn-confirmar').addEventListener('click', async () => {
  const btn = document.getElementById('btn-confirmar')
  btn.textContent = 'Creando pedido...'
  btn.disabled = true

  try {
    const { data: usuario } = await db.from('usuarios').select('id').eq('email', currentUser.email).single()
    const tarifa = cotizar(zonaOrigen, zonaDestino)
    const precio = selectedTipo === 'express' ? tarifa.express : tarifa.base
    const comision = parseFloat((precio * 0.28).toFixed(2))
    const ganancia = parseFloat((precio * 0.72).toFixed(2))

    // Subir foto
    const ext = fotoFile.name.split('.').pop()
    const fotoPath = `pedidos/${Date.now()}.${ext}`
    await db.storage.from('fotos-paquetes').upload(fotoPath, fotoFile)
    const { data: urlData } = db.storage.from('fotos-paquetes').getPublicUrl(fotoPath)

    const { data: pedido, error } = await db.from('pedidos').insert({
      cliente_id: usuario.id,
      origen_texto: document.getElementById('input-origen').value,
      destino_texto: document.getElementById('input-destino').value,
      zona_origen: zonaOrigen,
      zona_destino: zonaDestino,
      descripcion: document.getElementById('input-descripcion').value,
      foto_paquete_url: urlData.publicUrl,
      precio: precio,
      comision_plataforma: comision,
      ganancia_repartidor: ganancia,
      estado: 'pendiente'
    }).select().single()

    if (error) throw error

    currentPedidoId = pedido.id
    showScreen('tracking')
    setupTracking(pedido)

  } catch (e) {
    alert('Error al crear pedido: ' + e.message)
    btn.textContent = 'Confirmar envío'
    btn.disabled = false
  }
})

// ── TRACKING ──────────────────────────────────────────────────────────────────
const ESTADOS_ORDER = ['pendiente', 'buscando_repartidor', 'aceptado', 'recogido', 'en_camino', 'entregado']
const ESTADO_STEP = {
  pendiente: 'ts-pendiente',
  buscando_repartidor: 'ts-pendiente',
  aceptado: 'ts-aceptado',
  recogido: 'ts-recogido',
  en_camino: 'ts-recogido',
  entregado: 'ts-entregado'
}

function setupTracking(pedido) {
  document.getElementById('tracking-id').textContent = 'NX-' + pedido.id.substring(0, 6).toUpperCase()
  updateTrackingUI(pedido.estado)

  if (realtimeChannel) realtimeChannel.unsubscribe()
  realtimeChannel = db.channel('pedido-' + pedido.id)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'pedidos',
      filter: `id=eq.${pedido.id}`
    }, (payload) => {
      updateTrackingUI(payload.new.estado)
      if (payload.new.estado === 'entregado') {
        document.getElementById('rating-section').style.display = 'block'
      }
    })
    .subscribe()
}

function updateTrackingUI(estado) {
  const steps = ['ts-pendiente', 'ts-aceptado', 'ts-recogido', 'ts-entregado']
  const activeStep = ESTADO_STEP[estado]
  let reached = false
  steps.forEach(s => {
    const el = document.getElementById(s)
    if (s === activeStep) reached = true
    if (!reached || s === activeStep) el.classList.add('done')
  })
}

async function verTracking(pedidoId) {
  const { data: pedido } = await db.from('pedidos').select('*').eq('id', pedidoId).single()
  if (!pedido) return
  currentPedidoId = pedidoId
  showScreen('tracking')
  setupTracking(pedido)
}

document.getElementById('btn-back-tracking').addEventListener('click', () => {
  if (realtimeChannel) realtimeChannel.unsubscribe()
  showScreen('home')
  loadPedidos()
})

// ── RATING ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.stars span').forEach(star => {
  star.addEventListener('click', async () => {
    const val = parseInt(star.dataset.val)
    document.querySelectorAll('.stars span').forEach((s, i) => {
      s.classList.toggle('active', i < val)
    })
    const { data: pedido } = await db.from('pedidos').select('*').eq('id', currentPedidoId).single()
    const { data: usuario } = await db.from('usuarios').select('id').eq('email', currentUser.email).single()
    await db.from('ratings').upsert({
      pedido_id: currentPedidoId,
      cliente_id: usuario.id,
      repartidor_id: pedido.repartidor_id,
      puntuacion: val
    })
  })
})

// ── BOTTOM NAV ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const screen = btn.dataset.screen
    if (screen === 'nuevo') {
      showScreen('nuevo')
      showStep(1)
    } else {
      showScreen('home')
      loadPedidos()
    }
  })
})
