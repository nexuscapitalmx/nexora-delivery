const SUPABASE_URL = 'https://irucxcwprntynwsaijyq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlydWN4Y3dwcm50eW53c2FpanlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MjIwNTUsImV4cCI6MjA5NTM5ODA1NX0.tppdLoDWMB7jxgVTrbvj5rKjU8UGYjyj6CVy7ACU5Gs'

const ZONAS_MAP = {
  'benito juarez': 'roma_condesa',
  'cuauhtemoc': 'centro',
  'cuauhtémoc': 'centro',
  'miguel hidalgo': 'centro',
  'venustiano carranza': 'centro',
  'gustavo a madero': 'norte',
  'gustavo a. madero': 'norte',
  'azcapotzalco': 'norte',
  'coyoacan': 'sur',
  'coyoacán': 'sur',
  'xochimilco': 'sur',
  'tlalpan': 'sur',
  'iztapalapa': 'oriente',
  'iztacalco': 'oriente',
  'tlahuac': 'oriente',
  'tláhuac': 'oriente',
  'alvaro obregon': 'poniente',
  'álvaro obregón': 'poniente',
  'cuajimalpa': 'poniente',
  'roma': 'roma_condesa',
  'condesa': 'roma_condesa',
  'polanco': 'centro',
  'tepito': 'centro',
  'doctores': 'centro',
  'narvarte': 'roma_condesa',
  'del valle': 'roma_condesa',
}

const TARIFAS_LOCAL = {
  'roma_condesa-roma_condesa': { base: 60, express: 80 },
  'roma_condesa-centro': { base: 80, express: 100 },
  'roma_condesa-norte': { base: 120, express: 150 },
  'roma_condesa-sur': { base: 130, express: 160 },
  'roma_condesa-oriente': { base: 140, express: 170 },
  'centro-centro': { base: 60, express: 80 },
  'centro-norte': { base: 90, express: 110 },
  'centro-sur': { base: 110, express: 140 },
  'centro-oriente': { base: 100, express: 130 },
  'norte-norte': { base: 60, express: 80 },
  'sur-sur': { base: 60, express: 80 },
  'oriente-oriente': { base: 60, express: 80 },
}

function detectarZona(texto) {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  for (const [key, zona] of Object.entries(ZONAS_MAP)) {
    const k = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (t.includes(k)) return zona
  }
  return null
}

function cotizar(zonaOrigen, zonaDestino) {
  const key = `${zonaOrigen}-${zonaDestino}`
  const keyInv = `${zonaDestino}-${zonaOrigen}`
  return TARIFAS_LOCAL[key] || TARIFAS_LOCAL[keyInv] || null
}
