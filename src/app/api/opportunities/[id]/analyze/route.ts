import { db } from '@/lib/db'
import { safe } from '@/lib/api'
import { analyzeOpportunity } from '@/lib/ai'
import { recomputeRanking } from '@/lib/sync'
import { parseJsonArray, type CompanyConfigData, type DocumentData, type ExperienceData, type ProductItemData } from '@/lib/types'
import { buildProvenance, clampConfidence, createEvidenceRow, normalizeTruthLevel } from '@/lib/evidence'

// MÓDULO D — Análisis inteligente de la oportunidad (IA con motor de reglas de respaldo)
// Task 2-a: cada requisito deja fila Evidence (contrato de evidencia) y la ejecución
// completa queda trazada en Execution (operation ANALYZE_OPPORTUNITY).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return safe(async () => {
    const { id } = await params
    const startedAt = Date.now()
    const startedIso = new Date().toISOString()

    // Fila Execution que envuelve toda la operación (observabilidad PROMPT 05 §25).
    const execution = await db.execution.create({
      data: {
        operation: 'ANALYZE_OPPORTUNITY',
        autonomyLevel: 'L2_EXECUTE_SAFE',
        status: 'RUNNING',
        inputsJson: JSON.stringify({ opportunityId: id }),
      },
    })
    const failExecution = async (status: 'FAILED' | 'PARTIAL', err?: unknown) => {
      await db.execution
        .update({
          where: { id: execution.id },
          data: {
            status,
            latencyMs: Date.now() - startedAt,
            errorsJson: err ? JSON.stringify([err instanceof Error ? err.message : String(err)]) : null,
          },
        })
        .catch(() => undefined)
    }

    try {
      const opp = await db.opportunity.findUnique({ where: { id }, include: { process: true, company: { include: { products: true, experiences: true, documents: true } } } })
      if (!opp) throw new Error('Oportunidad no encontrada')
      if (opp.status === 'DESCARTADA') throw new Error('La oportunidad está descartada')

      await db.opportunity.update({ where: { id }, data: { status: 'EN_ANALISIS' } })

      const company = opp.company
      const bundle = {
        company: {
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
          phasesAllowed: parseJsonArray(company.phasesAllowed),
          requireKeywordHit: company.requireKeywordHit,
          capacity: company.capacity,
          approverName: company.approverName,
        } as CompanyConfigData,
        products: company.products.map((p) => ({ id: p.id, name: p.name, description: p.description, category: p.category, keywords: parseJsonArray(p.keywords) })) as ProductItemData[],
        experiences: company.experiences.map((e) => ({ id: e.id, title: e.title, entity: e.entity, year: e.year, value: e.value, description: e.description })) as ExperienceData[],
        documents: company.documents.map((d) => ({ id: d.id, name: d.name, docType: d.docType, status: d.status, notes: d.notes })) as DocumentData[],
      }

      const analysis = await analyzeOpportunity(opp.process, bundle)

      // Reemplaza la matriz de requisitos con el nuevo análisis
      await db.requirement.deleteMany({ where: { opportunityId: id } })
      await db.requirement.createMany({
        data: analysis.requirements.map((r) => {
          const due = r.dueDate && !Number.isNaN(Date.parse(r.dueDate)) ? new Date(r.dueDate) : null
          return {
            opportunityId: id,
            code: r.code,
            description: r.description,
            category: r.category ?? null,
            obligatoriness: r.obligatoriness ?? 'DESCONOCIDO',
            dueDate: due,
            status: r.status,
            truthLevel: normalizeTruthLevel(r.truthLevel),
            confidence: clampConfidence(r.confidence),
            evidence: r.evidence ?? null,
            action: r.action ?? null,
            source: r.source ?? 'IA',
          }
        }),
      })

      // ── EVIDENCE CONTRACT (Task 2-a): una fila Evidence por requisito ──
      const savedReqs = await db.requirement.findMany({ where: { opportunityId: id }, orderBy: { code: 'asc' } })
      const byCode = new Map(savedReqs.map((rq) => [rq.code, rq]))
      const evidences: Awaited<ReturnType<typeof createEvidenceRow>>[] = []
      for (const r of analysis.requirements) {
        const saved = byCode.get(r.code)
        if (!saved) continue
        const esRegla = (r.source ?? 'IA') === 'REGLA'
        const evText = (r.evidence ?? '').trim()
        evidences.push(
          await createEvidenceRow({
            source: esRegla ? 'SECOP_API' : 'IA_INFERENCIA',
            sourceType: esRegla ? 'API' : 'INFERRED',
            sourceUrl: esRegla ? (opp.process.url ?? null) : null,
            timestamp: esRegla ? (opp.process.lastPubDate ?? opp.process.publishDate ?? null) : null,
            extractedFact: evText || `Requisito ${r.code}: ${r.description} — sin evidencia registrada`,
            context: `Requisito ${r.code} (${r.category ?? 'SIN_CATEGORIA'}/${r.obligatoriness ?? 'DESCONOCIDO'}) del proceso ${opp.process.id} — motor ${analysis.engine}`,
            confidence: clampConfidence(r.confidence),
            truthLevel: r.truthLevel ?? (esRegla ? 'OBSERVED' : 'INFERRED'),
            provenanceJson: buildProvenance({
              method: esRegla ? 'SECOP_API_FIELD_DERIVATION' : 'IA_PROMPT_ANALYSIS',
              engine: analysis.engine,
              extractor: 'RADAR-SECOP2',
              startedAt: startedIso,
              requirementCode: r.code,
              opportunityId: id,
            }),
            relatedRequirementId: saved.id,
            relatedOpportunityId: id,
          }),
        )
      }

      const unmet = analysis.requirements.filter((r) => r.status === 'NO_CUMPLE')
      const updated = await db.opportunity.update({
        where: { id },
        data: {
          status: 'COMPATIBLE',
          analysisSummary: analysis.summary,
          nextAction: analysis.nextAction,
          risksJson: JSON.stringify([...analysis.risks]),
          missingDocsJson: JSON.stringify([...analysis.missingDocs]),
          // Un requisito habilitante NO cumplido reduce la compatibilidad, pero no descarta
          // automáticamente: la decisión final es del humano (MÓDULO H).
          score: unmet.length > 0 ? Math.max(5, opp.score - unmet.length * 8) : opp.score,
        },
        include: { requirements: { orderBy: { code: 'asc' } } },
      })

      if (unmet.length > 0) {
        await db.notification.create({
          data: {
            type: 'REQUISITO_CRITICO',
            title: `Requisitos no cumplidos en ${opp.process.id}`,
            message: `${unmet.length} requisito(s) marcado(s) como NO_CUMPLE: ${unmet.map((r) => r.description).slice(0, 2).join(' | ')}.`,
            opportunityId: id,
          },
        })
      }

      await db.auditEvent.create({
        data: { action: 'ANALIZAR_OPORTUNIDAD', entityType: 'Opportunity', entityId: id, detail: `Análisis con motor ${analysis.engine}: ${analysis.requirements.length} requisitos evaluados, ${evidences.length} evidencias registradas` },
      })

      await recomputeRanking([company.id])

      await db.execution.update({
        where: { id: execution.id },
        data: {
          status: 'SUCCESS',
          latencyMs: Date.now() - startedAt,
          outputsJson: JSON.stringify({ requirements: analysis.requirements.length, evidences: evidences.length }),
          evidenceIdsJson: JSON.stringify(evidences.map((e) => e.id)),
          providersJson: JSON.stringify([{ provider: analysis.engine === 'IA' ? 'z-ai-web-dev-sdk' : 'RULE_ENGINE', ok: true }]),
        },
      })

      // Respuesta compatible con la previa + campos aditivos (evidences count, executionId).
      return { opportunity: updated, analysisEngine: analysis.engine, analysis, evidences: evidences.length, executionId: execution.id }
    } catch (err) {
      await failExecution(err instanceof Error ? 'FAILED' : 'PARTIAL', err)
      throw err
    }
  })
}
