// MÓDULO AUTONOMÍA (PROMPT 05 §20) — RADAR-SECOP2
// Escalera de autonomía L0..L5 con techo global configurable (AutonomyConfig).
//
// Reglas:
// - L4/L5 SIEMPRE exigen además un flag manual (env RADAR_ALLOW_L4_L5=true);
//   nunca se habilitan por defecto ni solo elevando maxLevel.
// - Hoy todo el sistema opera ≤ L2 (síncrono interno): esta API NO bloquea
//   flujos existentes; queda expuesta para enforcement futuro.
// - El único punto de envío externo actual (POST /api/channels/messages, L3)
//   consulta assertAllowed y registra la decisión en auditoría; el bloqueo
//   duro es opt-in (?enforce=1 o env RADAR_ENFORCE_AUTONOMY=1).

import { db } from '@/lib/db'

export const LEVELS = [
  'L0_OBSERVE',
  'L1_RECOMMEND',
  'L2_EXECUTE_SAFE',
  'L3_EXECUTE_EXTERNAL',
  'L4_EXECUTE_SENSITIVE',
  'L5_SELF_IMPROVE',
] as const

export type AutonomyLevel = (typeof LEVELS)[number]

const SENSITIVE: readonly string[] = ['L4_EXECUTE_SENSITIVE', 'L5_SELF_IMPROVE']

export interface AutonomyDecision {
  allowed: boolean
  reason: string
  level: string
  maxLevel: string
  externalActionsAllowed: boolean
  manualFlagRequired?: boolean
}

/** Normaliza un nivel arbitrario (acepta "L2", "L2_EXECUTE_SAFE", minúsculas). */
export function normalizeLevel(raw: string | null | undefined): AutonomyLevel | null {
  if (!raw) return null
  const value = raw.trim().toUpperCase()
  const direct = LEVELS.find((l) => l === value)
  if (direct) return direct
  const short = value.match(/^L([0-5])$/)
  if (short) return LEVELS[Number(short[1])]
  return null
}

/** Singleton de configuración: crea la fila por defecto (L2, sin acciones externas) si falta. */
export async function getConfig() {
  const existing = await db.autonomyConfig.findFirst({ orderBy: { updatedAt: 'desc' } })
  if (existing) return existing
  return db.autonomyConfig.create({
    data: {
      maxLevel: 'L2_EXECUTE_SAFE',
      externalActionsAllowed: false,
      notes:
        'Config por defecto: el agente opera internamente hasta L2 (síncrono y seguro). L3 exige externalActionsAllowed=true; L4/L5 exigen además flag manual RADAR_ALLOW_L4_L5.',
    },
  })
}

/**
 * ¿Está permitido ejecutar a este nivel? Comparación por índice vs maxLevel.
 * - L4/L5 requieren SIEMPRE flag manual (env RADAR_ALLOW_L4_L5=true), además del techo.
 * - Nunca lanza: devuelve una decisión explicada.
 */
export async function assertAllowed(level: AutonomyLevel | string): Promise<AutonomyDecision> {
  const normalized = normalizeLevel(level)
  const config = await getConfig()
  const base = {
    maxLevel: config.maxLevel,
    externalActionsAllowed: config.externalActionsAllowed,
  }

  if (!normalized) {
    return {
      allowed: false,
      reason: `Nivel de autonomía desconocido: "${String(level)}". Niveles válidos: ${LEVELS.join(', ')}.`,
      level: String(level),
      ...base,
    }
  }

  const maxIndex = LEVELS.indexOf(normalizeLevel(config.maxLevel) ?? 'L2_EXECUTE_SAFE')
  const wantedIndex = LEVELS.indexOf(normalized)

  if (SENSITIVE.includes(normalized)) {
    const manualFlag = process.env.RADAR_ALLOW_L4_L5 === 'true'
    if (!manualFlag) {
      return {
        allowed: false,
        reason: `${normalized} exige flag manual RADAR_ALLOW_L4_L5=true (nunca se habilita por defecto).`,
        level: normalized,
        ...base,
        manualFlagRequired: true,
      }
    }
  }

  if (wantedIndex > maxIndex) {
    return {
      allowed: false,
      reason:
        normalized === 'L3_EXECUTE_EXTERNAL'
          ? `El techo de autonomía es ${config.maxLevel}; L3 (acciones externas) requiere subir maxLevel y activar externalActionsAllowed=true.`
          : `El techo de autonomía es ${config.maxLevel}; ${normalized} lo excede.`,
      level: normalized,
      ...base,
    }
  }

  if (normalized === 'L3_EXECUTE_EXTERNAL' && !config.externalActionsAllowed) {
    return {
      allowed: false,
      reason: 'L3 (acciones externas) está deshabilitado: externalActionsAllowed=false en AutonomyConfig.',
      level: normalized,
      ...base,
    }
  }

  return {
    allowed: true,
    reason: `${normalized} permitido bajo techo ${config.maxLevel}${config.externalActionsAllowed ? ' (acciones externas habilitadas)' : ''}.`,
    level: normalized,
    ...base,
  }
}
