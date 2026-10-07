// MÓDULO A — INGESTA SECOP
// Fuente oficial: datos.gov.co (Socrata) — dataset "SECOP II - Procesos de Contratación" (p6dx-8zbt)
// Consulta programática paginada, normalización, hash de contenido para detectar modificaciones.
// Task 2-f: paginación con $offset (páginas de 1000, máx. 5), hash extendido
// (awarded/openState/categoryCode/url), ventana "since" en hora Colombia (UTC-5),
// X-App-Token opcional (SOCRATA_APP_TOKEN) y telemetría ProviderMetric + latencia/httpStatus.

import { createHash } from 'crypto'
import { db } from './db'
import type { RawSecopRecord } from './types'

const DATASET = 'p6dx-8zbt'
const RESOURCE_URL = `https://www.datos.gov.co/resource/${DATASET}.json`
const SOURCE_TAG = `datos.gov.co/${DATASET}`

export const SECOP_SOURCE = SOURCE_TAG

// ── Paginación (Task 2-f) ────────────────────────────────────
const PAGE_SIZE = 1000 // tamaño de página SoQL
const MAX_PAGES = 5 // tope duro de páginas por consulta
const MAX_TOTAL = PAGE_SIZE * MAX_PAGES // tope total de filas

interface SocrataRow {
  entidad?: string
  nit_entidad?: string
  departamento_entidad?: string
  ciudad_entidad?: string
  ordenentidad?: string
  id_del_proceso?: string
  referencia_del_proceso?: string
  id_del_portafolio?: string
  nombre_del_procedimiento?: string
  descripci_n_del_procedimiento?: string
  fase?: string
  estado_del_procedimiento?: string
  estado_de_apertura_del_proceso?: string
  precio_base?: string
  modalidad_de_contratacion?: string
  justificaci_n_modalidad_de?: string
  tipo_de_contrato?: string
  subtipo_de_contrato?: string
  duracion?: string
  unidad_de_duracion?: string
  ciudad_de_la_unidad_de?: string
  nombre_de_la_unidad_de?: string
  codigo_principal_de_categoria?: string
  fecha_de_publicacion_del?: string
  fecha_de_ultima_publicaci?: string
  fecha_de_recepcion_de?: string
  fecha_de_apertura_de_respuesta?: string
  adjudicado?: string
  urlproceso?: { url?: string } | string
}

function parseDate(raw?: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function parsePrice(raw?: string): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function mapSocrataRow(row: SocrataRow): RawSecopRecord | null {
  const id = (row.id_del_proceso || '').trim()
  const entity = (row.entidad || '').trim()
  const objectName = (row.nombre_del_procedimiento || '').trim()
  if (!id || !entity) return null

  let url: string | null = null
  if (typeof row.urlproceso === 'string') url = row.urlproceso
  else if (row.urlproceso && typeof row.urlproceso.url === 'string') url = row.urlproceso.url

  return {
    id,
    entity,
    nit: row.nit_entidad || null,
    department: row.departamento_entidad || null,
    city: row.ciudad_entidad || null,
    entityOrder: row.ordenentidad || null,
    reference: row.referencia_del_proceso || null,
    portfolioId: row.id_del_portafolio || null,
    objectName: objectName || '(sin nombre del procedimiento)',
    description: row.descripci_n_del_procedimiento || null,
    phase: row.fase || null,
    state: row.estado_del_procedimiento || null,
    openState: row.estado_de_apertura_del_proceso || null,
    basePrice: parsePrice(row.precio_base),
    modality: row.modalidad_de_contratacion || null,
    justification: row.justificaci_n_modalidad_de || null,
    contractType: row.tipo_de_contrato || null,
    subType: row.subtipo_de_contrato || null,
    duration: row.duracion || null,
    durationUnit: row.unidad_de_duracion || null,
    unitCity: row.ciudad_de_la_unidad_de || null,
    unitName: row.nombre_de_la_unidad_de || null,
    categoryCode: row.codigo_principal_de_categoria || null,
    publishDate: parseDate(row.fecha_de_publicacion_del),
    lastPubDate: parseDate(row.fecha_de_ultima_publicaci),
    receptionDate: parseDate(row.fecha_de_recepcion_de),
    openRespDate: parseDate(row.fecha_de_apertura_de_respuesta),
    awarded: row.adjudicado || null,
    url,
  }
}

/**
 * Hash de contenido que dispara la detección de modificaciones.
 * Task 2-f: además de los 10 campos originales incluye awarded, openState,
 * categoryCode y url (antes una adjudicación o cambio de URL pasaban desapercibidos).
 */
export function contentHash(rec: RawSecopRecord): string {
  const canonical = JSON.stringify({
    o: rec.objectName,
    d: rec.description,
    p: rec.basePrice,
    f: rec.phase,
    e: rec.state,
    m: rec.modality,
    t: rec.contractType,
    u: rec.duration,
    l: rec.lastPubDate,
    r: rec.receptionDate,
    // Task 2-f — campos nuevos que disparan hash-diff:
    av: rec.awarded,
    os: rec.openState,
    cc: rec.categoryCode,
    url: rec.url,
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

export interface FetchOptions {
  days?: number // procesos publicados en los últimos N días
  limit?: number // tope total de filas (default: 5000 = 5 páginas × 1000)
}

export interface FetchResult {
  records: RawSecopRecord[]
  source: string
  fetchedAt: Date
  // ── Aditivo Task 2-f (no rompe el contrato anterior) ──
  pages: number // páginas Socrata consumidas
  truncated: boolean // true = posiblemente quedan filas en la fuente que no se trajeron
  latencyMs: number // latencia total del fetch (todas las páginas)
  httpStatus: number | null // último HTTP status recibido
  since: string // fecha (YYYY-MM-DD) inicial de la ventana en hora Colombia
}

/**
 * Fecha (YYYY-MM-DD) de "hoy - days" en hora de Colombia.
 * SECOP publica fecha_de_publicacion_del en hora local colombiana, así que la
 * ventana se calcula sobre el reloj de Bogotá (UTC-5 fijo: Colombia no aplica
 * horario de verano) — offset manual, sin dependencias nuevas.
 */
export function bogotaSinceIso(days: number): string {
  const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000 // UTC-5
  const nowBogota = Date.now() - BOGOTA_OFFSET_MS
  const since = new Date(nowBogota - days * 24 * 60 * 60 * 1000)
  return since.toISOString().slice(0, 10)
}

/** Registra telemetría del proveedor Socrata; nunca rompe la ingesta. */
async function recordProviderMetric(m: {
  ok: boolean
  httpStatus: number | null
  latencyMs: number
  meta: Record<string, unknown>
}): Promise<void> {
  try {
    await db.providerMetric.create({
      data: {
        provider: 'SECOP_SOCRATA',
        operation: 'fetchRecentProcesses',
        latencyMs: Math.round(m.latencyMs),
        ok: m.ok,
        httpStatus: m.httpStatus,
        metaJson: JSON.stringify(m.meta),
      },
    })
  } catch (err) {
    console.error('[secop] no se pudo registrar ProviderMetric:', err instanceof Error ? err.message : err)
  }
}

/** Consulta una página SoQL con timeout propio y header X-App-Token opcional. */
async function fetchPage(params: URLSearchParams): Promise<{ rows: SocrataRow[]; status: number }> {
  const token = process.env.SOCRATA_APP_TOKEN?.trim()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers['X-App-Token'] = token // throttling de Socrata sin coste si no existe

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(`${RESOURCE_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`SECOP API respondió ${res.status}`)
    const rows = (await res.json()) as SocrataRow[]
    return { rows: Array.isArray(rows) ? rows : [], status: res.status }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Timeout consultando la fuente SECOP (20s por página)')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Consulta procesos de contratación publicados recientemente en SECOP II.
 * Task 2-f: recorre páginas con $offset hasta agotar la fuente, llegar al tope
 * de 5 páginas o cumplir el `limit`; nunca trunca en silencio (expone truncated).
 */
export async function fetchRecentProcesses(opts: FetchOptions = {}): Promise<FetchResult> {
  const days = opts.days ?? 60
  const maxRecords = Math.min(Math.max(opts.limit ?? MAX_TOTAL, 1), MAX_TOTAL)
  const sinceIso = bogotaSinceIso(days)

  const baseParams: Record<string, string> = {
    $order: 'fecha_de_publicacion_del DESC',
    $where: `fecha_de_publicacion_del >= '${sinceIso}'`,
  }

  const records: RawSecopRecord[] = []
  let pages = 0
  let truncated = false
  let httpStatus: number | null = null
  const started = Date.now()

  try {
    while (pages < MAX_PAGES) {
      const remaining = maxRecords - records.length
      if (remaining <= 0) {
        truncated = true // se alcanzó el tope pedido con páginas llenas
        break
      }
      const pageSize = Math.min(PAGE_SIZE, remaining)
      const params = new URLSearchParams({
        ...baseParams,
        $limit: String(pageSize),
        $offset: String(records.length),
      })
      const { rows, status } = await fetchPage(params)
      httpStatus = status
      pages++
      for (const row of rows) {
        const mapped = mapSocrataRow(row)
        if (mapped) records.push(mapped)
      }
      // Página incompleta → la fuente se agotó, no hay más que paginar.
      if (rows.length < pageSize) {
        truncated = false
        break
      }
      // Página completa y se llegó a un tope → podrían quedar más filas.
      if (records.length >= maxRecords || pages >= MAX_PAGES) {
        truncated = true
        break
      }
    }
  } catch (err) {
    await recordProviderMetric({
      ok: false,
      httpStatus,
      latencyMs: Date.now() - started,
      meta: { pages, since: sinceIso, error: err instanceof Error ? err.message : 'error de red' },
    })
    throw err
  }

  const latencyMs = Date.now() - started
  await recordProviderMetric({
    ok: true,
    httpStatus,
    latencyMs,
    meta: { pages, truncated, records: records.length, since: sinceIso },
  })

  return {
    records,
    source: SOURCE_TAG,
    fetchedAt: new Date(),
    pages,
    truncated,
    latencyMs,
    httpStatus,
    since: sinceIso,
  }
}
