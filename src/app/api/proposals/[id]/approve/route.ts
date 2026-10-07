import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'
import { withExecution } from '@/lib/observe'
import { NextResponse } from 'next/server'

// MÓDULO H — Aprobación explícita con trazabilidad
// §19 REGLA DE ORO: no se puede aprobar una propuesta con requisitos
// OBLIGATORIOS marcados CUMPLE sin verificación (truthLevel INFERRED /
// ESTIMATED / UNKNOWN), salvo force=true con notas obligatorias
// (queda auditado como APPROVAL_FORZADA).

const UNVERIFIED_LEVELS = ['INFERRED', 'ESTIMATED', 'UNKNOWN']

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const decision = body.decision as string
  const approver = (body.approver as string) || ''
  const force = body.force === true
  const notes = (body.notes as string) || ''
  if (!['APROBADA', 'RECHAZADA'].includes(decision)) return bad('Decisión no válida')
  if (!approver.trim()) return bad('Se requiere el nombre del aprobador')
  if (force && decision === 'APROBADA' && !notes.trim()) return bad('Aprobación forzada (force=true) exige notes con la justificación', 422)

  return safe(async () => {
    const proposal = await db.proposal.findUnique({
      where: { id },
      include: { opportunity: { include: { process: true, requirements: true } } },
    })
    if (!proposal) throw new Error('Propuesta no encontrada')
    if (proposal.status === 'APROBADA' && decision === 'APROBADA') throw new Error('La propuesta ya está aprobada')

    // ── REGLA DE ORO §19 ──────────────────────────────────────
    let forced = false
    if (decision === 'APROBADA') {
      const violations = proposal.opportunity.requirements
        .filter((r) => r.obligatoriness === 'OBLIGATORIO' && r.status === 'CUMPLE' && UNVERIFIED_LEVELS.includes(r.truthLevel ?? 'UNKNOWN'))
        .map((r) => ({ code: r.code, description: r.description, status: r.status, truthLevel: r.truthLevel ?? 'UNKNOWN' }))

      if (violations.length > 0) {
        if (!force) {
          await db.auditEvent.create({
            data: {
              action: 'APROBACION_BLOQUEADA',
              entityType: 'Proposal',
              entityId: id,
              detail: `Regla de oro §19: ${violations.length} requisito(s) OBLIGATORIO en CUMPLE sin verificación (${violations.map((v) => `${v.code}:${v.truthLevel}`).join(', ')}). Aprobación rechazada; use force=true con notes para saltarla (queda auditada).`,
              status: 'PARTIAL',
            },
          })
          return NextResponse.json(
            {
              error: 'Regla de oro §19: no se puede aprobar con requisitos OBLIGATORIOS marcados CUMPLE sin verificación directa.',
              violaciones: violations,
              comoForzar: 'Reenvíe con force=true y notes obligatorias (la aprobación queda auditada como APPROVAL_FORZADA).',
            },
            { status: 422 },
          )
        }
        forced = true
      }
    }

    // ── Snapshot de trazabilidad (§19): qué se aprobó exactamente ──
    const snapshot = {
      requirements: proposal.opportunity.requirements.map((r) => ({ code: r.code, status: r.status, truthLevel: r.truthLevel ?? 'UNKNOWN' })),
      score: proposal.opportunity.score,
      unconfirmedCount: proposal.unconfirmedCount,
    }

    const { result, executionId } = await withExecution(
      'APPROVE_PROPOSAL',
      {
        autonomyLevel: 'L2_EXECUTE_SAFE',
        inputs: { proposalId: id, decision, force: forced, approver: approver.trim() },
        tools: ['db'],
      },
      async ({ executionId }) => {
        const updated = await db.proposal.update({
          where: { id },
          data: {
            status: decision === 'APROBADA' ? 'APROBADA' : 'BORRADOR',
            approvedBy: decision === 'APROBADA' ? approver.trim() : null,
            approvedAt: decision === 'APROBADA' ? new Date() : null,
          },
        })

        await db.approval.create({
          data: {
            proposalId: id,
            decision,
            approver: approver.trim(),
            notes: notes || null,
            version: proposal.version,
            unconfirmedCount: proposal.unconfirmedCount,
            snapshotJson: JSON.stringify(snapshot),
            executionId,
          },
        })

        await db.auditEvent.create({
          data: {
            action: forced ? 'APPROVAL_FORZADA' : `PROPUESTA_${decision}`,
            entityType: 'Proposal',
            entityId: id,
            detail: `${forced ? '[FORZADA] ' : ''}Versión ${proposal.version} del proceso ${proposal.opportunity.process.id} — aprobador: ${approver.trim()}${notes ? ` — notas: ${notes}` : ''}${forced ? ` — ${snapshot.requirements.length} requisito(s) en snapshot` : ''}`,
            executionId,
          },
        })

        await db.notification.create({
          data: {
            type: 'SISTEMA',
            title: decision === 'APROBADA' ? (forced ? 'Propuesta aprobada (forzada)' : 'Propuesta aprobada') : 'Propuesta rechazada para ajustes',
            message:
              decision === 'APROBADA'
                ? `La versión ${proposal.version} para el proceso ${proposal.opportunity.process.id} fue aprobada por ${approver.trim()}${forced ? ' FORZANDO la regla de oro §19 (ver notas de auditoría)' : ''}. El paquete queda listo para revisión final y presentación (manual en el MVP).`
                : `La versión ${proposal.version} del proceso ${proposal.opportunity.process.id} fue devuelta para ajustes.`,
            opportunityId: proposal.opportunityId,
          },
        })

        return { proposal: updated }
      },
    )

    // Aditivo: snapshot + executionId para trazabilidad completa (§19/§25).
    return { ...result, executionId, snapshot }
  })
}
