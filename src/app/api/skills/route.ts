// Skill Contracts — API de catálogo (PROMPT 05 §15)
// GET  /api/skills            → catálogo con validación estructural (auto-seed si la tabla está vacía)
// GET  /api/skills?validate=1 → fuerza revalidación estructural de todos (registry + sync con BD)
// POST /api/skills            → {action:"validate"|"seed"|"record_run", identity?, ok?, notes?}

import { safe, bad } from '@/lib/api'
import {
  loadRegistry,
  validateContract,
  seedSkills,
  listSkills,
  recordRun,
  type SkillContractSource,
  type SkillValidation,
} from '@/lib/skills'

export async function GET(req: Request) {
  return safe(async () => {
    const url = new URL(req.url)
    const forceValidate = url.searchParams.get('validate') === '1'

    // Auto-seed idempotente si la tabla está vacía (listSkills lo maneja)
    const skills = await listSkills()

    let validation: SkillValidation[] = skills.map((s) =>
      validateContract(toSource(s)),
    )
    let registryInfo: Record<string, unknown> | undefined

    if (forceValidate) {
      // Revalidación estructural completa: registry en disco + contratos en BD + sincronía de identidades
      const { contracts, parseErrors } = loadRegistry()
      const dbIdentities = new Set(skills.map((s) => s.identity))
      const registryIdentities = new Set(contracts.map((c) => c.identity))
      validation = contracts.map((c) => validateContract(c))
      registryInfo = {
        registryCount: contracts.length,
        parseErrors,
        missingInDb: [...registryIdentities].filter((i) => !dbIdentities.has(i)),
        extraInDb: [...dbIdentities].filter((i) => !registryIdentities.has(i)),
      }
    }

    const allValid =
      validation.length > 0 && validation.every((v) => v.valid) &&
      (!registryInfo || (registryInfo.missingInDb as string[]).length === 0)

    return {
      count: skills.length,
      allValid,
      ...(registryInfo ? { registry: registryInfo } : {}),
      skills: skills.map((s, i) => ({
        identity: s.identity,
        version: s.version,
        purpose: s.purpose,
        status: s.status,
        confidence: s.confidence,
        successRate: s.successRate,
        runsCount: s.runsCount,
        validation: validation[i] ?? validateContract(toSource(s)),
      })),
    }
  })
}

export async function POST(req: Request) {
  return safe(async () => {
    let body: { action?: string; identity?: string; ok?: boolean; notes?: string } = {}
    try {
      body = await req.json()
    } catch {
      return bad('Cuerpo JSON inválido')
    }
    const action = body.action
    if (action === 'validate') {
      const { contracts, parseErrors } = loadRegistry()
      const results = contracts.map((c) => ({ identity: c.identity, ...validateContract(c) }))
      const allValid = parseErrors.length === 0 && results.every((r) => r.valid)
      return { allValid, parseErrors, results }
    }
    if (action === 'seed') {
      const result = await seedSkills()
      return { action: 'seed', ...result }
    }
    if (action === 'record_run') {
      if (!body.identity) return bad("record_run requiere 'identity'")
      if (typeof body.ok !== 'boolean') return bad("record_run requiere 'ok' booleano")
      const result = await recordRun(body.identity, body.ok, body.notes)
      return { action: 'record_run', ...result }
    }
    return bad("action debe ser 'validate' | 'seed' | 'record_run'")
  })
}

// Adaptador: contrato completo (BD o fallback) → formato fuente del registry para validar
function toSource(s: {
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
  regression_tests: { input: unknown; expected: unknown }[]
  confidence: number
}): SkillContractSource {
  return {
    identity: s.identity,
    version: s.version,
    purpose: s.purpose,
    trigger: s.trigger ?? undefined,
    prerequisites: s.prerequisites,
    procedure: s.procedure,
    tools_required: s.tools_required,
    expected_result: s.expected_result ?? undefined,
    verification: s.verification,
    pitfalls: s.pitfalls,
    evidence_policy: s.evidence_policy ?? undefined,
    regression_tests: s.regression_tests,
    confidence: s.confidence,
  }
}
