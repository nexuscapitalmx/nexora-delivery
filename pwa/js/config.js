const SUPABASE_URL = 'https://irucxcwprntynwsaijyq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlydWN4Y3dwcm50eW53c2FpanlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MjIwNTUsImV4cCI6MjA5NTM5ODA1NX0.tppdLoDWMB7jxgVTrbvj5rKjU8UGYjyj6CVy7ACU5Gs'
const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFjZzExOTYiLCJhIjoiY21veXNvczFiMThrbzJxcWM4MmRvOWQzbiJ9.t4DM7dJPoEgYvViNsfENig'

// Tarifa por km
const TARIFA_BASE = 25        // MXN fijos de arranque
const TARIFA_POR_KM = 8       // MXN por km
const TARIFA_EXPRESS_MULT = 1.25  // 25% extra express
const KM_MAXIMO = 40          // límite de cobertura

async function geocodificar(texto) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(texto)}.json?access_token=${MAPBOX_TOKEN}&country=MX&proximity=-99.1332,19.4326&language=es&limit=5`
  const r = await fetch(url)
  const d = await r.json()
  return d.features || []
}

async function calcularRuta(origenCoords, destinoCoords) {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origenCoords[0]},${origenCoords[1]};${destinoCoords[0]},${destinoCoords[1]}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full`
  const r = await fetch(url)
  const d = await r.json()
  if (!d.routes?.length) return null
  const ruta = d.routes[0]
  const km = ruta.distance / 1000
  const minutos = Math.round(ruta.duration / 60)
  const precioBase = Math.round(TARIFA_BASE + (km * TARIFA_POR_KM))
  const precioExpress = Math.round(precioBase * TARIFA_EXPRESS_MULT)
  return { km: km.toFixed(1), minutos, precioBase, precioExpress, geometry: ruta.geometry }
}
