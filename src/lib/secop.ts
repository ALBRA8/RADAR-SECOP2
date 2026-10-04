// MÓDULO A — INGESTA SECOP
// Fuente oficial: datos.gov.co (Socrata) — dataset "SECOP II - Procesos de Contratación" (p6dx-8zbt)
// Consulta programática, normalización, hash de contenido para detectar modificaciones.

import { createHash } from 'crypto'
import type { RawSecopRecord } from './types'

const DATASET = 'p6dx-8zbt'
const RESOURCE_URL = `https://www.datos.gov.co/resource/${DATASET}.json`
const SOURCE_TAG = `datos.gov.co/${DATASET}`

export const SECOP_SOURCE = SOURCE_TAG

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
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

export interface FetchOptions {
  days?: number // procesos publicados en los últimos N días
  limit?: number
}

export interface FetchResult {
  records: RawSecopRecord[]
  source: string
  fetchedAt: Date
}

/** Consulta procesos de contratación publicados recientemente en SECOP II. */
export async function fetchRecentProcesses(opts: FetchOptions = {}): Promise<FetchResult> {
  const days = opts.days ?? 60
  const limit = Math.min(opts.limit ?? 250, 1000)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const sinceIso = since.toISOString().split('T')[0]

  const params = new URLSearchParams({
    $limit: String(limit),
    $order: 'fecha_de_publicacion_del DESC',
    $where: `fecha_de_publicacion_del >= '${sinceIso}'`,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(`${RESOURCE_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`SECOP API respondió ${res.status}`)
    const rows = (await res.json()) as SocrataRow[]
    const records = rows
      .map(mapSocrataRow)
      .filter((r): r is RawSecopRecord => r !== null)
    return { records, source: SOURCE_TAG, fetchedAt: new Date() }
  } finally {
    clearTimeout(timer)
  }
}
