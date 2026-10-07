// ORQUESTADOR — Ingesta SECOP → filtro determinístico → compatibilidad → oportunidades → alertas → ranking
// Task 2-f: dedup intra-batch (última fila gana), diff real campo a campo persistido en
// ProcessChange (old→new con impacto), update de modificación escribe TODOS los campos,
// discardReason persistido en re-clasificación, deadline fallback (openRespDate),
// auditoría de errores de fetch (SYNC_ERROR) y respuesta aditiva observable.

import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { fetchRecentProcesses, contentHash, SECOP_SOURCE } from './secop'
import { applyDeterministicFilter, keywordHits } from './filters'
import { evaluateCompatibility } from './compat'
import {
  parseJsonArray,
  type CompanyConfigData,
  type DocumentData,
  type ExperienceData,
  type ProductItemData,
  type RawSecopRecord,
} from './types'

export interface SyncResult {
  ok: boolean
  source: string
  fetched: number
  processesCreated: number
  processesUpdated: number
  opportunitiesCreated: number
  opportunitiesUpdated: number
  discarded: number
  companies: string[]
  message: string
  // ── Aditivo Task 2-f (no rompe el contrato anterior) ──
  changes: number
  byImpact: { ALTA: number; MEDIA: number; BAJA: number }
  skippedErrors: number // registros que fallaron individualmente sin abortar el sync
  pages: number
  truncated: boolean
  duplicatesInBatch: number // filas repetidas por id_del_proceso eliminadas antes de procesar
  discardReasons: Record<string, number> // conteo de descartes por motivo
  deadlineFallbacks: number // oportunidades con deadline estimada vía openRespDate
  fetchLatencyMs: number | null
  fetchError?: string
}

const HIGH_COMPAT_THRESHOLD = 70
const MIN_OPPORTUNITY_SCORE = 30
const TOP_N = 5

// ── DIFF real campo a campo (Task 2-f) ──────────────────────

type Impact = 'ALTA' | 'MEDIA' | 'BAJA'

const DIFF_FIELDS = [
  'receptionDate',
  'basePrice',
  'state',
  'openState',
  'objectName',
  'awarded',
  'url',
  'phase',
  'description',
] as const
type DiffField = (typeof DIFF_FIELDS)[number]

const FIELD_IMPACT: Record<DiffField, Impact> = {
  receptionDate: 'ALTA', // cambia el plazo para preparar la oferta
  state: 'ALTA', // puede abrir o cerrar la oportunidad
  basePrice: 'ALTA', // mueve el rango económico
  objectName: 'MEDIA',
  url: 'MEDIA',
  phase: 'MEDIA',
  openState: 'BAJA',
  awarded: 'BAJA',
  description: 'BAJA',
}

const FIELD_NOTES: Record<DiffField, string> = {
  receptionDate: 'Cambió la fecha de recepción de respuestas — afecta el plazo de preparación',
  state: 'Cambió el estado del procedimiento — puede abrir o cerrar la oportunidad',
  basePrice: 'Cambió el valor base estimado — revisa el rango económico',
  objectName: 'Cambió el nombre del objeto a contratar',
  url: 'Cambió la URL del proceso en SECOP',
  phase: 'Cambió la fase del proceso',
  openState: 'Cambió el estado de apertura del proceso',
  awarded: 'Cambió la información de adjudicación',
  description: 'Cambió la descripción del procedimiento',
}

/** Campos que se comparan entre la fila almacenada y la nueva (subset con impacto de negocio). */
interface DiffSource {
  receptionDate: Date | null
  basePrice: number | null
  state: string | null
  openState: string | null
  objectName: string
  awarded: string | null
  url: string | null
  phase: string | null
  description: string | null
}

export interface FieldDiff {
  field: DiffField
  oldValue: string | null // valor anterior serializado
  newValue: string | null // valor nuevo serializado
  impact: Impact
  impactNote: string
}

/** Serializa un valor para oldValue/newValue (fechas en ISO, números como string, null → null). */
export function serializeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/** Comparación tolerante: fechas por timestamp, números por valor, strings con trim. */
function valueChanged(before: unknown, after: unknown): boolean {
  if (before instanceof Date || after instanceof Date) {
    const ta = before instanceof Date ? before.getTime() : null
    const tb = after instanceof Date ? after.getTime() : null
    return ta !== tb
  }
  if (typeof before === 'number' || typeof after === 'number') {
    const na = typeof before === 'number' ? before : null
    const nb = typeof after === 'number' ? after : null
    return na !== nb
  }
  const sa = before == null ? null : String(before).trim() || null
  const sb = after == null ? null : String(after).trim() || null
  return sa !== sb
}

/**
 * Diff real entre el registro almacenado y el nuevo. El hash es solo disparador:
 * aquí se decide qué cambió de verdad (evita falsos positivos cuando la receta
 * del hash se amplía sin que cambie el contenido).
 */
export function diffRecordFields(existing: DiffSource, rec: RawSecopRecord): FieldDiff[] {
  const pairs: Array<{ field: DiffField; before: unknown; after: unknown }> = [
    { field: 'receptionDate', before: existing.receptionDate, after: rec.receptionDate },
    { field: 'basePrice', before: existing.basePrice, after: rec.basePrice },
    { field: 'state', before: existing.state, after: rec.state },
    { field: 'openState', before: existing.openState, after: rec.openState },
    { field: 'objectName', before: existing.objectName, after: rec.objectName },
    { field: 'awarded', before: existing.awarded, after: rec.awarded },
    { field: 'url', before: existing.url, after: rec.url },
    { field: 'phase', before: existing.phase, after: rec.phase },
    { field: 'description', before: existing.description, after: rec.description },
  ]
  const diffs: FieldDiff[] = []
  for (const p of pairs) {
    if (!valueChanged(p.before, p.after)) continue
    diffs.push({
      field: p.field,
      oldValue: serializeValue(p.before),
      newValue: serializeValue(p.after),
      impact: FIELD_IMPACT[p.field],
      impactNote: FIELD_NOTES[p.field],
    })
  }
  return diffs
}

/**
 * Dedup intra-batch por id_del_proceso ANTES de procesar: si la misma consulta
 * devuelve varias filas del proceso (p. ej. por paginación o republicación),
 * la ÚLTIMA fila gana.
 */
export function dedupeRecords(records: RawSecopRecord[]): {
  records: RawSecopRecord[]
  duplicatesRemoved: number
} {
  const map = new Map<string, RawSecopRecord>()
  for (const rec of records) map.set(rec.id, rec) // última ocurrencia gana
  return { records: [...map.values()], duplicatesRemoved: records.length - map.size }
}

/** Escritura completa del proceso (todos los campos del modelo) — elimina el stale del update parcial. */
function fullProcessData(rec: RawSecopRecord, hash: string) {
  return {
    entity: rec.entity,
    nit: rec.nit,
    department: rec.department,
    city: rec.city,
    entityOrder: rec.entityOrder,
    reference: rec.reference,
    portfolioId: rec.portfolioId,
    objectName: rec.objectName,
    description: rec.description,
    phase: rec.phase,
    state: rec.state,
    openState: rec.openState,
    basePrice: rec.basePrice,
    modality: rec.modality,
    justification: rec.justification,
    contractType: rec.contractType,
    subType: rec.subType,
    duration: rec.duration,
    durationUnit: rec.durationUnit,
    unitCity: rec.unitCity,
    unitName: rec.unitName,
    categoryCode: rec.categoryCode,
    publishDate: rec.publishDate,
    lastPubDate: rec.lastPubDate,
    receptionDate: rec.receptionDate,
    openRespDate: rec.openRespDate,
    awarded: rec.awarded,
    url: rec.url,
    contentHash: hash,
    rawJson: JSON.stringify(rec),
  }
}

function abbreviate(v: string | null, max = 40): string {
  if (v === null) return '(vacío)'
  return v.length > max ? `${v.slice(0, max)}…` : v
}

/**
 * Notificación PROCESO_MODIFICADO con resumen del diff (máx. 1 por proceso por sync).
 * Anti-spam: si ya existe una notificación no leída del mismo proceso en las últimas
 * 24h, se actualiza en lugar de crear otra.
 */
async function upsertModificationNotification(
  rec: RawSecopRecord,
  opportunityId: string | null,
  diffs: FieldDiff[],
): Promise<void> {
  const summary = diffs.map((d) => `${d.field}: ${abbreviate(d.oldValue)} → ${abbreviate(d.newValue)}`).join(' | ')
  const title =
    diffs.length === 1
      ? 'Un proceso cambió en SECOP'
      : `Un proceso cambió en SECOP (${diffs.length} campos)`
  const message = `${rec.id} — ${rec.objectName.slice(0, 80)}: ${summary}`
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const recent = await db.notification.findFirst({
    where: {
      type: 'PROCESO_MODIFICADO',
      opportunityId, // null coincide con notificaciones sin oportunidad vinculada
      read: false,
      createdAt: { gte: since24h },
      message: { contains: rec.id },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (recent) {
    await db.notification.update({ where: { id: recent.id }, data: { title, message } })
  } else {
    await db.notification.create({
      data: { type: 'PROCESO_MODIFICADO', title, message, opportunityId: opportunityId ?? undefined },
    })
  }
}

export async function runSync(opts: { days?: number; limit?: number } = {}): Promise<SyncResult> {
  const syncStarted = Date.now()
  const executionId = randomUUID()
  const companies = await db.company.findMany({
    include: { products: true, experiences: true, documents: true },
  })
  if (companies.length === 0) {
    return {
      ok: false,
      source: SECOP_SOURCE,
      fetched: 0, processesCreated: 0, processesUpdated: 0, opportunitiesCreated: 0, opportunitiesUpdated: 0, discarded: 0,
      companies: [],
      message: 'No hay empresas configuradas. Registra primero el perfil de la empresa.',
      changes: 0, byImpact: { ALTA: 0, MEDIA: 0, BAJA: 0 }, skippedErrors: 0, pages: 0, truncated: false,
      duplicatesInBatch: 0, discardReasons: {}, deadlineFallbacks: 0, fetchLatencyMs: null,
    }
  }

  // ── 1. Ingesta desde la fuente oficial (paginada) ───────────
  let fetchResult: Awaited<ReturnType<typeof fetchRecentProcesses>>
  try {
    fetchResult = await fetchRecentProcesses(opts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error de red'
    const latency = Date.now() - syncStarted
    // Task 2-f: el error del fetch se audita (antes se retornaba sin rastro).
    try {
      await db.auditEvent.create({
        data: {
          action: 'SYNC_ERROR',
          entityType: 'Sistema',
          entityId: SECOP_SOURCE,
          detail: `Fallo consultando la fuente oficial de SECOP II: ${msg}`,
          executionId,
          correlationId: executionId,
          latencyMs: latency,
          status: 'ERROR',
        },
      })
    } catch (auditErr) {
      console.error('[sync] no se pudo auditar SYNC_ERROR:', auditErr instanceof Error ? auditErr.message : auditErr)
    }
    return {
      ok: false,
      source: SECOP_SOURCE,
      fetched: 0, processesCreated: 0, processesUpdated: 0, opportunitiesCreated: 0, opportunitiesUpdated: 0, discarded: 0,
      companies: companies.map((c) => c.name),
      message: `No fue posible consultar la fuente oficial de SECOP II: ${msg}`,
      changes: 0, byImpact: { ALTA: 0, MEDIA: 0, BAJA: 0 }, skippedErrors: 0, pages: 0, truncated: false,
      duplicatesInBatch: 0, discardReasons: {}, deadlineFallbacks: 0, fetchLatencyMs: latency, fetchError: msg,
    }
  }

  // Dedup intra-batch: última fila gana (Task 2-f)
  const { records, duplicatesRemoved } = dedupeRecords(fetchResult.records)

  let processesCreated = 0
  let processesUpdated = 0
  let changesCreated = 0
  let skippedErrors = 0
  const byImpact = { ALTA: 0, MEDIA: 0, BAJA: 0 }
  const notifiedProcesses = new Set<string>()

  // ── 2. Persistencia con detección de modificaciones ─────────
  // find-then-branch (necesario para el diff) con try/catch POR REGISTRO:
  // un fallo individual se cuenta en skippedErrors y no aborta el sync.
  for (const rec of records) {
    try {
      const hash = contentHash(rec)
      const existing = await db.secopProcess.findUnique({ where: { id: rec.id } })
      if (!existing) {
        await db.secopProcess.create({
          data: { id: rec.id, source: SECOP_SOURCE, ...fullProcessData(rec, hash) },
        })
        processesCreated++
        continue
      }
      if (existing.contentHash === hash) continue // sin cambios

      // El hash cambió: diff real campo a campo para no inventar cambios
      // (p. ej. cuando la receta del hash se amplía sin modificación real).
      const diffs = diffRecordFields(existing, rec)
      await db.secopProcess.update({ where: { id: rec.id }, data: fullProcessData(rec, hash) })
      processesUpdated++

      if (diffs.length === 0) continue // solo cambiaron campos fuera del diff crítico

      const linkedOpp = await db.opportunity.findFirst({
        where: { processId: rec.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      const opportunityId = linkedOpp?.id ?? null

      for (const d of diffs) {
        await db.processChange.create({
          data: {
            processId: rec.id,
            opportunityId,
            field: d.field,
            oldValue: d.oldValue,
            newValue: d.newValue,
            impact: d.impact,
            impactNote: d.impactNote,
            source: SECOP_SOURCE,
          },
        })
        byImpact[d.impact]++
        changesCreated++
      }

      // Máx. 1 notificación de modificación por proceso por sync
      if (!notifiedProcesses.has(rec.id)) {
        notifiedProcesses.add(rec.id)
        await upsertModificationNotification(rec, opportunityId, diffs)
      }
    } catch (err) {
      skippedErrors++
      console.error(`[sync] registro ${rec.id} falló y se saltó:`, err instanceof Error ? err.message : err)
    }
  }

  // ── 3. Filtrado + compatibilidad por empresa ────────────────
  let opportunitiesCreated = 0
  let opportunitiesUpdated = 0
  let discarded = 0
  const discardReasons: Record<string, number> = {}
  const deadlineProcesses = new Set<string>()

  /** Deadline fallback: sin fecha de recepción se usa la fecha de apertura de respuestas (también SECOP, no se inventa). */
  const deadlineNote = (rec: RawSecopRecord): string => {
    if (rec.receptionDate || !rec.openRespDate) return ''
    deadlineProcesses.add(rec.id)
    return ` Fecha límite estimada (apertura de respuestas; SECOP no reporta fecha de recepción): ${rec.openRespDate.toISOString().slice(0, 10)}.`
  }

  const countDiscard = (reason: string) => {
    discardReasons[reason] = (discardReasons[reason] ?? 0) + 1
  }

  /** Re-clasificación: persiste el motivo en una Opportunity ya existente que ahora sale del filtro. */
  const persistReclassification = async (companyId: string, processId: string, reason: string) => {
    const existingOpp = await db.opportunity.findUnique({
      where: { companyId_processId: { companyId, processId } },
    })
    if (!existingOpp || existingOpp.status === 'DESCARTADA') return
    if (existingOpp.status === 'APROBADA_PREPARACION') {
      // Respetar la decisión humana: se traza el motivo sin bajar el estado.
      await db.opportunity.update({
        where: { id: existingOpp.id },
        data: { discardReason: `[No re-clasificada: aprobada] ${reason}` },
      })
    } else {
      await db.opportunity.update({
        where: { id: existingOpp.id },
        data: { status: 'DESCARTADA', discardReason: reason, rank: null },
      })
    }
  }

  for (const company of companies) {
    const cfg: CompanyConfigData = {
      id: company.id,
      name: company.name,
      nit: company.nit,
      description: company.description,
      city: company.city,
      department: company.department,
      minBudget: company.minBudget,
      maxBudget: company.maxBudget,
      departmentsAllowed: parseJsonArray(company.departmentsAllowed),
      modalitiesAllowed: parseJsonArray(company.modalitiesAllowed),
      contractTypesAllowed: parseJsonArray(company.contractTypesAllowed),
      phasesAllowed: parseJsonArray(company.phasesAllowed, ['Presentación de oferta', 'Selección']),
      requireKeywordHit: company.requireKeywordHit,
      capacity: company.capacity,
      approverName: company.approverName,
    }

    const products: ProductItemData[] = company.products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      keywords: parseJsonArray(p.keywords),
    }))
    const experiences: ExperienceData[] = company.experiences.map((e) => ({
      id: e.id, title: e.title, entity: e.entity, year: e.year, value: e.value, description: e.description,
    }))
    const documents: DocumentData[] = company.documents.map((d) => ({
      id: d.id, name: d.name, docType: d.docType, status: d.status as DocumentData['status'], notes: d.notes,
    }))

    const keywordsForFilter = products.flatMap((p) => [...p.keywords, p.name]).filter(Boolean)

    for (const rec of records) {
      try {
        const filter = applyDeterministicFilter({ ...cfg, productsKeywords: keywordsForFilter }, rec)
        if (!filter.passed) {
          discarded++
          const reason = filter.reasons[0] || 'Descartado por filtros de la empresa'
          countDiscard(reason)
          await persistReclassification(company.id, rec.id, reason)
          continue
        }

        const evaluation = evaluateCompatibility({ company: cfg, products, experiences, documents }, rec)
        if (evaluation.score < MIN_OPPORTUNITY_SCORE) {
          discarded++
          const reason = `Puntaje de compatibilidad insuficiente (${evaluation.score}/100, mínimo ${MIN_OPPORTUNITY_SCORE})`
          countDiscard(reason)
          await persistReclassification(company.id, rec.id, reason)
          continue
        }

        const missingDocs = documents.filter((d) => d.status !== 'DISPONIBLE').map((d) => d.name)
        const criticalDim = evaluation.dimensions.find((d) => d.key === 'objeto' && d.result === 'NO')
        const baseNextAction = criticalDim
          ? 'Validar pertinencia del objeto con el área comercial'
          : 'Revisar el proceso y decidir si se analiza con IA'

        const existingOpp = await db.opportunity.findUnique({
          where: { companyId_processId: { companyId: company.id, processId: rec.id } },
        })

        if (!existingOpp) {
          const opp = await db.opportunity.create({
            data: {
              companyId: company.id,
              processId: rec.id,
              status: 'NUEVA',
              score: evaluation.score,
              reasonsJson: JSON.stringify(evaluation.dimensions),
              missingDocsJson: JSON.stringify(missingDocs),
              risksJson: JSON.stringify(
                evaluation.dimensions.filter((d) => d.result === 'NO').map((d) => d.reason),
              ),
              nextAction: `${baseNextAction}${deadlineNote(rec)}`,
            },
          })
          opportunitiesCreated++

          if (evaluation.score >= HIGH_COMPAT_THRESHOLD) {
            await db.notification.create({
              data: {
                type: 'ALTA_COMPATIBILIDAD',
                title: `Oportunidad altamente compatible (${evaluation.score}/100)`,
                message: `${rec.entity} — ${rec.objectName.slice(0, 100)}`,
                opportunityId: opp.id,
              },
            })
          } else {
            await db.notification.create({
              data: {
                type: 'NUEVA_OPORTUNIDAD',
                title: 'Nueva oportunidad detectada',
                message: `${rec.entity} — ${rec.objectName.slice(0, 100)}`,
                opportunityId: opp.id,
              },
            })
          }
          if (missingDocs.length > 0) {
            await db.notification.create({
              data: {
                type: 'DOCUMENTO_FALTANTE',
                title: 'Documentos faltantes en el expediente',
                message: `Para responder procesos como ${rec.id} conviene contar con: ${missingDocs.slice(0, 4).join(', ')}.`,
                opportunityId: opp.id,
              },
            })
          }
        } else if (existingOpp.status === 'NUEVA' || existingOpp.status === 'COMPATIBLE' || existingOpp.status === 'EN_ANALISIS') {
          // Deadline fallback sobre nextAction existente (sin duplicar la nota).
          let nextAction = existingOpp.nextAction
          const note = deadlineNote(rec)
          if (note) {
            if (!nextAction) nextAction = note.trim()
            else if (!nextAction.includes('Fecha límite estimada')) nextAction = `${nextAction} ${note.trim()}`
          }
          await db.opportunity.update({
            where: { id: existingOpp.id },
            data: {
              score: evaluation.score,
              reasonsJson: JSON.stringify(evaluation.dimensions),
              missingDocsJson: JSON.stringify(missingDocs),
              risksJson: JSON.stringify(evaluation.dimensions.filter((d) => d.result === 'NO').map((d) => d.reason)),
              discardReason: null, // volvió a pasar los filtros: motivo de descarte viejo ya no aplica
              ...(nextAction ? { nextAction } : {}),
            },
          })
          opportunitiesUpdated++
        }
      } catch (err) {
        skippedErrors++
        console.error(
          `[sync] clasificación falló para proceso ${rec.id} y empresa ${company.name}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  // ── 4. Ranking (top 5 por defecto, configurable) ────────────
  await recomputeRanking(companies.map((c) => c.id))

  const latencyMs = Date.now() - syncStarted
  await db.auditEvent.create({
    data: {
      action: 'SYNC_SECOP',
      entityType: 'Sistema',
      detail: `Ingesta: ${records.length} procesos en ${fetchResult.pages} pág. (hasta ${fetchResult.since}, truncado: ${fetchResult.truncated ? 'sí' : 'no'}), ${processesCreated} nuevos, ${processesUpdated} actualizados, ${changesCreated} cambios (ALTA ${byImpact.ALTA}/MEDIA ${byImpact.MEDIA}/BAJA ${byImpact.BAJA}), ${opportunitiesCreated} oportunidades nuevas, ${discarded} descartes, ${skippedErrors} errores de registro.`,
      executionId,
      correlationId: executionId,
      latencyMs,
      status: skippedErrors > 0 ? 'PARTIAL' : 'OK',
    },
  })

  return {
    ok: true,
    source: SECOP_SOURCE,
    fetched: fetchResult.records.length,
    processesCreated,
    processesUpdated,
    opportunitiesCreated,
    opportunitiesUpdated,
    discarded,
    companies: companies.map((c) => c.name),
    message: `Sincronización exitosa: ${records.length} procesos consultados en ${fetchResult.pages} página(s) de la fuente oficial${fetchResult.truncated ? ' (ventana truncada por tope)' : ''}, ${processesCreated} nuevos, ${changesCreated} cambios detectados, ${opportunitiesCreated} oportunidades creadas, ${discarded} procesos descartados por filtros.`,
    changes: changesCreated,
    byImpact,
    skippedErrors,
    pages: fetchResult.pages,
    truncated: fetchResult.truncated,
    duplicatesInBatch: duplicatesRemoved,
    discardReasons,
    deadlineFallbacks: deadlineProcesses.size,
    fetchLatencyMs: fetchResult.latencyMs,
  }
}

/** Recalcula el ranking de relevancia (MÓDULO F) para cada empresa. */
export async function recomputeRanking(companyIds: string[]) {
  for (const companyId of companyIds) {
    const opps = await db.opportunity.findMany({
      where: { companyId, status: { in: ['NUEVA', 'EN_ANALISIS', 'COMPATIBLE'] } },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    })
    for (let i = 0; i < opps.length; i++) {
      await db.opportunity.update({ where: { id: opps[i].id }, data: { rank: i < TOP_N ? i + 1 : null } })
    }
  }
}

export { keywordHits }
