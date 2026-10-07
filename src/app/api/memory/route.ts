// ─── /api/memory — MemoryDV RADAR-SECOP2 (PROMPT 05 §13-14) ─────────────────
// GET  ?q=&type=&limit= → recall con scoring (o listado si no hay q)
// GET  sin params       → seed idempotente + stats + últimos 20
// POST                  → remember (regla dura: FACTUAL exige evidenceIds)
// PUT  ?action=consolidate|decay|both → mantenimiento de la memoria

import { ok, bad, safe } from "@/lib/api"
import {
  AGENT_ID,
  DOMAIN,
  MemoryValidationError,
  remember,
  recall,
  list,
  consolidate,
  decay,
  stats,
  seedIfEmpty,
  type RememberInput,
} from "@/lib/memory"

export async function GET(req: Request) {
  return safe(async () => {
    const url = new URL(req.url)
    const q = url.searchParams.get("q")?.trim()
    const type = url.searchParams.get("type") ?? undefined
    const limitParam = url.searchParams.get("limit")
    const limit = limitParam ? Number(limitParam) : undefined

    if (limitParam !== null && (Number.isNaN(limit) || (limit as number) < 1)) {
      return bad("limit debe ser un entero ≥ 1.", 400)
    }

    // q presente → recall con scoring y refresco por uso
    if (q) {
      const entries = await recall(q, { type, limit: limit ?? 10 })
      return ok({ agentId: AGENT_ID, domain: DOMAIN, query: q, count: entries.length, entries })
    }

    // Sin q pero con type/limit → listado plano
    if (type || limit !== undefined) {
      const entries = await list({ type, limit })
      return ok({ agentId: AGENT_ID, domain: DOMAIN, count: entries.length, entries })
    }

    // GET sin params → seed idempotente (solo si la tabla está vacía) + stats + últimos 20
    const seed = await seedIfEmpty()
    const [memoryStats, recent] = await Promise.all([stats(), list({ limit: 20 })])
    return ok({ agentId: AGENT_ID, domain: DOMAIN, seed, stats: memoryStats, recent })
  })
}

export async function POST(req: Request) {
  return safe(async () => {
    let body: Partial<RememberInput>
    try {
      body = await req.json()
    } catch {
      return bad("Body JSON inválido.", 400)
    }

    try {
      const entry = await remember(body as RememberInput)
      return ok(
        {
          agentId: AGENT_ID,
          domain: DOMAIN,
          created: entry,
          note: entry.type === "FACTUAL"
            ? "Memoria FACTUAL registrada con evidencia obligatoria."
            : undefined,
        },
        201,
      )
    } catch (err) {
      if (err instanceof MemoryValidationError) return bad(err.message, 400)
      throw err
    }
  })
}

export async function PUT(req: Request) {
  return safe(async () => {
    const action = new URL(req.url).searchParams.get("action")?.trim().toLowerCase()

    if (action === "consolidate") {
      const result = await consolidate()
      return ok({ agentId: AGENT_ID, domain: DOMAIN, action, result })
    }
    if (action === "decay") {
      const result = await decay()
      return ok({ agentId: AGENT_ID, domain: DOMAIN, action, result })
    }
    if (action === "both") {
      const [consolidateResult, decayResult] = await Promise.all([consolidate(), decay()])
      return ok({ agentId: AGENT_ID, domain: DOMAIN, action, consolidate: consolidateResult, decay: decayResult })
    }
    return bad("action inválido. Usa ?action=consolidate | decay | both.", 400)
  })
}
