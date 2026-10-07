// ─── MEMORYDV (PROMPT 05 §13-14) — RADAR-SECOP2 ─────────────────────────────
// Memoria aislada por agent_id y dominio. Regla dura: la memoria FACTUAL exige
// evidencia (Evidence.id) — una inferencia del LLM nunca se promociona
// automáticamente a hecho (PROMPT 05 §14).
// Aislamiento duro: NUNCA se lee ni escribe memoria de otros agentes
// (CRM-ALBRA, TRADING, NEX-SCOPE, LEADS, CHISMOSO…).

import { createRequire } from "module"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { db } from "@/lib/db"
import type { MemoryEntry } from "@prisma/client"

// ─── Workaround runtime (solo dev) ──────────────────────────────────────────
// El dev server arrancó ANTES de que se regenerara el cliente Prisma (cuando se
// añadió el modelo MemoryEntry), y src/lib/db.ts cachea la instancia en
// globalThis → en ESTE proceso vivo `db.memoryEntry` es undefined. No se toca
// db.ts ni se reinicia el server: si el cliente cacheado está obsoleto, se
// instancia una vez el cliente regenerado (cache-busting de require). En un
// proceso nuevo esto no se ejecuta jamás: se usa `db` (contrato estándar).
let staleClientFallback: PrismaClient | null = null

function mdb(): PrismaClient {
  if (typeof (db as unknown as Record<string, unknown>).memoryEntry !== "undefined") return db
  if (staleClientFallback) return staleClientFallback
  const nodeRequire = createRequire(join(process.cwd(), "package.json"))
  for (const key of Object.keys(nodeRequire.cache)) {
    if (key.includes("/node_modules/@prisma/client/") || key.includes("/node_modules/.prisma/client/")) {
      delete nodeRequire.cache[key]
    }
  }
  const Fresh = (nodeRequire("@prisma/client") as any).PrismaClient as typeof PrismaClient
  staleClientFallback = new Fresh()
  return staleClientFallback
}

export const AGENT_ID = "RADAR-SECOP2"
export const DOMAIN = "procurement-secop2"

export const MEMORY_TYPES = ["EPISODIC", "SEMANTIC", "FACTUAL", "PROCEDURAL"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export const TRUTH_LEVELS = ["VERIFIED", "OBSERVED", "INFERRED", "ESTIMATED", "UNKNOWN"] as const
export type TruthLevel = (typeof TRUTH_LEVELS)[number]

const DAY_MS = 24 * 60 * 60 * 1000
const CONSOLIDATE_AFTER_DAYS = 7
const CONSOLIDATE_MIN_ACCESSES = 2
const DECAY_PER_DAY = 0.95
const DECAY_FLOOR = 0.05
const ACCESS_REFRESH_STEP = 0.15 // cada retrieval empuja decayWeight hacia 1.0

export class MemoryValidationError extends Error {}

// ─── Helpers de serialización JSON ──────────────────────────────────────────

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export interface MemoryDTO {
  id: string
  agentId: string
  domain: string
  type: string
  key: string
  content: string
  summary: string | null
  evidenceIds: string[]
  tags: string[]
  truthLevel: string
  confidence: number
  sourceExecutionId: string | null
  decayWeight: number
  accessCount: number
  lastAccessAt: string | null
  consolidatedAt: string | null
  expiresAt: string | null
  createdAt: string
  score?: number
}

export function toDTO(entry: MemoryEntry, score?: number): MemoryDTO {
  return {
    id: entry.id,
    agentId: entry.agentId,
    domain: entry.domain,
    type: entry.type,
    key: entry.key,
    content: entry.content,
    summary: entry.summary,
    evidenceIds: parseJsonArray(entry.evidenceIds),
    tags: parseJsonArray(entry.tags),
    truthLevel: entry.truthLevel,
    confidence: entry.confidence,
    sourceExecutionId: entry.sourceExecutionId,
    decayWeight: entry.decayWeight,
    accessCount: entry.accessCount,
    lastAccessAt: entry.lastAccessAt ? entry.lastAccessAt.toISOString() : null,
    consolidatedAt: entry.consolidatedAt ? entry.consolidatedAt.toISOString() : null,
    expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
    createdAt: entry.createdAt.toISOString(),
    ...(score !== undefined ? { score } : {}),
  }
}

// ─── remember(): escribir memoria (con regla dura FACTUAL) ──────────────────

export interface RememberInput {
  type: string
  key: string
  content: string
  summary?: string
  evidenceIds?: string[]
  tags?: string[]
  truthLevel?: string
  confidence?: number
  sourceExecutionId?: string
  expiresAt?: string
  // Si true, una FACTUAL sin evidencia NO se rechaza: se demora a SEMANTIC
  // dejando traza del porqué en summary (nunca se promueve a hecho).
  allowDemote?: boolean
  // Campos de aislamiento: por defecto SIEMPRE se escribe con la identidad del
  // RADAR. Solo si llegan agentId Y domain explícitos Y distintos a los nuestros
  // se rechaza, para preservar el aislamiento entre agentes.
  agentId?: string
  domain?: string
}

const DEMOTE_TRACE =
  "DEMOVIDA de FACTUAL a SEMANTIC: sin evidenceIds, una inferencia del LLM nunca se promociona a hecho (PROMPT 05 §14)."

export async function remember(input: RememberInput): Promise<MemoryDTO> {
  // ── Aislamiento duro (PROMPT 05 §13) ──
  // Ignoramos agentId/domain externos silenciosamente (escribimos la nuestra),
  // salvo que vengan ambos explícitos y apunten a OTRO agente/dominio → rechazar.
  if (
    input.agentId !== undefined &&
    input.domain !== undefined &&
    (input.agentId !== AGENT_ID || input.domain !== DOMAIN)
  ) {
    throw new MemoryValidationError(
      `Aislamiento de memoria: no se puede escribir en agentId="${input.agentId}" domain="${input.domain}". Esta memoria pertenece a ${AGENT_ID}/${DOMAIN} (PROMPT 05 §13).`,
    )
  }

  // ── Validación de type ──
  const type = (input.type ?? "").trim().toUpperCase() as MemoryType
  if (!MEMORY_TYPES.includes(type)) {
    throw new MemoryValidationError(
      `type inválido: "${input.type}". Valores permitidos: ${MEMORY_TYPES.join(" | ")}.`,
    )
  }

  const key = (input.key ?? "").trim()
  if (!key) throw new MemoryValidationError("key es obligatoria (clave de retrieval).")
  const content = (input.content ?? "").trim()
  if (!content) throw new MemoryValidationError("content es obligatorio.")

  // ── Regla dura: FACTUAL exige evidencia (PROMPT 05 §14) ──
  const evidenceIds = Array.isArray(input.evidenceIds)
    ? input.evidenceIds.filter((e) => typeof e === "string" && e.trim() !== "")
    : []
  let effectiveType: MemoryType = type
  let summary = input.summary?.trim() || null
  if (type === "FACTUAL" && evidenceIds.length === 0) {
    if (input.allowDemote) {
      // Demora a SEMANTIC dejando traza del porqué — jamás se promueve a hecho.
      effectiveType = "SEMANTIC"
      summary = summary ? `${summary} | ${DEMOTE_TRACE}` : DEMOTE_TRACE
    } else {
      throw new MemoryValidationError(
        "memoria FACTUAL exige evidenceIds (PROMPT 05 §14): una inferencia del LLM nunca se promociona automáticamente a hecho.",
      )
    }
  }

  // ── Validación de truthLevel y confidence ──
  const truthLevel = ((input.truthLevel ?? "").trim().toUpperCase() || "UNKNOWN") as TruthLevel
  if (!TRUTH_LEVELS.includes(truthLevel)) {
    throw new MemoryValidationError(
      `truthLevel inválido: "${input.truthLevel}". Valores permitidos: ${TRUTH_LEVELS.join(" | ")}.`,
    )
  }
  const confidence =
    input.confidence === undefined || input.confidence === null
      ? 0.5
      : Math.min(1, Math.max(0, Number(input.confidence)))
  if (Number.isNaN(confidence)) throw new MemoryValidationError("confidence debe ser numérico (0..1).")

  const tags = Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === "string" && t.trim() !== "") : []
  let expiresAt: Date | null = null
  if (input.expiresAt) {
    const d = new Date(input.expiresAt)
    if (Number.isNaN(d.getTime())) throw new MemoryValidationError("expiresAt no es una fecha válida (ISO 8601).")
    expiresAt = d
  }

  const entry = await mdb().memoryEntry.create({
    data: {
      agentId: AGENT_ID, // SIEMPRE identidad del RADAR
      domain: DOMAIN, // SIEMPRE dominio del RADAR
      type: effectiveType,
      key,
      content,
      summary,
      evidenceIds: effectiveType === "FACTUAL" ? JSON.stringify(evidenceIds) : evidenceIds.length ? JSON.stringify(evidenceIds) : null,
      truthLevel,
      confidence,
      tags: tags.length ? JSON.stringify(tags) : null,
      sourceExecutionId: input.sourceExecutionId?.trim() || null,
      decayWeight: 1.0, // decayWeight inicial
      expiresAt,
    },
  })
  return toDTO(entry)
}

// ─── recall(): recuperación con scoring y decay ─────────────────────────────

export interface RecallOptions {
  type?: string
  limit?: number
}

interface Scored {
  entry: MemoryEntry
  matchScore: number
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,;:.,()\-–—_/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

function contains(haystack: string | null | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle)
}

export async function recall(query: string, opts: RecallOptions = {}): Promise<MemoryDTO[]> {
  // Aislamiento duro: SIEMPRE filtramos por agentId+domain del RADAR.
  const where: { agentId: string; domain: string; type?: string } = { agentId: AGENT_ID, domain: DOMAIN }
  const type = opts.type?.trim().toUpperCase()
  if (type) {
    if (!MEMORY_TYPES.includes(type as MemoryType)) {
      throw new MemoryValidationError(`type inválido: "${opts.type}". Valores permitidos: ${MEMORY_TYPES.join(" | ")}.`)
    }
    where.type = type
  }

  const entries = await mdb().memoryEntry.findMany({ where })
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const fullQuery = query.trim().toLowerCase()
  const scored: Scored[] = []
  for (const entry of entries) {
    const tags = parseJsonArray(entry.tags).map((t) => t.toLowerCase())
    let matchScore = 0
    // Coincidencia exacta de la query completa en la key → peso fuerte.
    if (contains(entry.key, fullQuery)) matchScore += 3
    for (const token of tokens) {
      if (contains(entry.key, token)) matchScore += 2
      if (tags.some((tag) => tag.includes(token))) matchScore += 1.5
      if (contains(entry.summary, token)) matchScore += 1
      if (contains(entry.content, token)) matchScore += 1
    }
    if (matchScore > 0) scored.push({ entry, matchScore })
  }

  // score = coincidencia × decayWeight × confidence
  scored.sort(
    (a, b) =>
      b.matchScore * b.entry.decayWeight * b.entry.confidence -
      a.matchScore * a.entry.decayWeight * a.entry.confidence,
  )

  const limit = Math.min(Math.max(1, opts.limit ?? 10), 100)
  const top = scored.slice(0, limit)
  const now = new Date()

  // El uso mantiene viva la memoria: accessCount+1, lastAccessAt, decayWeight → 1.0.
  const refreshed = await Promise.all(
    top.map(async ({ entry, matchScore }) => {
      const updated = await mdb().memoryEntry.update({
        where: { id: entry.id },
        data: {
          accessCount: { increment: 1 },
          lastAccessAt: now,
          decayWeight: Math.min(1.0, entry.decayWeight + ACCESS_REFRESH_STEP),
        },
      })
      return toDTO(updated, Number((matchScore * updated.decayWeight * updated.confidence).toFixed(4)))
    }),
  )
  return refreshed
}

// ─── consolidate(): EPISODIC → SEMANTIC por reglas simples (NO LLM) ─────────

export interface ConsolidateResult {
  promoted: number
  merged: number
  scanned: number
  details: { id: string; key: string; action: "PROMOTED" | "MERGED_DEDUP"; summary: string }[]
}

// Summary generada por reglas simples — jamás por LLM (PROMPT 05 §14).
function buildRuleSummary(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim()
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean
  const base = firstSentence.length > 180 ? `${firstSentence.slice(0, 177)}…` : firstSentence
  return `[Consolidada de EPISODIC] ${base}`
}

export async function consolidate(): Promise<ConsolidateResult> {
  const cutoff = new Date(Date.now() - CONSOLIDATE_AFTER_DAYS * DAY_MS)
  // Aislamiento: solo memoria del RADAR en su dominio.
  const candidates = await mdb().memoryEntry.findMany({
    where: { agentId: AGENT_ID, domain: DOMAIN, type: "EPISODIC", createdAt: { lt: cutoff }, accessCount: { gte: CONSOLIDATE_MIN_ACCESSES } },
  })

  const details: ConsolidateResult["details"] = []
  let promoted = 0
  let merged = 0

  for (const entry of candidates) {
    // Dedup por key igual: si ya existe una SEMANTIC con la misma key…
    const existing = await mdb().memoryEntry.findFirst({
      where: { agentId: AGENT_ID, domain: DOMAIN, type: "SEMANTIC", key: entry.key },
    })
    if (existing) {
      if (existing.content.trim() === entry.content.trim()) {
        // content idéntico → fusionar (eliminar el duplicado EPISODIC).
        await mdb().memoryEntry.delete({ where: { id: entry.id } })
        merged += 1
        details.push({ id: entry.id, key: entry.key, action: "MERGED_DEDUP", summary: existing.summary ?? "" })
        continue
      }
      // mismo key pero content distinto → se promueve igual, anotando la fusión.
      const summary = `${buildRuleSummary(entry.content)} | Fusionada con SEMANTIC existente de la misma key.`
      await mdb().memoryEntry.update({
        where: { id: entry.id },
        data: { type: "SEMANTIC", summary, consolidatedAt: new Date() },
      })
      promoted += 1
      details.push({ id: entry.id, key: entry.key, action: "PROMOTED", summary })
      continue
    }
    // Promoción a SEMANTIC con summary por reglas simples y consolidatedAt.
    const summary = buildRuleSummary(entry.content)
    await mdb().memoryEntry.update({
      where: { id: entry.id },
      data: { type: "SEMANTIC", summary, consolidatedAt: new Date() },
    })
    promoted += 1
    details.push({ id: entry.id, key: entry.key, action: "PROMOTED", summary })
  }

  return { promoted, merged, scanned: candidates.length, details }
}

// ─── decay(): pesos decaen con los días sin acceso; expira vencidas ─────────

export interface DecayResult {
  updated: number
  expired: number
  details: { id: string; key: string; from: number; to: number; daysIdle: number }[]
}

export async function decay(): Promise<DecayResult> {
  const now = new Date()
  // Aislamiento: solo memoria del RADAR en su dominio.
  const entries = await mdb().memoryEntry.findMany({ where: { agentId: AGENT_ID, domain: DOMAIN } })

  const details: DecayResult["details"] = []
  let updated = 0

  for (const entry of entries) {
    const last = entry.lastAccessAt ?? entry.createdAt
    const daysIdle = Math.floor((now.getTime() - last.getTime()) / DAY_MS)
    if (daysIdle <= 0) continue // accedida hoy: no decae
    const target = Math.max(DECAY_FLOOR, entry.decayWeight * Math.pow(DECAY_PER_DAY, daysIdle))
    if (Math.abs(target - entry.decayWeight) < 0.0001) continue
    await mdb().memoryEntry.update({ where: { id: entry.id }, data: { decayWeight: Number(target.toFixed(4)) } })
    updated += 1
    details.push({ id: entry.id, key: entry.key, from: entry.decayWeight, to: Number(target.toFixed(4)), daysIdle })
  }

  // Opcional: expira (elimina) entradas cuyo expiresAt ya pasó.
  const expiredEntries = entries.filter((e) => e.expiresAt && e.expiresAt < now)
  for (const e of expiredEntries) {
    await mdb().memoryEntry.delete({ where: { id: e.id } })
  }

  return { updated, expired: expiredEntries.length, details }
}

// ─── stats(): métricas de la memoria ────────────────────────────────────────

export interface MemoryStats {
  total: number
  byType: { type: string; count: number }[]
  avgConfidence: number
  factual: number
  factualWithEvidence: number
  topKeys: { key: string; accesses: number }[]
  oldest: string | null
  newest: string | null
}

export async function stats(): Promise<MemoryStats> {
  // Aislamiento: solo memoria del RADAR en su dominio.
  const entries = await mdb().memoryEntry.findMany({ where: { agentId: AGENT_ID, domain: DOMAIN } })

  const byTypeMap = new Map<string, number>()
  for (const t of MEMORY_TYPES) byTypeMap.set(t, 0)
  let confidenceSum = 0
  let factual = 0
  let factualWithEvidence = 0
  const keyAccess = new Map<string, number>()

  for (const e of entries) {
    byTypeMap.set(e.type, (byTypeMap.get(e.type) ?? 0) + 1)
    confidenceSum += e.confidence
    if (e.type === "FACTUAL") {
      factual += 1
      if (parseJsonArray(e.evidenceIds).length > 0) factualWithEvidence += 1
    }
    keyAccess.set(e.key, (keyAccess.get(e.key) ?? 0) + e.accessCount)
  }

  const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return {
    total: entries.length,
    byType: [...byTypeMap.entries()].map(([type, count]) => ({ type, count })),
    avgConfidence: entries.length ? Number((confidenceSum / entries.length).toFixed(4)) : 0,
    factual,
    factualWithEvidence,
    topKeys: [...keyAccess.entries()]
      .map(([key, accesses]) => ({ key, accesses }))
      .sort((a, b) => b.accesses - a.accesses)
      .slice(0, 5),
    oldest: sorted[0]?.createdAt.toISOString() ?? null,
    newest: sorted[sorted.length - 1]?.createdAt.toISOString() ?? null,
  }
}

// ─── list(): listado plano (sin scoring) ────────────────────────────────────

export async function list(opts: { type?: string; limit?: number } = {}): Promise<MemoryDTO[]> {
  const where: { agentId: string; domain: string; type?: string } = { agentId: AGENT_ID, domain: DOMAIN }
  const type = opts.type?.trim().toUpperCase()
  if (type) {
    if (!MEMORY_TYPES.includes(type as MemoryType)) {
      throw new MemoryValidationError(`type inválido: "${opts.type}". Valores permitidos: ${MEMORY_TYPES.join(" | ")}.`)
    }
    where.type = type
  }
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 100)
  const entries = await mdb().memoryEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: limit })
  return entries.map((e) => toDTO(e))
}

// ─── getById(): con aislamiento duro ────────────────────────────────────────

export async function getById(id: string): Promise<MemoryDTO | null> {
  const entry = await mdb().memoryEntry.findUnique({ where: { id } })
  // Nunca exponer memoria de otro agente/dominio: 404 para el llamante.
  if (!entry || entry.agentId !== AGENT_ID || entry.domain !== DOMAIN) return null
  return toDTO(entry)
}

// ─── remove(): con aislamiento duro ─────────────────────────────────────────

export async function remove(id: string): Promise<boolean> {
  const entry = await mdb().memoryEntry.findUnique({ where: { id } })
  if (!entry || entry.agentId !== AGENT_ID || entry.domain !== DOMAIN) return false
  await mdb().memoryEntry.delete({ where: { id } })
  return true
}

// ─── SEED idempotente: solo si la tabla (de este agente) está vacía ─────────

export async function seedIfEmpty(): Promise<{ seeded: boolean; created: number }> {
  const count = await mdb().memoryEntry.count({ where: { agentId: AGENT_ID, domain: DOMAIN } })
  if (count > 0) return { seeded: false, created: 0 }

  const seeds: RememberInput[] = [
    {
      type: "FACTUAL",
      key: "entidad:Jardín Botánico de Bogotá",
      content:
        "Entidad Jardín Botánico de Bogotá requiere póliza de cumplimiento del 10% del valor del contrato en sus procesos de contratación de servicios.",
      summary: "origin SEED — hecho observado en pliegos de la entidad, respaldado por evidencia.",
      evidenceIds: ["seed-evidence-1"],
      tags: ["póliza", "garantía", "jardín-botánico", "cumplimiento"],
      truthLevel: "OBSERVED",
      confidence: 0.9,
    },
    {
      type: "SEMANTIC",
      key: "patrón:licitaciones-aseo-experiencia",
      content: "Las licitaciones de aseo suelen exigir 3 años de experiencia acreditada en servicios de aseo y afeites.",
      tags: ["patrón", "aseo", "experiencia"],
      truthLevel: "INFERRED",
      confidence: 0.6,
    },
    {
      type: "PROCEDURAL",
      key: "procedimiento:respuesta-preguntas-pliego",
      content:
        "Para preparar la respuesta a preguntas de pliego: 1) Leer el pliego completo y listar ambigüedades por capítulo. 2) Verificar cronograma del proceso (fecha límite de preguntas en SECOP). 3) Redactar preguntas en términos concretos citando numeral exacto. 4) Filtrar por la plataforma de la entidad dentro del plazo. 5) Registrar la respuesta recibida como evidencia y ajustar la oferta si aplica.",
      tags: ["pliego", "preguntas", "procedimiento"],
      truthLevel: "VERIFIED",
      confidence: 0.95,
    },
    {
      type: "EPISODIC",
      key: "episodio:sync-inicial",
      content: "Sync inicial ejecutado: se inicializó la memoria del agente RADAR-SECOP2 en el dominio procurement-secop2.",
      tags: ["sync", "inicialización"],
      truthLevel: "OBSERVED",
      confidence: 1,
    },
  ]

  let created = 0
  for (const seed of seeds) {
    await remember(seed) // pasa por las mismas validaciones (incluida la regla FACTUAL)
    created += 1
  }
  return { seeded: true, created }
}
