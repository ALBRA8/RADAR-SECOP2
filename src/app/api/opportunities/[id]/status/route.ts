import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'
import { recomputeRanking } from '@/lib/sync'

const VALID = ['NUEVA', 'EN_ANALISIS', 'COMPATIBLE', 'APROBADA_PREPARACION', 'DESCARTADA']

// Cambio de estado — descartar exige motivo (sección 7 de la especificación)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const status = body.status as string
  if (!VALID.includes(status)) return bad('Estado no válido')
  if (status === 'DESCARTADA' && !body.reason) return bad('Para descartar se requiere el motivo')

  return safe(async () => {
    const opp = await db.opportunity.findUnique({ where: { id }, include: { process: true } })
    if (!opp) throw new Error('Oportunidad no encontrada')

    const updated = await db.opportunity.update({
      where: { id },
      data: {
        status,
        discardReason: status === 'DESCARTADA' ? String(body.reason) : null,
      },
      include: { process: true },
    })

    await db.auditEvent.create({
      data: {
        action: `CAMBIO_ESTADO_${status}`,
        entityType: 'Opportunity',
        entityId: id,
        detail: status === 'DESCARTADA' ? `Descartada: ${body.reason}` : `Estado cambiado a ${status}`,
      },
    })

    if (status === 'APROBADA_PREPARACION') {
      await db.notification.create({
        data: {
          type: 'SISTEMA',
          title: 'Oportunidad aprobada para preparación',
          message: `El proceso ${opp.process.id} pasó a preparación de propuesta. Puedes generar el borrador desde el detalle.`,
          opportunityId: id,
        },
      })
    }

    await recomputeRanking([opp.companyId])
    return { opportunity: updated }
  })
}
