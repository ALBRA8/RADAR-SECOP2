import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'

// MÓDULO H — Aprobación explícita con trazabilidad
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const decision = body.decision as string
  const approver = (body.approver as string) || ''
  if (!['APROBADA', 'RECHAZADA'].includes(decision)) return bad('Decisión no válida')
  if (!approver.trim()) return bad('Se requiere el nombre del aprobador')

  return safe(async () => {
    const proposal = await db.proposal.findUnique({ where: { id }, include: { opportunity: { include: { process: true } } } })
    if (!proposal) throw new Error('Propuesta no encontrada')
    if (proposal.status === 'APROBADA' && decision === 'APROBADA') throw new Error('La propuesta ya está aprobada')

    const updated = await db.proposal.update({
      where: { id },
      data: {
        status: decision === 'APROBADA' ? 'APROBADA' : 'BORRADOR',
        approvedBy: decision === 'APROBADA' ? approver.trim() : null,
        approvedAt: decision === 'APROBADA' ? new Date() : null,
      },
    })

    await db.approval.create({
      data: { proposalId: id, decision, approver: approver.trim(), notes: body.notes ?? null },
    })

    await db.auditEvent.create({
      data: {
        action: `PROPUESTA_${decision}`,
        entityType: 'Proposal',
        entityId: id,
        detail: `Versión ${proposal.version} del proceso ${proposal.opportunity.process.id} — aprobador: ${approver.trim()}${body.notes ? ` — notas: ${body.notes}` : ''}`,
      },
    })

    await db.notification.create({
      data: {
        type: 'SISTEMA',
        title: decision === 'APROBADA' ? 'Propuesta aprobada' : 'Propuesta rechazada para ajustes',
        message:
          decision === 'APROBADA'
            ? `La versión ${proposal.version} para el proceso ${proposal.opportunity.process.id} fue aprobada por ${approver.trim()}. El paquete queda listo para revisión final y presentación (manual en el MVP).`
            : `La versión ${proposal.version} del proceso ${proposal.opportunity.process.id} fue devuelta para ajustes.`,
        opportunityId: proposal.opportunityId,
      },
    })

    return { proposal: updated }
  })
}
