// MÓDULO MULTIMODAL — entendimiento de voz, imágenes, video y documentos (pliegos/contratos)
// Backend only. Usa z-ai-web-dev-sdk (ASR + visión) y unpdf (extracción de texto PDF).
// REGLA CRÍTICA: los análisis describen lo que el medio contiene; nunca inventan datos de la empresa.

import ZAI from 'z-ai-web-dev-sdk'

type ZaiClient = Awaited<ReturnType<(typeof import('z-ai-web-dev-sdk'))['default']['create']>>

async function getZai(): Promise<ZaiClient | null> {
  try {
    return await ZAI.create()
  } catch {
    return null
  }
}

// ─── ASR: transcripción de voz / audio ───────────────────────

export async function transcribeAudio(base64: string): Promise<string> {
  const zai = await getZai()
  if (!zai) throw new Error('Motor de transcripción no disponible')
  const res = await zai.audio.asr.create({ file_base64: base64 })
  const text = (res?.text || '').trim()
  if (!text) throw new Error('La transcripción llegó vacía (¿audio sin voz?)')
  return text
}

// ─── Visión: análisis de imágenes ────────────────────────────

export const DEFAULT_IMAGE_PROMPT =
  'Analiza esta imagen en contexto de contratación pública colombiana. Si es una foto o escaneo de un documento (contrato, pliego, factura, certificación, oficio), extrae: tipo de documento, entidad/empresa relacionada, fechas visibles, valores visibles, firmas o sellos visibles y cualquier requisito o cláusula relevante. Si es otra cosa, descríbela con precisión. Responde en español colombiano, conciso.'

export async function analyzeImage(base64: string, prompt: string = DEFAULT_IMAGE_PROMPT): Promise<string> {
  const zai = await getZai()
  if (!zai) throw new Error('Motor de visión no disponible')
  const dataUrl = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`
  // El shape multimodal es válido en runtime; el tipado del SDK es estricto con las uniones
  const params = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  } as Parameters<typeof zai.chat.completions.createVision>[0]
  const res = await zai.chat.completions.createVision(params)
  const content = res?.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('El análisis de imagen llegó vacío')
  return content
}

// ─── Visión: análisis de video ───────────────────────────────

export const DEFAULT_VIDEO_PROMPT =
  'Analiza este video en contexto de contratación pública colombiana. Resume: contenido general, eventos en orden, cualquier texto visible relevante (documentos, pantallas, obras, equipos) y conclusiones útiles para una empresa que participa en procesos SECOP II. Responde en español colombiano, conciso.'

export async function analyzeVideo(base64OrUrl: string, prompt: string = DEFAULT_VIDEO_PROMPT): Promise<string> {
  const zai = await getZai()
  if (!zai) throw new Error('Motor de visión no disponible')
  const url = base64OrUrl.startsWith('data:') || base64OrUrl.startsWith('http') ? base64OrUrl : `data:video/mp4;base64,${base64OrUrl}`
  const params = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'video_url', video_url: { url } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  } as Parameters<typeof zai.chat.completions.createVision>[0]
  const res = await zai.chat.completions.createVision(params)
  const content = res?.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('El análisis de video llegó vacío')
  return content
}

// ─── PDF: extracción de texto (pliegos, actas, contratos) ────

export async function extractPdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text, totalPages } = await extractText(pdf, { mergePages: true })
  const merged = Array.isArray(text) ? text.join('\n\n') : String(text || '')
  const clean = merged.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim()
  if (!clean || clean.length < 40) {
    throw new Error('El PDF no contiene texto extraíble (probablemente es un escaneo de imágenes). Usa fotos de las páginas relevantes para el análisis visual.')
  }
  return { text: clean, pages: totalPages }
}

// ─── Análisis de pliegos y documentos ────────────────────────

export interface PliegoAnalysis {
  tipoDocumento: string
  objeto?: string
  entidad?: string
  valores?: string
  plazos?: string
  requisitosHabilitantes: string[]
  garantias?: string
  criteriosEvaluacion: string[]
  exigeMarcoLogico: boolean
  alertas: string[]
  resumen: string
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export async function analyzePliegoText(text: string): Promise<PliegoAnalysis> {
  const zai = await getZai()
  const fallback: PliegoAnalysis = {
    tipoDocumento: 'Documento de proceso de contratación',
    requisitosHabilitantes: ['[POR CONFIRMAR: revisar el documento original]'],
    criteriosEvaluacion: [],
    exigeMarcoLogico: /marco\s+l[óo]gico/i.test(text),
    alertas: ['Análisis generado sin motor IA — validar directamente en el documento'],
    resumen: truncate(text.replace(/\s+/g, ' '), 400),
  }
  if (!zai) return fallback

  try {
    const system = `Eres un analista experto en pliegos y documentos de contratación pública colombiana (SECOP II).
Analizas el texto de un documento (pliego de condiciones, términos de referencia, contrato, acta, oficio) y extraes la información clave para una empresa que quiere participar.

REGLAS: extrae SOLO lo que aparece en el texto. Si un dato no está, escribe "no consta en el documento". No inventes valores, fechas ni requisitos.

Devuelve EXCLUSIVAMENTE JSON válido:
{
  "tipoDocumento": "tipo de documento (p. ej. Pliego de condiciones)",
  "objeto": "objeto del proceso o del contrato",
  "entidad": "entidad o empresa que convoca",
  "valores": "valores/presupuesto mencionados",
  "plazos": "plazos de ejecución y fechas límite relevantes",
  "requisitosHabilitantes": ["requisito 1", "..."],
  "garantias": "garantías exigidas",
  "criteriosEvaluacion": ["criterio 1", "..."],
  "exigeMarcoLogico": false,
  "alertas": ["alerta o riesgo 1", "..."],
  "resumen": "resumen ejecutivo del documento en 2-4 frases"
}
Marca exigeMarcoLogico=true si el documento exige o menciona marco lógico, árbol de problemas o matriz MEL/MML.`

    const res = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `DOCUMENTO (puede estar truncado):\n\n${text.slice(0, 60000)}` },
      ],
      thinking: { type: 'disabled' },
      temperature: 0.2,
    })
    const raw = res?.choices?.[0]?.message?.content ?? ''
    const candidate = raw
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) return fallback
    // extractJson (con reparador de caracteres de control) se comparte con ai.ts
    const { extractJson } = await import('./ai')
    const parsed = extractJson(candidate)
    if (!parsed) return fallback
    return {
      tipoDocumento: String(parsed.tipoDocumento || fallback.tipoDocumento).slice(0, 200),
      objeto: parsed.objeto ? String(parsed.objeto).slice(0, 600) : undefined,
      entidad: parsed.entidad ? String(parsed.entidad).slice(0, 300) : undefined,
      valores: parsed.valores ? String(parsed.valores).slice(0, 300) : undefined,
      plazos: parsed.plazos ? String(parsed.plazos).slice(0, 400) : undefined,
      requisitosHabilitantes: Array.isArray(parsed.requisitosHabilitantes) ? parsed.requisitosHabilitantes.map(String).slice(0, 15) : [],
      garantias: parsed.garantias ? String(parsed.garantias).slice(0, 400) : undefined,
      criteriosEvaluacion: Array.isArray(parsed.criteriosEvaluacion) ? parsed.criteriosEvaluacion.map(String).slice(0, 12) : [],
      exigeMarcoLogico: Boolean(parsed.exigeMarcoLogico),
      alertas: Array.isArray(parsed.alertas) ? parsed.alertas.map(String).slice(0, 10) : [],
      resumen: String(parsed.resumen || fallback.resumen).slice(0, 1200),
    }
  } catch {
    return fallback
  }
}

/** Detecta el tipo de análisis por MIME type. */
export function classifyMime(mime: string): 'AUDIO' | 'VOZ' | 'IMAGEN' | 'VIDEO' | 'DOCUMENTO' | null {
  if (mime.startsWith('audio/')) return 'AUDIO'
  if (mime.startsWith('image/')) return 'IMAGEN'
  if (mime.startsWith('video/')) return 'VIDEO'
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'DOCUMENTO'
  return null
}
