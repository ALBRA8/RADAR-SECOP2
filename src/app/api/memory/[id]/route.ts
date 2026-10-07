// ─── /api/memory/[id] — MemoryDV RADAR-SECOP2 ───────────────────────────────
// GET    → una memoria (siempre del RADAR; memoria ajena = 404, jamás se expone)
// DELETE → elimina la memoria (con aislamiento duro)

import { ok, bad, safe } from "@/lib/api"
import { AGENT_ID, DOMAIN, getById, remove } from "@/lib/memory"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const entry = await getById(id)
    if (!entry) {
      return bad(`Memoria ${id} no encontrada (o pertenece a otro agente — aislamiento PROMPT 05 §13).`, 404)
    }
    return ok({ agentId: AGENT_ID, domain: DOMAIN, entry })
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const deleted = await remove(id)
    if (!deleted) {
      return bad(`Memoria ${id} no encontrada (o pertenece a otro agente — aislamiento PROMPT 05 §13).`, 404)
    }
    return ok({ agentId: AGENT_ID, domain: DOMAIN, deleted: id })
  })
}
