import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import type { Prisma } from '@prisma/client'

// MÓDULO OBSERVABILITY — últimas ejecuciones registradas (§25).
// GET /api/executions?operation=GENERATE_PROPOSAL&limit=20

export async function GET(req: Request) {
  const url = new URL(req.url)
  const operation = url.searchParams.get('operation') || undefined
  const limitRaw = Number(url.searchParams.get('limit') || 50)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200)

  const where: Prisma.ExecutionWhereInput = operation ? { operation } : {}
  const [total, executions] = await Promise.all([
    db.execution.count({ where }),
    db.execution.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
  ])

  return ok({
    total,
    limit,
    executions: executions.map((e) => ({
      id: e.id,
      agentId: e.agentId,
      operation: e.operation,
      correlationId: e.correlationId,
      skillIdentity: e.skillIdentity,
      autonomyLevel: e.autonomyLevel,
      status: e.status,
      latencyMs: e.latencyMs,
      providers: e.providersJson ? safeParse(e.providersJson) : undefined,
      tools: e.toolsJson ? safeParse(e.toolsJson) : undefined,
      inputs: e.inputsJson ? safeParse(e.inputsJson) : undefined,
      outputs: e.outputsJson ? safeParse(e.outputsJson) : undefined,
      errors: e.errorsJson ? safeParse(e.errorsJson) : undefined,
      createdAt: e.createdAt,
    })),
  })
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
