'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Spinner } from './shared'
import { fmtDateTime } from './client-types'
import { useToast } from '@/hooks/use-toast'
import {
  MessageSquare, SendHorizontal, RefreshCw, Mic, Square, Upload, ImageIcon, Video,
  FileText, Music, MessageCircle, Trash2, KeyRound, CheckCircle2, XCircle, Copy, Radio,
} from 'lucide-react'

/** Parse tolerante para análisis estructurados (evita crash del render si llega JSON roto). */
function parseAnalysisSafe(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw || !raw.trim().startsWith('{')) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

// ─── Tipos locales ──────────────────────────────────────────

interface ChannelConfigData {
  channel: string
  token: string // enmascarado
  hasToken: boolean
  phoneNumberId?: string | null
  verifyToken?: string | null
  botUsername?: string | null
  enabled: boolean
  lastOffset?: string | null
  lastCheckAt?: string | null
}

interface ChannelMessageData {
  id: string
  channel: string
  chatId: string
  chatName?: string | null
  direction: 'ENTRANTE' | 'SALIENTE'
  type: string
  text?: string | null
  mediaPath?: string | null
  mimeType?: string | null
  transcript?: string | null
  analysis?: string | null
  status: string
  error?: string | null
  createdAt: string
}

const TYPE_ICONS: Record<string, typeof MessageSquare> = {
  TEXTO: MessageSquare,
  VOZ: Mic,
  AUDIO: Music,
  IMAGEN: ImageIcon,
  VIDEO: Video,
  DOCUMENTO: FileText,
  SISTEMA: Radio,
}

const CHANNEL_BADGES: Record<string, string> = {
  TELEGRAM: 'bg-teal-100 text-teal-800 border-teal-200',
  WHATSAPP: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  WEB: 'bg-stone-100 text-stone-700 border-stone-200',
}

export function ChannelsView() {
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [telegram, setTelegram] = useState<ChannelConfigData | null>(null)
  const [whatsapp, setWhatsapp] = useState<ChannelConfigData | null>(null)
  const [messages, setMessages] = useState<ChannelMessageData[]>([])

  // Formularios de configuración
  const [tgToken, setTgToken] = useState('')
  const [waToken, setWaToken] = useState('')
  const [waPhoneId, setWaPhoneId] = useState('')
  const [waVerify, setWaVerify] = useState('')
  const [savingTg, setSavingTg] = useState(false)
  const [savingWa, setSavingWa] = useState(false)
  const [polling, setPolling] = useState(false)
  const [tgChatId, setTgChatId] = useState('')

  // Analizador multimodal
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState('')
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/channels/config')
      const data = await res.json()
      setTelegram(data.telegram || null)
      setWhatsapp(data.whatsapp || null)
    } catch {
      toast({ title: 'No se pudo cargar la configuración de canales', description: 'Revisa tu conexión e intenta de nuevo.', variant: 'destructive' })
    }
  }, [])

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/channels/messages?limit=60')
      const data = await res.json()
      setMessages(data.messages || [])
    } catch {
      toast({ title: 'No se pudo cargar la bandeja', description: 'Pulsa «Actualizar» para reintentar.', variant: 'destructive' })
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadConfig(), loadMessages()]).finally(() => setLoading(false))
  }, [loadConfig, loadMessages])

  // ─── Acciones ─────────────────────────────────────────────

  const saveTelegram = async () => {
    setSavingTg(true)
    try {
      const res = await fetch('/api/channels/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'TELEGRAM', token: tgToken.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar')
      setTelegram(data.config)
      if (data.botInfo?.valid) {
        toast({ title: 'Telegram configurado ✅', description: `Bot @${data.botInfo.username} validado contra la API. El poller ya puede leer mensajes.` })
      } else if (data.botInfo && data.botInfo.error) {
        toast({ title: 'Token guardado, pero la API lo rechazó', description: data.botInfo.error, variant: 'destructive' })
      } else {
        toast({ title: 'Configuración guardada' })
      }
      setTgToken('')
      loadConfig()
    } catch (e) {
      toast({ title: 'Error guardando Telegram', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSavingTg(false)
    }
  }

  const saveWhatsapp = async () => {
    setSavingWa(true)
    try {
      const res = await fetch('/api/channels/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'WHATSAPP',
          token: waToken.trim() || undefined,
          phoneNumberId: waPhoneId.trim(),
          verifyToken: waVerify.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar')
      setWhatsapp(data.config)
      toast({ title: 'WhatsApp configurado', description: 'Copia la URL del webhook en el panel de Meta para activar el canal.' })
      setWaToken('')
      loadConfig()
    } catch (e) {
      toast({ title: 'Error guardando WhatsApp', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSavingWa(false)
    }
  }

  const pollNow = async () => {
    setPolling(true)
    try {
      const res = await fetch('/api/channels/telegram/poll?timeout=0', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Polling falló')
      if (!data.configured) {
        toast({ title: 'Telegram aún no está configurado', description: 'Crea el bot con @BotFather y guarda el token.' })
      } else {
        toast({ title: 'Verificación hecha', description: data.processed > 0 ? `${data.processed} mensaje(s) procesado(s)` : 'Sin mensajes nuevos pendientes.' })
      }
      loadMessages()
      loadConfig()
    } catch (e) {
      toast({ title: 'Polling falló', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setPolling(false)
    }
  }

  const sendTest = async () => {
    try {
      const res = await fetch('/api/channels/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'TELEGRAM', chatId: tgChatId.trim(), text: '✅ Prueba del Agente SECOP Radar: conectado y respondiendo.' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Envío falló')
      toast({ title: 'Mensaje de prueba enviado', description: 'Revisa el chat destino.' })
      loadMessages()
    } catch (e) {
      toast({ title: 'No se pudo enviar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const clearInbox = async () => {
    try {
      await fetch('/api/channels/messages', { method: 'DELETE' })
      toast({ title: 'Bandeja limpiada' })
      loadMessages()
    } catch {
      toast({ title: 'No se pudo limpiar la bandeja', variant: 'destructive' })
    }
  }

  const uploadFile = async (file: File, noteText?: string) => {
    setUploading(true)
    setLastResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (noteText || note.trim()) form.append('note', noteText || note.trim())
      const res = await fetch('/api/media/analyze', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'El análisis falló')
      setLastResult(data.reply)
      toast({ title: `Análisis listo (${data.type})`, description: `${data.fileName} · ${(data.sizeBytes / 1024).toFixed(0)} KB` })
      loadMessages()
    } catch (e) {
      toast({ title: 'No se pudo analizar el archivo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  // Limpieza al desmontar: libera micrófono y detiene grabación pendiente
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.onstop = null
        recorderRef.current.stop()
        recorderRef.current = null
      }
    }
  }, [])

  // Grabación de notas de voz desde el navegador
  const startRecording = async () => {
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop())
        const mimeType = mr.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm'
        const file = new File([blob], `nota_voz_${Date.now()}.${ext}`, { type: mimeType })
        uploadFile(file, 'Nota de voz grabada desde el panel')
      }
      mr.start()
      recorderRef.current = mr
      setRecording(true)
    } catch {
      stream?.getTracks().forEach((t) => t.stop())
      toast({ title: 'No se pudo acceder al micrófono', description: 'Revisa los permisos del navegador.', variant: 'destructive' })
    }
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  const copyWebhook = async () => {
    const url = `${window.location.origin}/api/channels/whatsapp/webhook`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'URL copiada', description: url })
    } catch {
      toast({ title: 'Copia manualmente', description: url })
    }
  }

  // ─── Render ───────────────────────────────────────────────

  if (loading) return <Spinner label="Cargando canales…" />

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-emerald-600" aria-hidden /> Habla con el agente
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Conecta Telegram o WhatsApp para enviarle texto, notas de voz, fotos de pliegos o contratos, videos y PDFs. El agente entiende todos estos formatos y responde en el mismo chat.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Telegram */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <SendHorizontal className="w-4 h-4 text-teal-600" aria-hidden /> Telegram
              </span>
              <Badge className={telegram?.hasToken ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-stone-100 text-stone-600 border-stone-200'}>
                {telegram?.hasToken ? 'Configurado' : 'Sin token'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-0.5">
              <li>Habla con <strong>@BotFather</strong> en Telegram y crea un bot (<em>/newbot</em>).</li>
              <li>Copia el token y guárdalo aquí.</li>
              <li>Escríbele al bot: texto, voz, fotos de contratos, PDFs de pliegos o videos.</li>
            </ol>
            <div className="space-y-1.5">
              <Label htmlFor="tg-token">Token del bot {telegram?.hasToken && `(actual: ${telegram.token})`}</Label>
              <Input id="tg-token" value={tgToken} onChange={(e) => setTgToken(e.target.value)} placeholder="123456789:AAE…ejemplo-de-token" type="password" className="min-h-11" autoComplete="off" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveTelegram} disabled={savingTg} className="bg-emerald-600 hover:bg-emerald-700 min-h-11">
                <KeyRound className="w-4 h-4 mr-1.5" aria-hidden /> {savingTg ? 'Validando…' : 'Guardar y validar'}
              </Button>
              <Button variant="outline" onClick={pollNow} disabled={polling} className="min-h-11">
                <RefreshCw className={`w-4 h-4 mr-1.5 ${polling ? 'animate-spin' : ''}`} aria-hidden /> Verificar mensajes
              </Button>
            </div>
            {telegram?.hasToken && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="flex items-center gap-1.5">
                  {telegram.botUsername ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-amber-600" />}
                  Bot: {telegram.botUsername ? `@${telegram.botUsername}` : 'por validar'}
                  {telegram.lastCheckAt ? ` · último sondeo: ${fmtDateTime(telegram.lastCheckAt)}` : ''}
                </p>
                <div className="flex gap-1.5 pt-1">
                  <Input value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder="Chat ID de prueba (p. ej. tu chat con el bot)" aria-label="Chat ID de Telegram para el envío de prueba" className="h-9 text-xs" />
                  <Button size="sm" variant="outline" onClick={sendTest} className="h-9 shrink-0">Probar envío</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* WhatsApp */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-600" aria-hidden /> WhatsApp (Meta Cloud API)
              </span>
              <Badge className={whatsapp?.hasToken ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-stone-100 text-stone-600 border-stone-200'}>
                {whatsapp?.hasToken ? 'Configurado' : 'Sin token'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-0.5">
              <li>Crea una app en <strong>developers.facebook.com</strong> con producto WhatsApp.</li>
              <li>Consigue el token permanente y el <em>phone_number_id</em>.</li>
              <li>Registra esta URL como webhook en Meta (verificación GET incluida).</li>
            </ol>
            <div className="flex items-center gap-1.5 rounded border bg-muted/40 px-2.5 py-2 text-xs break-all">
              <span className="font-mono flex-1 min-w-0">/api/channels/whatsapp/webhook</span>
              <Button size="sm" variant="ghost" onClick={copyWebhook} className="h-7 px-2 shrink-0" aria-label="Copiar URL del webhook">
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="grid gap-2">
              <Input value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="Token permanente de acceso (Meta)" type="password" className="min-h-11" autoComplete="off" aria-label="Token de WhatsApp" />
              <Input value={waPhoneId} onChange={(e) => setWaPhoneId(e.target.value)} placeholder="phone_number_id" className="min-h-11" autoComplete="off" aria-label="phone_number_id de WhatsApp" />
              <Input value={waVerify} onChange={(e) => setWaVerify(e.target.value)} placeholder="Verify token personalizado para el webhook" className="min-h-11" autoComplete="off" aria-label="Verify token de WhatsApp" />
            </div>
            <Button onClick={saveWhatsapp} disabled={savingWa} className="bg-emerald-600 hover:bg-emerald-700 min-h-11">
              <KeyRound className="w-4 h-4 mr-1.5" aria-hidden /> {savingWa ? 'Guardando…' : 'Guardar WhatsApp'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Analizador multimodal directo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-5 h-5 text-teal-600" aria-hidden /> Analizador de pliegos y documentos
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Sube el pliego PDF (texto o foto), una foto del contrato, una nota de voz o un video. El agente lo entiende y devuelve el análisis: requisitos, valores, plazos, garantías y si exige marco lógico.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*,audio/*,video/*,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadFile(f)
                e.target.value = ''
              }}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} variant="outline" className="min-h-11 flex-1">
              <Upload className="w-4 h-4 mr-1.5" aria-hidden /> {uploading ? 'Analizando…' : 'Elegir archivo (PDF, foto, audio, video)'}
            </Button>
            {recording ? (
              <Button onClick={stopRecording} variant="destructive" className="min-h-11 flex-1">
                <Square className="w-4 h-4 mr-1.5" aria-hidden /> Detener y transcribir
              </Button>
            ) : (
              <Button onClick={startRecording} disabled={uploading} className="min-h-11 flex-1 bg-teal-600 hover:bg-teal-700">
                <Mic className="w-4 h-4 mr-1.5" aria-hidden /> Grabar nota de voz
              </Button>
            )}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota opcional para el agente (ej.: 'fíjate en los requisitos habilitantes del capítulo 3')" className="min-h-11" aria-label="Nota para el análisis" />
          {recording && <p role="status" className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">🔴 Grabando… habla y pulsa «Detener» para transcribir.</p>}
          {uploading && <Spinner label="El agente está analizando el archivo…" />}
          {lastResult && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Análisis del agente</p>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{lastResult}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bandeja unificada */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600" aria-hidden /> Bandeja de conversaciones
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { loadMessages(); loadConfig() }} className="min-h-9">
                <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden /> Actualizar
              </Button>
              <Button size="sm" variant="ghost" onClick={clearInbox} className="min-h-9 text-rose-700 hover:bg-rose-50">
                <Trash2 className="w-4 h-4 mr-1.5" aria-hidden /> Limpiar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aún no hay mensajes. Conecta Telegram, escribe al bot, o usa el analizador de arriba con un pliego.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {messages.map((m) => {
                const Icon = TYPE_ICONS[m.type] || MessageSquare
                const isIn = m.direction === 'ENTRANTE'
                return (
                  <li key={m.id} className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className={CHANNEL_BADGES[m.channel] || ''}>{m.channel}</Badge>
                      <Badge variant="outline" className={isIn ? 'border-teal-300 text-teal-800 bg-teal-50' : 'border-emerald-300 text-emerald-800 bg-emerald-50'}>
                        {isIn ? 'Entrante' : 'Respuesta'}
                      </Badge>
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
                      <span className="text-muted-foreground">{m.type}</span>
                      <span className="text-muted-foreground">· {m.chatName || m.chatId}</span>
                      <span className="text-muted-foreground ml-auto">{fmtDateTime(m.createdAt)}</span>
                    </div>
                    {m.text && <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</p>}
                    {m.transcript && (
                      <p className="text-sm rounded border-l-2 border-teal-400 bg-teal-50/50 px-2.5 py-1.5">
                        <strong className="text-xs uppercase text-teal-700 mr-1">Voz transcrita:</strong> {m.transcript}
                      </p>
                    )}
                    {m.type === 'IMAGEN' && m.mediaPath && (
                      <img src={`/api/media/${m.id}/file`} alt={`Imagen enviada por ${m.chatName || 'el usuario'}`} className="rounded border max-h-56 w-auto" loading="lazy" />
                    )}
                    {m.type === 'VIDEO' && m.mediaPath && (
                      <video src={`/api/media/${m.id}/file`} controls className="rounded border max-h-56 w-auto" preload="metadata" />
                    )}
                    {m.type === 'AUDIO' && m.mediaPath && (
                      <audio src={`/api/media/${m.id}/file`} controls className="w-full max-w-sm" preload="metadata" />
                    )}
                    {(() => {
                      const parsed = parseAnalysisSafe(m.analysis)
                      if (parsed) {
                        return (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-muted-foreground">Ver análisis estructurado</summary>
                            <pre className="mt-1.5 rounded bg-muted/50 p-2 text-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(parsed, null, 2)}</pre>
                          </details>
                        )
                      }
                      return m.analysis ? (
                        <p className="text-sm rounded border-l-2 border-emerald-400 bg-emerald-50/50 px-2.5 py-1.5 whitespace-pre-wrap leading-relaxed">{m.analysis}</p>
                      ) : null
                    })()}
                    {m.error && (
                      <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">Error: {m.error}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator className="my-2" />
      <p className="text-xs text-muted-foreground">
        Nota de privacidad: los medios quedan en el servidor del agente y solo se usan para tus análisis. El token del bot nunca se muestra completo en la interfaz.
      </p>
    </div>
  )
}
