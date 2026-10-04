import { db } from '@/lib/db'
import { safe } from '@/lib/api'

export async function GET() {
  return safe(async () => {
    let company = await db.company.findFirst({
      include: { products: true, experiences: true, documents: true },
      orderBy: { createdAt: 'asc' },
    })
    return { company }
  })
}

export async function PUT(req: Request) {
  return safe(async () => {
    const body = await req.json()
    const id = body.id as string
    if (!id) throw new Error('Falta el id de la empresa')
    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if ('nit' in body) data.nit = body.nit
    if ('description' in body) data.description = body.description
    if ('city' in body) data.city = body.city
    if ('department' in body) data.department = body.department
    if (typeof body.minBudget === 'number') data.minBudget = body.minBudget
    if (typeof body.maxBudget === 'number') data.maxBudget = body.maxBudget
    if (Array.isArray(body.departmentsAllowed)) data.departmentsAllowed = JSON.stringify(body.departmentsAllowed)
    if (Array.isArray(body.modalitiesAllowed)) data.modalitiesAllowed = JSON.stringify(body.modalitiesAllowed)
    if (Array.isArray(body.contractTypesAllowed)) data.contractTypesAllowed = JSON.stringify(body.contractTypesAllowed)
    if (Array.isArray(body.phasesAllowed)) data.phasesAllowed = JSON.stringify(body.phasesAllowed)
    if (typeof body.requireKeywordHit === 'boolean') data.requireKeywordHit = body.requireKeywordHit
    if ('capacity' in body) data.capacity = body.capacity
    if ('approverName' in body) data.approverName = body.approverName

    const company = await db.company.update({ where: { id }, data })
    await db.auditEvent.create({
      data: { action: 'ACTUALIZAR_EMPRESA', entityType: 'Company', entityId: id, detail: `Perfil actualizado: ${Object.keys(data).join(', ')}` },
    })
    return { company }
  })
}

export async function POST(req: Request) {
  return safe(async () => {
    const body = await req.json()
    if (!body.name || typeof body.name !== 'string') throw new Error('El nombre de la empresa es obligatorio')
    const count = await db.company.count()
    if (count >= 3) throw new Error('El MVP permite máximo 3 empresas registradas')
    const company = await db.company.create({
      data: {
        name: body.name.trim(),
        nit: body.nit ?? null,
        description: body.description ?? null,
        city: body.city ?? null,
        department: body.department ?? null,
        minBudget: typeof body.minBudget === 'number' ? body.minBudget : 5000000,
        maxBudget: typeof body.maxBudget === 'number' ? body.maxBudget : 20000000,
        departmentsAllowed: JSON.stringify(body.departmentsAllowed ?? []),
        modalitiesAllowed: JSON.stringify(body.modalitiesAllowed ?? []),
        contractTypesAllowed: JSON.stringify(body.contractTypesAllowed ?? []),
        phasesAllowed: JSON.stringify(body.phasesAllowed ?? ['Presentación de oferta', 'Selección']),
        requireKeywordHit: Boolean(body.requireKeywordHit),
        capacity: body.capacity ?? null,
        approverName: body.approverName ?? null,
      },
      include: { products: true, experiences: true, documents: true },
    })
    await db.auditEvent.create({
      data: { action: 'CREAR_EMPRESA', entityType: 'Company', entityId: company.id, detail: `Empresa creada: ${company.name}` },
    })
    return { company }
  })
}
