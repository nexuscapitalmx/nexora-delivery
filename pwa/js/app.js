const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
mapboxgl.accessToken = MAPBOX_TOKEN

let currentUser = null
let currentPedidoId = null
let selectedTipo = 'estandar'
let origenCoords = null
let destinoCoords = null
let origenTexto = ''
let destinoTexto = ''
let rutaData = null
let fotoFile = null
let realtimeChannel = null
let mapaCotizador = null
let mapaTracking = null

// ── PANTALLAS ─────────────────────────────────────────────────────────────────
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
    document.getElementById('header-user-name').textContent = session.user.email.split('@')[0]
    showScreen('home')
    loadPedidos()
  } else {
    showScreen('login')
  }
})

async function ensureUsuario(user) {
  const { data } = await db.from('usuarios').select('id').eq('email', user.email).single()
  if (!data) await db.from('usuarios').insert({ email: user.email, nombre: user.email.split('@')[0] })
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('input-email').value.trim()
  if (!email) return
  const btn = document.getElementById('btn-login')
  btn.textContent = 'Enviando...'
  btn.disabled = true
  const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
  if (error) { btn.textContent = 'Continuar'; btn.disabled = false; alert(error.message) }
  else btn.textContent = 'Revisa tu correo ✓'
})

// ── HOME ──────────────────────────────────────────────────────────────────────
async function loadPedidos() {
  if (!currentUser) return
  const { data: usuario } = await db.from('usuarios').select('id').eq('email', currentUser.email).single()
  if (!usuario) return
  const { data: pedidos } = await db.from('pedidos').select('*').eq('cliente_id', usuario.id).order('created_at', { ascending: false }).limit(10)
  const activos = pedidos?.filter(p => !['entregado','cancelado_cliente','cancelado_sistema'].includes(p.estado)) || []
  document.getElementById('stat-total').textContent = pedidos?.length || 0
  document.getElementById('stat-activos').textContent = activos.length
  const lista = document.getElementById('lista-pedidos')
  if (!pedidos?.length) { lista.innerHTML = '<div class="empty-state">Aún no tienes envíos</div>'; return }
  lista.innerHTML = pedidos.map(p => `
    <div class="pedido-item" onclick="verTracking('${p.id}')">
      <div>
        <div class="pedido-dest">${p.destino_texto.substring(0,40)}...</div>
        <div class="pedido-meta">${new Date(p.created_at).toLocaleDateString('es-MX')} · $${p.precio} MXN</div>
      </div>
      <span class="pedido-estado estado-${p.estado.startsWith('cancelado') ? 'cancelado' : p.estado === 'entregado' ? 'entregado' : 'pendiente'}">${estadoLabel(p.estado)}</span>
    </div>`).join('')
}

function estadoLabel(e) {
  return { pendiente:'Pendiente', buscando_repartidor:'Buscando', aceptado:'Asignado', recogido:'Recogido', en_camino:'En camino', entregado:'Entregado', cancelado_cliente:'Cancelado', cancelado_sistema:'Cancelado' }[e] || e
}

document.getElementById('btn-nuevo-pedido').addEventListener('click', () => { showScreen('nuevo'); showStep(1); resetForm() })
document.getElementById('btn-back-nuevo').addEventListener('click', () => showScreen('home'))

// ── AUTOCOMPLETE MAPBOX ───────────────────────────────────────────────────────
function setupAutocomplete(inputId, listId, onSelect) {
  const input = document.getElementById(inputId)
  const list = document.getElementById(listId)
  let timer = null

  input.addEventListener('input', () => {
    clearTimeout(timer)
    const val = input.value.trim()
    if (val.length < 3) { list.innerHTML = ''; return }
    timer = setTimeout(async () => {
      const results = await geocodificar(val)
      list.innerHTML = results.map(f => `
        <div class="ac-item" data-coords="${f.center}" data-name="${f.place_name}">
          <strong>${f.text}</strong><br>${f.place_name}
        </div>`).join('')
      list.querySelectorAll('.ac-item').forEach(item => {
        item.addEventListener('click', () => {
          const coords = item.dataset.coords.split(',').map(Number)
          const name = item.dataset.name
          input.value = name
          list.innerHTML = ''
          onSelect(coords, name)
        })
      })
    }, 400)
  })
}

setupAutocomplete('input-origen', 'ac-origen', (coords, name) => {
  origenCoords = coords
  origenTexto = name
  intentarCotizar()
})

setupAutocomplete('input-destino', 'ac-destino', (coords, name) => {
  destinoCoords = coords
  destinoTexto = name
  intentarCotizar()
})

async function intentarCotizar() {
  if (!origenCoords || !destinoCoords) return
  document.getElementById('precio-std').textContent = 'Calculando...'
  document.getElementById('cotizador-box').style.display = 'block'

  rutaData = await calcularRuta(origenCoords, destinoCoords)
  if (!rutaData) { alert('No se pudo calcular la ruta'); return }

  document.getElementById('cot-km').textContent = `${rutaData.km} km`
  document.getElementById('cot-tiempo').textContent = `~${rutaData.minutos} min`
  document.getElementById('precio-std').textContent = `$${rutaData.precioBase} MXN`
  document.getElementById('precio-exp').textContent = `$${rutaData.precioExpress} MXN`
  document.getElementById('btn-step1').disabled = false

  // Mapa con ruta
  const mapaDiv = document.getElementById('mapa-cotizador')
  mapaDiv.style.display = 'block'
  if (mapaCotizador) mapaCotizador.remove()
  mapaCotizador = new mapboxgl.Map({
    container: 'mapa-cotizador',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: origenCoords,
    zoom: 11
  })
  mapaCotizador.on('load', () => {
    new mapboxgl.Marker({ color: '#D4AF37' }).setLngLat(origenCoords).addTo(mapaCotizador)
    new mapboxgl.Marker({ color: '#E53935' }).setLngLat(destinoCoords).addTo(mapaCotizador)
    mapaCotizador.addSource('ruta', { type: 'geojson', data: { type: 'Feature', geometry: rutaData.geometry } })
    mapaCotizador.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#D4AF37', 'line-width': 3, 'line-opacity': 0.8 } })
    const bounds = new mapboxgl.LngLatBounds()
    bounds.extend(origenCoords)
    bounds.extend(destinoCoords)
    mapaCotizador.fitBounds(bounds, { padding: 40 })
  })
}

document.querySelectorAll('.tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTipo = btn.dataset.tipo
  })
})

document.getElementById('btn-step1').addEventListener('click', () => {
  if (!origenCoords || !destinoCoords || !rutaData) return
  showStep(2)
})

// ── FOTO ──────────────────────────────────────────────────────────────────────
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
  if (!document.getElementById('check-declaracion').checked) { alert('Debes aceptar la declaración'); return }
  const precio = selectedTipo === 'express' ? rutaData.precioExpress : rutaData.precioBase
  document.getElementById('res-origen').textContent = origenTexto.substring(0, 50)
  document.getElementById('res-destino').textContent = destinoTexto.substring(0, 50)
  document.getElementById('res-km').textContent = `${rutaData.km} km`
  document.getElementById('res-tiempo').textContent = `~${rutaData.minutos} min`
  document.getElementById('res-tipo').textContent = selectedTipo === 'express' ? '⚡ Express' : 'Estándar'
  document.getElementById('res-precio').textContent = `$${precio} MXN`
  showStep(3)
})

document.getElementById('btn-back-step2').addEventListener('click', () => showStep(1))
document.getElementById('btn-back-step3').addEventListener('click', () => showStep(2))

// ── CONFIRMAR PEDIDO ──────────────────────────────────────────────────────────
document.getElementById('btn-confirmar').addEventListener('click', async () => {
  const btn = document.getElementById('btn-confirmar')
  btn.textContent = 'Creando pedido...'
  btn.disabled = true
  try {
    const { data: usuario } = await db.from('usuarios').select('id').eq('email', currentUser.email).single()
    const precio = selectedTipo === 'express' ? rutaData.precioExpress : rutaData.precioBase
    const comision = parseFloat((precio * 0.28).toFixed(2))
    const ganancia = parseFloat((precio * 0.72).toFixed(2))

    const ext = fotoFile.name.split('.').pop()
    const fotoPath = `pedidos/${Date.now()}.${ext}`
    await db.storage.from('fotos-paquetes').upload(fotoPath, fotoFile)
    const { data: urlData } = db.storage.from('fotos-paquetes').getPublicUrl(fotoPath)

    const { data: pedido, error } = await db.from('pedidos').insert({
      cliente_id: usuario.id,
      origen_texto: origenTexto,
      destino_texto: destinoTexto,
      origen_lng: origenCoords[0],
      origen_lat: origenCoords[1],
      destino_lng: destinoCoords[0],
      destino_lat: destinoCoords[1],
      descripcion: document.getElementById('input-descripcion').value,
      foto_paquete_url: urlData.publicUrl,
      precio, comision_plataforma: comision, ganancia_repartidor: ganancia,
      estado: 'pendiente'
    }).select().single()

    if (error) throw error
    currentPedidoId = pedido.id
    showScreen('tracking')
    setupTracking(pedido)
  } catch (e) {
    alert('Error: ' + e.message)
    btn.textContent = 'Confirmar envío'
    btn.disabled = false
  }
})

// ── TRACKING ──────────────────────────────────────────────────────────────────
const ESTADO_STEP = { pendiente:'ts-pendiente', buscando_repartidor:'ts-pendiente', aceptado:'ts-aceptado', recogido:'ts-recogido', en_camino:'ts-recogido', entregado:'ts-entregado' }

function setupTracking(pedido) {
  document.getElementById('tracking-id').textContent = 'NX-' + pedido.id.substring(0,6).toUpperCase()
  updateTrackingUI(pedido.estado)

  // Mapa tracking
  if (mapaTracking) mapaTracking.remove()
  if (pedido.origen_lng && pedido.destino_lng) {
    mapaTracking = new mapboxgl.Map({
      container: 'mapa-tracking',
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [pedido.origen_lng, pedido.origen_lat],
      zoom: 12
    })
    mapaTracking.on('load', async () => {
      new mapboxgl.Marker({ color: '#D4AF37' }).setLngLat([pedido.origen_lng, pedido.origen_lat]).addTo(mapaTracking)
      new mapboxgl.Marker({ color: '#E53935' }).setLngLat([pedido.destino_lng, pedido.destino_lat]).addTo(mapaTracking)
      const ruta = await calcularRuta([pedido.origen_lng, pedido.origen_lat], [pedido.destino_lng, pedido.destino_lat])
      if (ruta) {
        mapaTracking.addSource('ruta', { type: 'geojson', data: { type: 'Feature', geometry: ruta.geometry } })
        mapaTracking.addLayer({ id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-join':'round','line-cap':'round' }, paint: { 'line-color':'#D4AF37','line-width':3,'line-opacity':0.7 } })
        const bounds = new mapboxgl.LngLatBounds()
        bounds.extend([pedido.origen_lng, pedido.origen_lat])
        bounds.extend([pedido.destino_lng, pedido.destino_lat])
        mapaTracking.fitBounds(bounds, { padding: 40 })
      }
    })
  }

  if (realtimeChannel) realtimeChannel.unsubscribe()
  realtimeChannel = db.channel('pedido-' + pedido.id)
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'pedidos', filter:`id=eq.${pedido.id}` }, (payload) => {
      updateTrackingUI(payload.new.estado)
      if (payload.new.estado === 'entregado') document.getElementById('rating-section').style.display = 'block'
    }).subscribe()
}

function updateTrackingUI(estado) {
  const steps = ['ts-pendiente','ts-aceptado','ts-recogido','ts-entregado']
  const activeStep = ESTADO_STEP[estado]
  let reached = false
  steps.forEach(s => {
    const el = document.getElementById(s)
    el.classList.remove('done')
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
    document.querySelectorAll('.stars span').forEach((s, i) => s.classList.toggle('active', i < val))
    const { data: pedido } = await db.from('pedidos').select('*').eq('id', currentPedidoId).single()
    const { data: usuario } = await db.from('usuarios').select('id').eq('email', currentUser.email).single()
    await db.from('ratings').upsert({ pedido_id: currentPedidoId, cliente_id: usuario.id, repartidor_id: pedido.repartidor_id, puntuacion: val })
  })
})

// ── NAV ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    if (btn.dataset.screen === 'nuevo') { showScreen('nuevo'); showStep(1); resetForm() }
    else { showScreen('home'); loadPedidos() }
  })
})

function resetForm() {
  origenCoords = null; destinoCoords = null; origenTexto = ''; destinoTexto = ''; rutaData = null; fotoFile = null
  document.getElementById('input-origen').value = ''
  document.getElementById('input-destino').value = ''
  document.getElementById('input-descripcion').value = ''
  document.getElementById('input-foto').value = ''
  document.getElementById('foto-preview').style.display = 'none'
  document.getElementById('foto-placeholder').style.display = 'flex'
  document.getElementById('check-declaracion').checked = false
  document.getElementById('cotizador-box').style.display = 'none'
  document.getElementById('mapa-cotizador').style.display = 'none'
  document.getElementById('btn-step1').disabled = true
  document.getElementById('ac-origen').innerHTML = ''
  document.getElementById('ac-destino').innerHTML = ''
  selectedTipo = 'estandar'
  document.querySelectorAll('.tipo-btn').forEach((b,i) => b.classList.toggle('active', i===0))
}
