#!/usr/bin/env bun
// Daemon de polling de Telegram para el Agente SECOP Radar.
// Llama al endpoint interno /api/channels/telegram/poll en bucle (long-polling).
// Si el canal no está configurado, reintenta con cadencia suave.

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const LONG = Number(process.env.POLL_TIMEOUT || 25) // segundos de long-poll

function ts() {
  return new Date().toLocaleTimeString('es-CO', { hour12: false })
}

async function cycle() {
  try {
    const res = await fetch(`${BASE}/api/channels/telegram/poll?timeout=${LONG}`, { method: 'POST' })
    const data = await res.json()
    if (!data.ok) {
      console.log(`[${ts()}] poll con error: ${data.error}`)
      await sleep(15)
    } else if (!data.configured) {
      console.log(`[${ts()}] Telegram sin configurar — esperando token...`)
      await sleep(15)
    } else if (data.processed > 0) {
      console.log(`[${ts()}] procesados ${data.processed} mensaje(s)`)
    }
    // sin mensajes: el long-poll ya consumió LONG segundos; continuar de inmediato
  } catch (err) {
    console.log(`[${ts()}] no se pudo contactar el server: ${err.message}`)
    await sleep(15)
  }
}

function sleep(s) {
  return new Promise((r) => setTimeout(r, s * 1000))
}

console.log(`[${ts()}] poller de Telegram iniciado (base=${BASE}, long-poll=${LONG}s)`)
for (;;) {
  await cycle()
}
