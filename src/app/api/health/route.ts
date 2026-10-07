import { db } from '@/lib/db'

// MÓDULO HEALTH — liveness/readiness ligero para monitoreo y uptime checks.
// GET /api/health → { ok, agent, uptime, db, secop (cacheado 60s), version }

let secopCache: { ok: boolean; at: number } | null = null
const SECOP_CACHE_TTL_MS = 60_000

async function secopReachable(): Promise<boolean> {
  if (secopCache && Date.now() - secopCache.at < SECOP_CACHE_TTL_MS) return secopCache.ok
  let ok = false
  try {
    const res = await fetch('https://www.datos.gov.co/resource/p6dx-8zbt.json?$limit=1', {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    ok = res.ok
  } catch {
    ok = false
  }
  secopCache = { ok, at: Date.now() }
  return ok
}

export async function GET() {
  let dbOk = true
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbOk = false
  }
  const secop = await secopReachable()
  const healthy = dbOk // secop caído = degradado, no muerto: /api/doctor detalla el motivo
  return Response.json(
    {
      ok: healthy,
      agent: 'RADAR-SECOP2',
      uptime: Math.round(process.uptime()),
      db: dbOk,
      secop,
      version: '0.2.1',
    },
    { status: healthy ? 200 : 503 },
  )
}
