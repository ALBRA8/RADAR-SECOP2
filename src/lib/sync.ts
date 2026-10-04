// ORQUESTADOR — Ingesta SECOP → filtro determinístico → compatibilidad → oportunidades → alertas → ranking

import { db } from '@/lib/db'
import { fetchRecentProcesses, contentHash, SECOP_SOURCE } from './secop'
import { applyDeterministicFilter, keywordHits } from './filters'
import { evaluateCompatibility } from './compat'
import { parseJsonArray, type CompanyConfigData, type DocumentData, type ExperienceData, type ProductItemData } from './types'

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
}

const HIGH_COMPAT_THRESHOLD = 70
const MIN_OPPORTUNITY_SCORE = 30
const TOP_N = 5

export async function runSync(opts: { days?: number; limit?: number } = {}): Promise<SyncResult> {
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
    }
  }

  // ── 1. Ingesta desde la fuente oficial ──────────────────────
  let records
  try {
    const result = await fetchRecentProcesses(opts)
    records = result.records
  } catch (err) {
    return {
      ok: false,
      source: SECOP_SOURCE,
      fetched: 0, processesCreated: 0, processesUpdated: 0, opportunitiesCreated: 0, opportunitiesUpdated: 0, discarded: 0,
      companies: companies.map((c) => c.name),
      message: `No fue posible consultar la fuente oficial de SECOP II: ${err instanceof Error ? err.message : 'error de red'}`,
    }
  }

  let processesCreated = 0
  let processesUpdated = 0

  // ── 2. Persistencia con dedup y detección de modificaciones ─
  for (const rec of records) {
    const hash = contentHash(rec)
    const existing = await db.secopProcess.findUnique({ where: { id: rec.id } })
    if (!existing) {
      await db.secopProcess.create({
        data: {
          id: rec.id,
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
          source: SECOP_SOURCE,
          contentHash: hash,
          rawJson: JSON.stringify(rec),
        },
      })
      processesCreated++
    } else if (existing.contentHash !== hash) {
      await db.secopProcess.update({
        where: { id: rec.id },
        data: {
          objectName: rec.objectName,
          description: rec.description,
          basePrice: rec.basePrice,
          phase: rec.phase,
          state: rec.state,
          modality: rec.modality,
          contractType: rec.contractType,
          duration: rec.duration,
          durationUnit: rec.durationUnit,
          lastPubDate: rec.lastPubDate,
          receptionDate: rec.receptionDate,
          awarded: rec.awarded,
          url: rec.url,
          contentHash: hash,
          rawJson: JSON.stringify(rec),
        },
      })
      processesUpdated++
      // Alerta: cambió un proceso ya almacenado
      const relatedOpps = await db.opportunity.findMany({ where: { processId: rec.id } })
      for (const opp of relatedOpps) {
        if (opp.status !== 'DESCARTADA') {
          await db.notification.create({
            data: {
              type: 'PROCESO_MODIFICADO',
              title: 'Un proceso cambió en SECOP',
              message: `El proceso ${rec.id} (${rec.objectName.slice(0, 80)}…) fue modificado por la entidad. Revisa la información actualizada.`,
              opportunityId: opp.id,
            },
          })
        }
      }
    }
  }

  // ── 3. Filtrado + compatibilidad por empresa ────────────────
  let opportunitiesCreated = 0
  let opportunitiesUpdated = 0
  let discarded = 0

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
      const filter = applyDeterministicFilter({ ...cfg, productsKeywords: keywordsForFilter }, rec)
      if (!filter.passed) {
        discarded++
        continue
      }

      const evaluation = evaluateCompatibility({ company: cfg, products, experiences, documents }, rec)
      if (evaluation.score < MIN_OPPORTUNITY_SCORE) {
        discarded++
        continue
      }

      const missingDocs = documents.filter((d) => d.status !== 'DISPONIBLE').map((d) => d.name)
      const criticalDim = evaluation.dimensions.find((d) => d.key === 'objeto' && d.result === 'NO')

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
            nextAction: criticalDim ? 'Validar pertinencia del objeto con el área comercial' : 'Revisar el proceso y decidir si se analiza con IA',
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
        await db.opportunity.update({
          where: { id: existingOpp.id },
          data: {
            score: evaluation.score,
            reasonsJson: JSON.stringify(evaluation.dimensions),
            missingDocsJson: JSON.stringify(missingDocs),
            risksJson: JSON.stringify(evaluation.dimensions.filter((d) => d.result === 'NO').map((d) => d.reason)),
          },
        })
        opportunitiesUpdated++
      }
    }
  }

  // ── 4. Ranking (top 5 por defecto, configurable) ────────────
  await recomputeRanking(companies.map((c) => c.id))

  await db.auditEvent.create({
    data: {
      action: 'SYNC_SECOP',
      entityType: 'Sistema',
      detail: `Ingesta: ${records.length} procesos consultados, ${processesCreated} nuevos, ${processesUpdated} actualizados, ${opportunitiesCreated} oportunidades nuevas.`,
    },
  })

  return {
    ok: true,
    source: SECOP_SOURCE,
    fetched: records.length,
    processesCreated,
    processesUpdated,
    opportunitiesCreated,
    opportunitiesUpdated,
    discarded,
    companies: companies.map((c) => c.name),
    message: `Sincronización exitosa: ${records.length} procesos consultados de la fuente oficial, ${processesCreated} nuevos, ${opportunitiesCreated} oportunidades creadas, ${discarded} procesos descartados por filtros.`,
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
