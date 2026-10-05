import { db } from '@/lib/db'
import { safeParseMarcoLogico } from '@/lib/ai'
import { parseJsonArray, type MarcoLogico } from '@/lib/types'
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType } from 'docx'

// MÓDULO G — Exportación de la propuesta a Word (.docx) para presentación en SECOP II
// El documento conserva los marcadores [POR CONFIRMAR] y la advertencia anti-invención.

interface SectionLike {
  key: string
  title: string
  content: string
  unconfirmed?: boolean
}

const TH_SHADE = { type: ShadingType.CLEAR, color: 'auto', fill: 'E7F0EA' }

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } })
}

function body(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text })], spacing: { after: 100 } })
}

function bullet(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text })], bullet: { level: 0 }, spacing: { after: 60 } })
}

function contentParagraphs(content: string): Paragraph[] {
  return content
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .map((l) => (l.startsWith('- ') || l.startsWith('• ') ? bullet(l.slice(2)) : body(l)))
}

function mlCell(text: string, opts: { header?: boolean; width?: number } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? TH_SHADE : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.header, size: opts.header ? 20 : 18 })] })],
  })
}

function marcoLogicoTable(ml: MarcoLogico): Table {
  const W = [12, 24, 24, 20, 20]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '9CA3AF' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '9CA3AF' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '9CA3AF' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '9CA3AF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '9CA3AF' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '9CA3AF' },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          mlCell('Nivel', { header: true, width: W[0] }),
          mlCell('Resumen narrativo', { header: true, width: W[1] }),
          mlCell('Indicadores verificables', { header: true, width: W[2] }),
          mlCell('Medios de verificación', { header: true, width: W[3] }),
          mlCell('Supuestos', { header: true, width: W[4] }),
        ],
      }),
      ...ml.filas.map(
        (f) =>
          new TableRow({
            children: [mlCell(f.nivel, { width: W[0] }), mlCell(f.resumen, { width: W[1] }), mlCell(f.indicadores, { width: W[2] }), mlCell(f.mediosVerificacion, { width: W[3] }), mlCell(f.supuestos, { width: W[4] })],
          }),
      ),
    ],
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // NOTA: no se usa safe() porque devuelve JSON; aquí la respuesta es binaria (.docx)
  try {
    const { id } = await params
    const proposal = await db.proposal.findUnique({
      where: { id },
      include: { opportunity: { include: { process: true, company: true } } },
    })
    if (!proposal) return new Response('Propuesta no encontrada', { status: 404 })

    const opp = proposal.opportunity
    const p = opp.process
    const sections = parseJsonArray(proposal.sectionsJson) as unknown as SectionLike[]
    const checklists = parseJsonArray(proposal.checklistsJson) as unknown as { group: string; items: { label: string; required: boolean }[] }[]
    const ml: MarcoLogico | null = safeParseMarcoLogico(proposal.logicFrameworkJson)

    const children: (Paragraph | Table)[] = [
      new Paragraph({ text: opp.company.name, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 60 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Propuesta técnica — Proceso de contratación SECOP II', bold: true, size: 26 })],
        spacing: { after: 240 },
      }),
      body(`Proceso: ${p.id}`),
      body(`Entidad convocante: ${p.entity}`),
      body(`Objeto: ${p.objectName}`),
      body(`Valor base de referencia: ${p.basePrice ? `$${p.basePrice.toLocaleString('es-CO')} COP` : 'no publicado'} (el precio de la propuesta lo define la empresa)`),
      body(`Lugar: ${p.city || 'n/d'} / ${p.department || 'n/d'}  ·  Duración publicada: ${p.duration ? `${p.duration} ${p.durationUnit || ''}` : 'no publicada'}`),
      body(`Versión del borrador: v${proposal.version}  ·  Generada: ${new Date(proposal.createdAt).toLocaleString('es-CO')}`),
      body('Generada por: SECOP Radar — Modo Agente Proyectista (sin datos inventados; marcadores [POR CONFIRMAR] por diligenciar)'),
    ]

    for (const s of sections) {
      children.push(heading(s.title))
      children.push(...contentParagraphs(s.content))
    }

    if (ml) {
      children.push(heading('Anexo — Matriz de Marco Lógico'))
      children.push(body(`Problema central: ${ml.problemaCentral || 'n/d'}`))
      if (ml.causas.length) children.push(body(`Causas: ${ml.causas.join(' · ')}`))
      if (ml.efectos.length) children.push(body(`Efectos: ${ml.efectos.join(' · ')}`))
      children.push(body(`Objetivo central: ${ml.objetivoCentral || 'n/d'}`))
      children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
      children.push(marcoLogicoTable(ml))
    }

    if (checklists.length) {
      children.push(heading('Checklist de presentación'))
      for (const g of checklists) {
        children.push(new Paragraph({ text: g.group, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }))
        for (const it of g.items) children.push(bullet(`${it.required ? '[Obligatorio] ' : ''}${it.label}`))
      }
    }

    children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
    children.push(
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' } },
        children: [new TextRun({ text: 'Nota: este borrador fue generado automáticamente con la información registrada de la empresa. Todo marcador [POR CONFIRMAR] debe diligenciarse antes de la presentación. La presentación en SECOP II se realiza por la empresa y exige aprobación humana explícita.', italics: true, size: 18, color: '6B7280' })],
        spacing: { before: 200 },
      }),
    )

    const doc = new Document({
      creator: 'SECOP Radar — Agente Proyectista',
      title: `Propuesta v${proposal.version} — ${p.objectName.slice(0, 80)}`,
      sections: [{ properties: {}, children }],
    })

    const buf = await Packer.toBuffer(doc)
    const safeName = `${p.id}`.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60)
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="Propuesta_v${proposal.version}_${safeName}.docx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[export]', err)
    return new Response(err instanceof Error ? err.message : 'Error generando el documento', { status: 500 })
  }
}
