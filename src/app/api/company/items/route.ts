import { db } from '@/lib/db'
import { safe, bad } from '@/lib/api'

// Gestión de ítems del perfil de empresa: productos/servicios, experiencia y documentos corporativos
export async function POST(req: Request) {
  return safe(async () => {
    const body = await req.json()
    const companyId = body.companyId as string
    if (!companyId) throw new Error('Falta companyId')

    if (body.kind === 'product') {
      if (!body.name) throw new Error('El nombre del producto/servicio es obligatorio')
      const item = await db.productService.create({
        data: {
          companyId,
          name: String(body.name).trim(),
          description: body.description ?? null,
          category: body.category ?? null,
          keywords: JSON.stringify(Array.isArray(body.keywords) ? body.keywords : []),
        },
      })
      return { item }
    }

    if (body.kind === 'experience') {
      if (!body.title) throw new Error('El título de la experiencia es obligatorio')
      const item = await db.experienceItem.create({
        data: {
          companyId,
          title: String(body.title).trim(),
          entity: body.entity ?? null,
          year: typeof body.year === 'number' ? body.year : null,
          value: typeof body.value === 'number' ? body.value : null,
          description: body.description ?? null,
        },
      })
      return { item }
    }

    if (body.kind === 'document') {
      if (!body.name) throw new Error('El nombre del documento es obligatorio')
      const status = ['DISPONIBLE', 'PENDIENTE', 'VENCIDO'].includes(body.status) ? body.status : 'DISPONIBLE'
      const item = await db.corpDocument.create({
        data: {
          companyId,
          name: String(body.name).trim(),
          docType: body.docType ?? null,
          status,
          notes: body.notes ?? null,
        },
      })
      if (status !== 'DISPONIBLE') {
        await db.notification.create({
          data: {
            type: 'INFO_FALTANTE',
            title: 'Información de la empresa incompleta',
            message: `El documento "${item.name}" está registrado como ${status}. Complétalo para mejorar las evaluaciones de compatibilidad.`,
          },
        })
      }
      return { item }
    }

    throw new Error('Tipo de ítem no soportado')
  })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const id = url.searchParams.get('id')
  if (!kind || !id) return bad('Faltan parámetros kind e id')
  return safe(async () => {
    if (kind === 'product') await db.productService.delete({ where: { id } })
    else if (kind === 'experience') await db.experienceItem.delete({ where: { id } })
    else if (kind === 'document') await db.corpDocument.delete({ where: { id } })
    else throw new Error('Tipo de ítem no soportado')
    return { deleted: true }
  })
}
