// MÓDULO OBSERVABILITY (PROMPT 05 §25) — RADAR-SECOP2
// Cada ejecución importante es reconstruible: inputs, outputs, herramientas,
// proveedores, errores, latencia y estado (Execution) + métricas por proveedor
// externo (ProviderMetric).
//
// Uso:
//   const { result, executionId } = await withExecution('GENERATE_PROPOSAL',
//     { correlationId, skillIdentity: 'GENERATE_TENDER', autonomyLevel: 'L2_EXECUTE_SAFE',
//       inputs: { opportunityId }, tools: ['generateProposal'] }, async () => { ... })
//   // si fn lanza: se registra FAILED con errorsJson y SE RELANZA el error

import { db } from '@/lib/db'

const MAX_JSON = 8000 // límite de seguridad por campo JSON almacenado

export type ExecutionStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'

export interface ExecutionMeta {
  correlationId?: string
  skillIdentity?: string
  autonomyLevel?: string
  inputs?: unknown
  tools?: string[]
}

export interface WithExecutionResult<T> {
  result: T
  executionId: string
  status: ExecutionStatus
  latencyMs: number
}

function truncateJson(value: unknown, max = MAX_JSON): string | null {
  if (value === undefined) return null
  try {
    const raw = JSON.stringify(value)
    if (raw === undefined) return null
    return raw.length > max ? raw.slice(0, max) + '…[truncado]' : raw
  } catch {
    // Resultado no serializable (p. ej. una Response): guardamos una huella mínima.
    try {
      const hint =
        typeof value === 'object' && value !== null
          ? `[${(value as { constructor?: { name?: string } }).constructor?.name ?? 'object'} no serializable]`
          : String(value)
      return hint.slice(0, 200)
    } catch {
      return '[no serializable]'
    }
  }
}

function normalizeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack?.slice(0, 1000) }
  return { name: 'UnknownError', message: String(err) }
}

/**
 * Envuelve una operación del agente con una fila Execution (RUNNING → SUCCESS/PARTIAL/FAILED).
 * - Registra latencyMs real y outputsJson (truncado, tolerante a no-serializables).
 * - Si fn lanza: guarda errorsJson y RE-LANZA el error original.
 * - PARTIAL: si el resultado es un objeto con executionPartial === true (convención ligera).
 * - fn recibe { executionId } para asociar trazas (Approval.executionId, AuditEvent…).
 */
export async function withExecution<T>(
  operation: string,
  meta: ExecutionMeta,
  fn: (ctx: { executionId: string }) => Promise<T>,
): Promise<WithExecutionResult<T>> {
  const execution = await db.execution.create({
    data: {
      operation,
      correlationId: meta.correlationId ?? null,
      skillIdentity: meta.skillIdentity ?? null,
      autonomyLevel: meta.autonomyLevel ?? 'L2_EXECUTE_SAFE',
      inputsJson: truncateJson(meta.inputs),
      toolsJson: meta.tools?.length ? JSON.stringify(meta.tools) : null,
      status: 'RUNNING',
    },
  })

  const startedAt = Date.now()
  try {
    const result = await fn({ executionId: execution.id })
    const latencyMs = Date.now() - startedAt
    const partial =
      typeof result === 'object' && result !== null && (result as Record<string, unknown>).executionPartial === true
    const status: ExecutionStatus = partial ? 'PARTIAL' : 'SUCCESS'
    await db.execution.update({
      where: { id: execution.id },
      data: { status, latencyMs, outputsJson: truncateJson(result) },
    })
    return { result, executionId: execution.id, status, latencyMs }
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    const errorsJson = JSON.stringify([normalizeError(err)])
    await db.execution
      .update({ where: { id: execution.id }, data: { status: 'FAILED', latencyMs, errorsJson } })
      .catch(() => undefined)
    throw err // re-lanzar tras registrar
  }
}

/**
 * Métrica por proveedor externo (SECOP_SOCRATA | LLM_ZAI | ASR_ZAI | VISION_ZAI | TELEGRAM | WHATSAPP …).
 * Best-effort: un fallo de telemetría nunca rompe el flujo de negocio.
 */
export async function recordProviderMetric(
  provider: string,
  operation: string | undefined,
  latencyMs: number | undefined,
  ok: boolean,
  httpStatus?: number,
  meta?: unknown,
): Promise<void> {
  try {
    await db.providerMetric.create({
      data: {
        provider,
        operation: operation ?? null,
        latencyMs: typeof latencyMs === 'number' && Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
        ok,
        httpStatus: typeof httpStatus === 'number' ? httpStatus : null,
        metaJson: meta === undefined ? null : truncateJson(meta, 2000),
      },
    })
  } catch (err) {
    console.warn('[observe] recordProviderMetric falló (best-effort):', err instanceof Error ? err.message : err)
  }
}

/** Helper para marcar un resultado como parcial (ver convención en withExecution). */
export function asPartial<T extends object>(result: T): T {
  return { ...result, executionPartial: true }
}
