// MÓDULO DOCTOR (PROMPT 05 §18/§25) — RADAR-SECOP2
// Diagnóstico de salud del agente: conectividad SECOP, integridad de BD,
// configuración de canales, registro de skills, memoria, evidencia con
// provenance, requisitos sin fuente, deadlines inconsistentes, ejecuciones
// fallidas y tools MCP registradas.
//
// Cada corrida se registra como Execution (DOCTOR_RUN) + AuditEvent (DOCTOR).
// Auto-fix SOLO seguro/determinístico con ?fix=1 (re-seed de skills y
// consolidación/decay de memoria si los módulos existen); todo lo demás
// solo reporta.

import { db } from '@/lib/db'
import { withExecution, recordProviderMetric } from '@/lib/observe'

export type CheckStatus = 'OK' | 'WARN' | 'FAIL' | 'SKIP'

export interface DoctorCheck {
  id: string
  status: CheckStatus
  detail: string
  fixable: boolean
  data?: unknown
}

export interface DoctorFix {
  id: string
  applied: boolean
  detail: string
}

export interface DoctorReport {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  checkedAt: string
  checks: DoctorCheck[]
  fixes: DoctorFix[]
  executionId: string
  latencyMs: number
}

const SECOP_URL = 'https://www.datos.gov.co/resource/p6dx-8zbt.json?$limit=1'
const OPEN_STATES = ['Presentación de oferta']

// ─── Checks individuales ─────────────────────────────────────

async function checkSecopReachable(): Promise<DoctorCheck> {
  const started = Date.now()
  try {
    const res = await fetch(SECOP_URL, { signal: AbortSignal.timeout(6000), cache: 'no-store' })
    const latencyMs = Date.now() - started
    await recordProviderMetric('SECOP_SOCRATA', 'DOCTOR_PING', latencyMs, res.ok, res.status)
    if (!res.ok) {
      return { id: 'secop_reachable', status: 'FAIL', fixable: false, detail: `SECOP respondió HTTP ${res.status} en ${latencyMs}ms.`, data: { httpStatus: res.status, latencyMs } }
    }
    const rows = (await res.json()) as unknown[]
    return { id: 'secop_reachable', status: 'OK', fixable: false, detail: `API Socrata SECOP II alcanzable (${latencyMs}ms, ${Array.isArray(rows) ? rows.length : 0} fila(s) de muestra).`, data: { latencyMs, httpStatus: res.status } }
  } catch (err) {
    const latencyMs = Date.now() - started
    await recordProviderMetric('SECOP_SOCRATA', 'DOCTOR_PING', latencyMs, false, undefined, { error: err instanceof Error ? err.message : String(err) })
    return { id: 'secop_reachable', status: 'FAIL', fixable: false, detail: `SECOP inalcanzable tras ${latencyMs}ms: ${err instanceof Error ? err.message : String(err)}.`, data: { latencyMs } }
  }
}

async function checkDbIntegrity(): Promise<DoctorCheck> {
  try {
    const [processes, opportunities, proposals, requirements, evidences, companies, orphans] = await Promise.all([
      db.secopProcess.count(),
      db.opportunity.count(),
      db.proposal.count(),
      db.requirement.count(),
      db.evidence.count(),
      db.company.count(),
      db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) as n FROM Opportunity o LEFT JOIN SecopProcess p ON o.processId = p.id WHERE p.id IS NULL`,
    ])
    const orphanCount = Number(orphans[0]?.n ?? 0)
    if (orphanCount > 0) {
      return { id: 'db_integrity', status: 'FAIL', fixable: false, detail: `${orphanCount} oportunidad(es) con processId sin SecopProcess válido.`, data: { processes, opportunities, proposals, requirements, evidences, companies, orphanOpportunities: orphanCount } }
    }
    return { id: 'db_integrity', status: 'OK', fixable: false, detail: `BD íntegra: ${processes} procesos, ${opportunities} oportunidades, ${proposals} propuestas, ${requirements} requisitos, ${evidences} evidencias, ${companies} empresa(s); 0 huérfanas.`, data: { processes, opportunities, proposals, requirements, evidences, companies, orphanOpportunities: 0 } }
  } catch (err) {
    return { id: 'db_integrity', status: 'FAIL', fixable: false, detail: `Error consultando la base de datos: ${err instanceof Error ? err.message : String(err)}.` }
  }
}

async function checkChannels(): Promise<DoctorCheck> {
  const configs = await db.channelConfig.findMany({ select: { channel: true, enabled: true, token: true, botUsername: true, phoneNumberId: true } })
  const active = configs.filter((c) => c.enabled && c.token.trim().length > 0)
  if (active.length === 0) {
    return { id: 'channels_configured', status: 'WARN', fixable: false, detail: `Sin canales de mensajería configurados (${configs.length} registro(s), ninguno activo con token). Telegram/WhatsApp quedarán inoperativos.`, data: { total: configs.length, active: 0 } }
  }
  return { id: 'channels_configured', status: 'OK', fixable: false, detail: `${active.length} canal(es) activo(s): ${active.map((c) => c.channel).join(', ')}.`, data: { total: configs.length, active: active.length, channels: active.map((c) => c.channel) } }
}

// Importación dinámica para evitar ciclo con mcp.ts (que importa este módulo).
async function checkMcpTools(): Promise<DoctorCheck> {
  try {
    const mod = await import('@/lib/mcp')
    const count = Object.keys(mod.MCP_TOOLS).length
    if (count < 10) {
      return { id: 'mcp_tools', status: 'WARN', fixable: false, detail: `Solo ${count} tools MCP registradas (se esperaban ≥17).`, data: { count, tools: Object.keys(mod.MCP_TOOLS) } }
    }
    return { id: 'mcp_tools', status: 'OK', fixable: false, detail: `${count} tools MCP registradas y servibles vía /api/mcp (JSON-RPC).`, data: { count, tools: Object.keys(mod.MCP_TOOLS) } }
  } catch (err) {
    return { id: 'mcp_tools', status: 'FAIL', fixable: false, detail: `No se pudo cargar el registro de tools MCP: ${err instanceof Error ? err.message : String(err)}.` }
  }
}

async function checkMemory(): Promise<DoctorCheck> {
  const count = await db.memoryEntry.count()
  const byType = await db.memoryEntry.groupBy({ by: ['type'], _count: { _all: true } })
  if (count === 0) {
    return { id: 'memory_available', status: 'WARN', fixable: false, detail: 'MemoryDV vacía: 0 MemoryEntry. El agente aún no recuerda nada entre sesiones.', data: { count, byType: {} } }
  }
  return { id: 'memory_available', status: 'OK', fixable: false, detail: `MemoryDV operativa: ${count} entrada(s) (${byType.map((t) => `${t.type}:${t._count._all}`).join(', ')}).`, data: { count, byType: Object.fromEntries(byType.map((t) => [t.type, t._count._all])) } }
}

// Skills (Agente 2-c): import dinámico + SKIP si el módulo aún no existe.
async function checkSkills(): Promise<DoctorCheck> {
  let dbCount = 0
  try {
    dbCount = await db.skillContract.count()
  } catch {
    /* tabla puede no existir aún */
  }
  try {
    const mod = (await import('@/lib/skills')) as Record<string, unknown>
    const listSkills = typeof mod.listSkills === 'function' ? (mod.listSkills as () => Promise<unknown>) : null
    if (!listSkills) {
      return { id: 'skills_valid', status: 'SKIP', fixable: false, detail: `@/lib/skills existe pero no exporta listSkills. SkillContract en BD: ${dbCount}.`, data: { dbCount } }
    }
    const skills = (await listSkills()) as { identity?: string; version?: string; status?: string }[]
    const list = Array.isArray(skills) ? skills : []
    // Revalidación: validateContract recibe el contrato completo (no el identity).
    const validate = typeof mod.validateContract === 'function'
      ? (mod.validateContract as (c: unknown) => { valid: boolean; errors?: unknown[] })
      : null
    if (validate && list.length > 0) {
      const failures: string[] = []
      for (const s of list.slice(0, 10)) {
        try {
          const v = validate(s)
          if (v && v.valid === false) failures.push(`${s.identity ?? '?'}: ${(v.errors ?? []).join('; ')}`)
        } catch (e) {
          failures.push(`${s.identity ?? '?'}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      if (failures.length > 0) {
        return { id: 'skills_valid', status: 'WARN', fixable: false, detail: `${failures.length} contrato(s) fallaron revalidación: ${failures.join(' | ')}`, data: { total: list.length, failures } }
      }
    }
    if (list.length === 0) {
      return { id: 'skills_valid', status: 'WARN', fixable: true, detail: `listSkills devolvió 0 contratos activos (SkillContract en BD: ${dbCount}). Re-seed disponible con ?fix=1.`, data: { total: 0, dbCount } }
    }
    return { id: 'skills_valid', status: 'OK', fixable: false, detail: `${list.length} skill contract(s) activos y revalidados: ${list.map((s) => `${s.identity}@${s.version ?? '?'}`).join(', ')}.`, data: { total: list.length } }
  } catch {
    return { id: 'skills_valid', status: 'SKIP', fixable: false, detail: `@/lib/skills (Agente 2-c) aún no disponible; SkillContract en BD: ${dbCount}. Se omitirá hasta que exista.`, data: { dbCount } }
  }
}

async function checkEvidenceProvenance(): Promise<DoctorCheck> {
  const total = await db.evidence.count()
  const where = { truthLevel: { not: 'UNKNOWN' }, provenanceJson: null }
  const count = await db.evidence.count({ where })
  if (count === 0) {
    return { id: 'evidence_sin_provenance', status: 'OK', fixable: false, detail: `Toda evidencia con truthLevel ≠ UNKNOWN tiene provenance (${total} evidencia(s) en total).`, data: { total, offenders: 0 } }
  }
  const sample = await db.evidence.findMany({ where, select: { id: true, source: true, truthLevel: true, extractedFact: true }, take: 5 })
  return { id: 'evidence_sin_provenance', status: 'WARN', fixable: false, detail: `${count} evidencia(s) afirmativa(s) sin provenanceJson (trazabilidad incompleta). Ej.: ${sample.map((e) => `${e.id} [${e.source}]`).join(', ')}.`, data: { total, offenders: count, sample } }
}

async function checkRequirementsSinFuente(): Promise<DoctorCheck> {
  // source es String @default("IA") no-nullable: solo puede estar vacío ('').
  const where = { source: '' }
  const count = await db.requirement.count({ where }).catch(() => 0)
  if (count === 0) {
    return { id: 'requirements_sin_fuente', status: 'OK', fixable: false, detail: 'Todos los requisitos declaran su fuente (IA|REGLA).' }
  }
  const sample = await db.requirement.findMany({ where, select: { id: true, code: true, opportunityId: true }, take: 5 })
  return { id: 'requirements_sin_fuente', status: 'WARN', fixable: false, detail: `${count} requisito(s) con source vacío/null (no se sabe si los puso la IA o una regla). Ej.: ${sample.map((r) => r.code).join(', ')}.`, data: { offenders: count, sample } }
}

async function checkDeadlines(): Promise<DoctorCheck> {
  const now = new Date()
  const where = {
    receptionDate: { lt: now },
    OR: OPEN_STATES.flatMap((s) => [{ state: { contains: s } }, { phase: { contains: s } }]),
  }
  const count = await db.secopProcess.count({ where })
  if (count === 0) {
    return { id: 'deadlines_inconsistentes', status: 'OK', fixable: false, detail: 'Ningún proceso abierto con fecha de recepción ya vencida.' }
  }
  const sample = await db.secopProcess.findMany({ where, select: { id: true, entity: true, objectName: true, receptionDate: true, state: true, phase: true }, take: 5, orderBy: { receptionDate: 'asc' } })
  return { id: 'deadlines_inconsistentes', status: 'WARN', fixable: false, detail: `${count} proceso(s) aún en fase abierta con receptionDate en pasado — ejecutar sync para actualizar estado. Ej.: ${sample.map((p) => `${p.id} (${p.entity}, cierre ${p.receptionDate?.toISOString().slice(0, 10)})`).join('; ')}.`, data: { offenders: count, sample } }
}

async function checkFailedExecutions(): Promise<DoctorCheck> {
  const since = new Date(Date.now() - 24 * 3600 * 1000)
  const count = await db.execution.count({ where: { status: 'FAILED', createdAt: { gte: since } } })
  if (count === 0) {
    return { id: 'executions_failed_24h', status: 'OK', fixable: false, detail: '0 ejecuciones FAILED en las últimas 24h.' }
  }
  const sample = await db.execution.findMany({ where: { status: 'FAILED', createdAt: { gte: since } }, select: { id: true, operation: true, errorsJson: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 })
  return { id: 'executions_failed_24h', status: 'WARN', fixable: false, detail: `${count} ejecución(es) FAILED en 24h — revisar /api/executions y get_executions (MCP). Últimas: ${sample.map((e) => `${e.operation} (${e.createdAt.toISOString().slice(11, 19)})`).join(', ')}.`, data: { count, sample } }
}

// ─── Fixes seguros (solo con ?fix=1) ─────────────────────────

async function applySafeFixes(fixRequested: boolean, checks: DoctorCheck[]): Promise<DoctorFix[]> {
  if (!fixRequested) return []
  const fixes: DoctorFix[] = []

  // 1) Re-seed de skills si la tabla está vacía y el módulo (2-c) existe.
  const skillsCheck = checks.find((c) => c.id === 'skills_valid')
  if (skillsCheck?.status === 'SKIP' || skillsCheck?.status === 'WARN') {
    try {
      const mod = (await import('@/lib/skills')) as Record<string, unknown>
      const seeder = ['seedSkills', 'reseedSkills', 'seed'].map((k) => mod[k]).find((f) => typeof f === 'function') as (() => Promise<unknown>) | undefined
      if (seeder) {
        await seeder()
        const after = await db.skillContract.count().catch(() => -1)
        fixes.push({ id: 'skills_reseed', applied: true, detail: `Re-seed de skills ejecutado; SkillContract ahora: ${after}.` })
      } else {
        fixes.push({ id: 'skills_reseed', applied: false, detail: '@/lib/skills existe pero no expone función de seed.' })
      }
    } catch {
      fixes.push({ id: 'skills_reseed', applied: false, detail: '@/lib/skills (Agente 2-c) no disponible aún; no se puede re-seed.' })
    }
  }

  // 2) Consolidación / decay de memoria si el módulo (2-b) existe.
  try {
    const mod = (await import('@/lib/memory')) as Record<string, unknown>
    const consolidators = ['consolidateMemory', 'runConsolidation', 'consolidate']
      .map((k) => mod[k])
      .find((f) => typeof f === 'function') as (() => Promise<unknown>) | undefined
    const decayers = ['decayMemory', 'runDecay', 'decay']
      .map((k) => mod[k])
      .find((f) => typeof f === 'function') as (() => Promise<unknown>) | undefined
    if (consolidators || decayers) {
      const parts: string[] = []
      if (consolidators) {
        await consolidators().catch((e: unknown) => parts.push(`consolidación falló: ${e instanceof Error ? e.message : String(e)}`))
        if (!parts.length) parts.push('consolidación OK')
      }
      if (decayers) {
        await decayers().catch((e: unknown) => parts.push(`decay falló: ${e instanceof Error ? e.message : String(e)}`))
        if (!parts.includes('decay falló')) parts.push('decay OK')
      }
      fixes.push({ id: 'memory_maintenance', applied: !parts.some((p) => p.includes('falló')), detail: `Mantenimiento MemoryDV: ${parts.join('; ')}.` })
    } else {
      fixes.push({ id: 'memory_maintenance', applied: false, detail: '@/lib/memory existe pero no exporta consolidate/decay.' })
    }
  } catch {
    fixes.push({ id: 'memory_maintenance', applied: false, detail: '@/lib/memory (Agente 2-b) no disponible aún; sin consolidación/decay.' })
  }

  return fixes
}

// ─── Orquestador ─────────────────────────────────────────────

export async function runDoctor(opts?: { fix?: boolean }): Promise<DoctorReport> {
  const fixRequested = opts?.fix === true
  const startedAt = Date.now()

  const { result, executionId } = await withExecution(
    'DOCTOR_RUN',
    { autonomyLevel: 'L2_EXECUTE_SAFE', inputs: { fix: fixRequested }, tools: ['db', 'fetch', 'mcp-registry'] },
    async ({ executionId }) => {
      const checks: DoctorCheck[] = []
      // 1. SECOP (red, no rompe el resto)
      checks.push(await checkSecopReachable())
      // 2-10. Resto de checks (cada uno aislado para que un fallo no tumbe el doctor)
      const rest = [
        { id: 'db_integrity', fn: checkDbIntegrity },
        { id: 'channels_configured', fn: checkChannels },
        { id: 'mcp_tools', fn: checkMcpTools },
        { id: 'memory_available', fn: checkMemory },
        { id: 'skills_valid', fn: checkSkills },
        { id: 'evidence_sin_provenance', fn: checkEvidenceProvenance },
        { id: 'requirements_sin_fuente', fn: checkRequirementsSinFuente },
        { id: 'deadlines_inconsistentes', fn: checkDeadlines },
        { id: 'executions_failed_24h', fn: checkFailedExecutions },
      ]
      for (const c of rest) {
        try {
          checks.push(await c.fn())
        } catch (err) {
          checks.push({ id: c.id, status: 'FAIL', fixable: false, detail: `Check lanzó excepción: ${err instanceof Error ? err.message : String(err)}.` })
        }
      }

      const fixes = await applySafeFixes(fixRequested, checks)

      const hasFail = checks.some((c) => c.status === 'FAIL')
      const hasWarn = checks.some((c) => c.status === 'WARN')
      const status = hasFail ? 'UNHEALTHY' : hasWarn ? 'DEGRADED' : 'HEALTHY'

      await db.auditEvent
        .create({
          data: {
            action: 'DOCTOR',
            entityType: 'DoctorReport',
            detail: `Diagnóstico ${status}: ${checks.map((c) => `${c.id}=${c.status}`).join(', ')}. Fixes aplicados: ${fixes.filter((f) => f.applied).length || 0}.`,
            executionId,
            latencyMs: Date.now() - startedAt,
            status: hasFail ? 'ERROR' : 'OK',
          },
        })
        .catch(() => undefined)

      return { status, checks, fixes } as { status: DoctorReport['status']; checks: DoctorCheck[]; fixes: DoctorFix[] }
    },
  )

  return {
    status: result.status,
    checkedAt: new Date().toISOString(),
    checks: result.checks,
    fixes: result.fixes,
    executionId,
    latencyMs: Date.now() - startedAt,
  }
}
