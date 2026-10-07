// Skill Contracts (PROMPT 05 §15) — RADAR-SECOP2
// Capacidades procedurales versionadas, validables, con regresiones y métricas.
// El registry vive en skills_registry/*.json (semilla); la BD (SkillContract) es la fuente
// operativa con métricas (successRate, runsCount) que el seed NUNCA pisa.

import { db } from '@/lib/db'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

// ─── Tipos del contrato (formato JSON del registry) ──────────

export interface SkillRegressionTest {
  input: unknown
  expected: unknown
}

export interface SkillContractSource {
  identity: string
  version: string
  purpose: string
  trigger?: string
  prerequisites?: string[]
  procedure?: string[]
  tools_required?: string[]
  expected_result?: string
  verification?: unknown // string | objeto estructurado
  pitfalls?: string[]
  evidence_policy?: unknown // objeto de política
  regression_tests?: SkillRegressionTest[]
  confidence?: number
  success_rate?: number
  origin?: string
  last_validated?: string | null
}

export interface SkillValidation {
  valid: boolean
  errors: string[]
}

// Contrato completo con los JSON ya parseados (respuesta de API / consumo interno)
export interface SkillContractFull {
  id?: string
  identity: string
  version: string
  purpose: string
  trigger: string | null
  prerequisites: string[]
  procedure: string[]
  tools_required: string[]
  expected_result: string | null
  verification: unknown
  pitfalls: string[]
  evidence_policy: unknown
  status: string
  confidence: number
  successRate: number
  runsCount: number
  origin: string
  lastValidatedAt: string | null
  regression_tests: SkillRegressionTest[]
  validation?: SkillValidation
}

// ─── Ubicación del registry ──────────────────────────────────

export const SKILL_REGISTRY_DIR = path.join(process.cwd(), 'skills_registry')

// ─── Carga del registry (try/catch por archivo) ──────────────

export function loadRegistry(): { contracts: SkillContractSource[]; parseErrors: string[] } {
  const contracts: SkillContractSource[] = []
  const parseErrors: string[] = []
  let files: string[] = []
  try {
    files = readdirSync(SKILL_REGISTRY_DIR).filter((f) => f.endsWith('.json')).sort()
  } catch (err) {
    parseErrors.push(
      `No se pudo leer el directorio del registry (${SKILL_REGISTRY_DIR}): ${err instanceof Error ? err.message : String(err)}`,
    )
    return { contracts, parseErrors }
  }
  for (const file of files) {
    try {
      const raw = readFileSync(path.join(SKILL_REGISTRY_DIR, file), 'utf-8')
      const parsed = JSON.parse(raw) as SkillContractSource
      if (parsed && typeof parsed === 'object' && typeof parsed.identity === 'string') {
        contracts.push(parsed)
      } else {
        parseErrors.push(`${file}: JSON sin campo 'identity' string`)
      }
    } catch (err) {
      parseErrors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { contracts, parseErrors }
}

// ─── Validación estructural del contrato ─────────────────────

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const IDENTITY_RE = /^[A-Z][A-Z0-9_]*$/

export function validateContract(c: Partial<SkillContractSource> | null | undefined): SkillValidation {
  const errors: string[] = []
  if (!c || typeof c !== 'object') {
    return { valid: false, errors: ['El contrato no es un objeto válido'] }
  }
  if (!c.identity || typeof c.identity !== 'string' || !IDENTITY_RE.test(c.identity)) {
    errors.push("identity es obligatorio y debe ser MAYÚSCULAS_CON_GUION_BAJO")
  }
  if (!c.version || typeof c.version !== 'string' || !SEMVER_RE.test(c.version)) {
    errors.push('version es obligatoria y debe ser semver válida (p.ej. 1.0.0)')
  }
  if (!c.purpose || typeof c.purpose !== 'string' || c.purpose.trim().length < 10) {
    errors.push('purpose es obligatorio (mínimo 10 caracteres)')
  }
  if (!c.trigger || typeof c.trigger !== 'string' || c.trigger.trim().length < 5) {
    errors.push('trigger es obligatorio (cuándo se activa la skill)')
  }
  if (!Array.isArray(c.procedure) || c.procedure.length < 1) {
    errors.push('procedure es obligatorio (al menos 1 paso)')
  } else if (c.procedure.some((p) => typeof p !== 'string' || !p.trim())) {
    errors.push('procedure: todos los pasos deben ser strings no vacíos')
  }
  if (!Array.isArray(c.tools_required) || c.tools_required.length < 1) {
    errors.push('tools_required es obligatorio (al menos 1 herramienta)')
  }
  if (!c.expected_result || typeof c.expected_result !== 'string' || c.expected_result.trim().length < 5) {
    errors.push('expected_result es obligatorio')
  }
  if (!c.verification || (typeof c.verification !== 'string' && typeof c.verification !== 'object')) {
    errors.push('verification es obligatorio (cómo validar el resultado)')
  }
  if (!c.evidence_policy || typeof c.evidence_policy !== 'object' || Array.isArray(c.evidence_policy)) {
    errors.push('evidence_policy es obligatorio y debe ser un objeto')
  }
  if (!Array.isArray(c.regression_tests) || c.regression_tests.length < 1) {
    errors.push('regression_tests es obligatorio (al menos 1 caso input/expected)')
  } else {
    const bad = c.regression_tests.some(
      (t) => !t || typeof t !== 'object' || !('input' in t) || !('expected' in t),
    )
    if (bad) errors.push('regression_tests: cada caso debe tener {input, expected}')
  }
  if (c.confidence !== undefined && (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1)) {
    errors.push('confidence debe ser un número entre 0 y 1')
  }
  return { valid: errors.length === 0, errors }
}

// ─── Mapeo registry ↔ BD ─────────────────────────────────────

type SkillContractRow = {
  id: string
  identity: string
  version: string
  purpose: string
  trigger: string | null
  prerequisitesJson: string | null
  procedureJson: string | null
  toolsRequiredJson: string | null
  expectedResult: string | null
  verificationJson: string | null
  pitfallsJson: string | null
  evidencePolicyJson: string | null
  status: string
  confidence: number
  successRate: number
  runsCount: number
  origin: string
  lastValidatedAt: Date | null
  regressionTestsJson: string | null
}

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

function parseJsonObject<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function rowToFull(row: SkillContractRow, validation?: SkillValidation): SkillContractFull {
  return {
    id: row.id,
    identity: row.identity,
    version: row.version,
    purpose: row.purpose,
    trigger: row.trigger,
    prerequisites: parseJsonArray<string>(row.prerequisitesJson),
    procedure: parseJsonArray<string>(row.procedureJson),
    tools_required: parseJsonArray<string>(row.toolsRequiredJson),
    expected_result: row.expectedResult,
    verification: parseJsonObject<unknown>(row.verificationJson) ?? row.verificationJson,
    pitfalls: parseJsonArray<string>(row.pitfallsJson),
    evidence_policy: parseJsonObject<unknown>(row.evidencePolicyJson),
    status: row.status,
    confidence: row.confidence,
    successRate: row.successRate,
    runsCount: row.runsCount,
    origin: row.origin,
    lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    regression_tests: parseJsonArray<SkillRegressionTest>(row.regressionTestsJson),
    ...(validation ? { validation } : {}),
  }
}

// ─── Seed idempotente desde el registry ──────────────────────

export interface SeedResult {
  seeded: number
  updated: number
  skipped: number
  parseErrors: string[]
  validationErrors: { identity: string; errors: string[] }[]
}

export async function seedSkills(): Promise<SeedResult> {
  const { contracts, parseErrors } = loadRegistry()
  const result: SeedResult = { seeded: 0, updated: 0, skipped: 0, parseErrors, validationErrors: [] }

  for (const c of contracts) {
    const v = validateContract(c)
    if (!v.valid) {
      result.validationErrors.push({ identity: c.identity ?? '(sin identity)', errors: v.errors })
      result.skipped++
      continue
    }
    const existing = await db.skillContract.findUnique({ where: { identity: c.identity } })
    if (!existing) {
      await db.skillContract.create({
        data: {
          identity: c.identity,
          version: c.version,
          purpose: c.purpose,
          trigger: c.trigger ?? null,
          prerequisitesJson: JSON.stringify(c.prerequisites ?? []),
          procedureJson: JSON.stringify(c.procedure ?? []),
          toolsRequiredJson: JSON.stringify(c.tools_required ?? []),
          expectedResult: c.expected_result ?? null,
          verificationJson: c.verification !== undefined ? JSON.stringify(c.verification) : null,
          pitfallsJson: JSON.stringify(c.pitfalls ?? []),
          evidencePolicyJson: c.evidence_policy !== undefined ? JSON.stringify(c.evidence_policy) : null,
          status: 'ACTIVE',
          confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
          successRate: typeof c.success_rate === 'number' ? c.success_rate : 0,
          runsCount: 0,
          origin: c.origin ?? 'SEED',
          lastValidatedAt: null,
          regressionTestsJson: JSON.stringify(c.regression_tests ?? []),
        },
      })
      result.seeded++
    } else {
      // Idempotente: actualiza solo contenido; NUNCA pisa métricas ni estado operacional
      // (successRate, runsCount, confidence, status, origin, lastValidatedAt quedan intactos).
      await db.skillContract.update({
        where: { identity: c.identity },
        data: {
          version: c.version,
          purpose: c.purpose,
          trigger: c.trigger ?? null,
          prerequisitesJson: JSON.stringify(c.prerequisites ?? []),
          procedureJson: JSON.stringify(c.procedure ?? []),
          toolsRequiredJson: JSON.stringify(c.tools_required ?? []),
          expectedResult: c.expected_result ?? null,
          verificationJson: c.verification !== undefined ? JSON.stringify(c.verification) : null,
          pitfallsJson: JSON.stringify(c.pitfalls ?? []),
          evidencePolicyJson: c.evidence_policy !== undefined ? JSON.stringify(c.evidence_policy) : null,
          regressionTestsJson: JSON.stringify(c.regression_tests ?? []),
        },
      })
      result.updated++
    }
  }
  return result
}

// ─── Listado / consulta ──────────────────────────────────────

export async function listSkills(): Promise<SkillContractFull[]> {
  let count = await db.skillContract.count()
  if (count === 0) {
    // Cae al registry: auto-seed idempotente
    await seedSkills()
    count = await db.skillContract.count()
  }
  if (count === 0) return [] // registry vacío o ilegible
  const rows = await db.skillContract.findMany({ orderBy: { identity: 'asc' } })
  return rows.map((r) => rowToFull(r))
}

export async function getSkill(identity: string): Promise<SkillContractFull | null> {
  const row = await db.skillContract.findUnique({ where: { identity } })
  if (row) return rowToFull(row)
  // Fallback al registry (contrato aún no sembrado o BD vacía)
  const { contracts } = loadRegistry()
  const c = contracts.find((x) => x.identity === identity)
  if (!c) return null
  const v = validateContract(c)
  return {
    identity: c.identity,
    version: c.version,
    purpose: c.purpose,
    trigger: c.trigger ?? null,
    prerequisites: c.prerequisites ?? [],
    procedure: c.procedure ?? [],
    tools_required: c.tools_required ?? [],
    expected_result: c.expected_result ?? null,
    verification: c.verification ?? null,
    pitfalls: c.pitfalls ?? [],
    evidence_policy: c.evidence_policy ?? null,
    status: 'ACTIVE',
    confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
    successRate: typeof c.success_rate === 'number' ? c.success_rate : 0,
    runsCount: 0,
    origin: c.origin ?? 'SEED',
    lastValidatedAt: c.last_validated ?? null,
    regression_tests: c.regression_tests ?? [],
    validation: v,
  }
}

// ─── Registro de ejecuciones (métricas) ──────────────────────

export interface RunResult {
  identity: string
  ok: boolean
  runsCount: number
  successRate: number
  lastValidatedAt: string | null
  notes?: string
}

export async function recordRun(identity: string, ok: boolean, notes?: string): Promise<RunResult> {
  const skill = await db.skillContract.findUnique({ where: { identity } })
  if (!skill) {
    throw new Error(`Skill '${identity}' no existe en el catálogo`)
  }
  const newRuns = skill.runsCount + 1
  // Recalculo incremental de la tasa de éxito
  const newRate = (skill.successRate * skill.runsCount + (ok ? 1 : 0)) / newRuns
  const lastValidatedAt = ok ? new Date() : skill.lastValidatedAt
  const updated = await db.skillContract.update({
    where: { identity },
    data: {
      runsCount: newRuns,
      successRate: Math.round(newRate * 10000) / 10000,
      lastValidatedAt,
    },
  })
  await db.auditEvent.create({
    data: {
      action: 'SKILL_RUN',
      entityType: 'SkillContract',
      entityId: identity,
      detail: JSON.stringify({ ok, notes: notes ?? null, runsCount: newRuns, successRate: updated.successRate }),
      status: ok ? 'OK' : 'ERROR',
    },
  })
  return {
    identity,
    ok,
    runsCount: updated.runsCount,
    successRate: updated.successRate,
    lastValidatedAt: updated.lastValidatedAt ? updated.lastValidatedAt.toISOString() : null,
    ...(notes !== undefined ? { notes } : {}),
  }
}
