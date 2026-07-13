import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const ALLOWED_ORIGINS = new Set([
  'https://assegostudio.vercel.app',
  'http://127.0.0.1:5173',
  'tauri://localhost',
  'http://tauri.localhost',
])

const ADMIN_RECIPIENTS = [
  'ricksonlucasgomes@gmail.com',
  'comunicacaoassego@gmail.com',
  'P3dacao@gmail.com',
]

const MAX_BODY_BYTES = 64 * 1024
const MAX_GUESTS = 20
const MAX_MATERIALS = 10

type JsonRecord = Record<string, unknown>

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function jsonResponse(req: Request, body: JsonRecord, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function validateUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function validatePayload(body: JsonRecord): {
  requester: JsonRecord
  guests: JsonRecord[]
  booking: JsonRecord
  signature: JsonRecord
  idempotencyKey: string
} {
  const requester = body.requester
  const guests = body.guests ?? []
  const booking = body.booking_details
  const signature = body.signature
  const idempotencyKey = text(body.idempotencyKey, 64)

  if (!isRecord(requester) || !Array.isArray(guests) || !isRecord(booking) || !isRecord(signature)) {
    throw new Error('PAYLOAD_INVALID')
  }
  if (!validateUuid(idempotencyKey)) throw new Error('IDEMPOTENCY_REQUIRED')
  if (guests.length > MAX_GUESTS || !guests.every(isRecord)) throw new Error('GUESTS_INVALID')
  if (signature.acceptedTerms !== true || text(signature.fullName, 160).length < 3) {
    throw new Error('SIGNATURE_INVALID')
  }

  const requiredRequester = [
    text(requester.name, 160),
    text(requester.rg, 30),
    text(requester.cpf, 20),
    text(requester.whatsapp, 30),
    text(requester.social, 120),
  ]
  if (requiredRequester.some((value) => value.length < 2)) throw new Error('REQUESTER_INVALID')

  const date = text(booking.date, 10)
  const time = text(booking.time, 5)
  const regularSlot = /^(09|10|11|13|14|15|16):00$/.test(time)
  const afterHoursSlot = /^(17:30|1[89]:(00|30)|2[0-3]:(00|30))$/.test(time)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!regularSlot && !afterHoursSlot)) {
    throw new Error('SLOT_INVALID')
  }

  const program = booking.program
  const materials = booking.materials ?? []
  const materialLinks = booking.materialLinks ?? []
  if (!isRecord(program) || !Array.isArray(materials) || !Array.isArray(materialLinks)) {
    throw new Error('PROGRAM_INVALID')
  }
  const programName = text(program.name, 160)
  const programFormat = text(program.format, 16)
  const productionNotes = text(program.productionNotes, 2000)
  const youtubeChannelUrl = text(program.youtubeChannelUrl, 500)
  if (programName.length < 2 || !['recorded', 'live'].includes(programFormat)) {
    throw new Error('PROGRAM_INVALID')
  }
  if (programFormat === 'live') {
    try {
      const url = new URL(youtubeChannelUrl)
      if (url.protocol !== 'https:' || !/(^|\.)youtube\.com$/i.test(url.hostname)) {
        throw new Error('URL_INVALID')
      }
    } catch {
      throw new Error('YOUTUBE_CHANNEL_INVALID')
    }
    if (program.youtubeAccessMethod !== 'delegated_permission') {
      throw new Error('YOUTUBE_ACCESS_INVALID')
    }
  }
  if (materials.length > MAX_MATERIALS || !materials.every(isRecord)) throw new Error('MATERIALS_INVALID')
  const normalizedMaterials = materials.map((material) => ({
    path: text(material.path, 500),
    name: text(material.name, 160),
    type: text(material.type, 120),
    size: Number(material.size ?? 0),
  }))
  if (normalizedMaterials.some((material) =>
    !material.path
    || !material.name
    || !Number.isFinite(material.size)
    || material.size < 0
    || material.size > 50 * 1024 * 1024
  )) throw new Error('MATERIALS_INVALID')
  if (normalizedMaterials.reduce((total, material) => total + material.size, 0) > 100 * 1024 * 1024) {
    throw new Error('MATERIALS_TOTAL_TOO_LARGE')
  }
  const normalizedLinks = materialLinks.map((value) => text(value, 1000))
  if (normalizedLinks.length > 10 || normalizedLinks.some((value) => {
    try {
      return new URL(value).protocol !== 'https:'
    } catch {
      return true
    }
  })) throw new Error('MATERIAL_LINKS_INVALID')

  const normalizedBooking: JsonRecord = {
    date,
    time,
    scheduleType: time > '17:00' ? 'after_hours' : 'regular',
    program: {
      name: programName,
      format: programFormat,
      productionNotes,
      youtubeChannelUrl: programFormat === 'live' ? youtubeChannelUrl : '',
      youtubeAccessMethod: programFormat === 'live' ? 'delegated_permission' : 'not_applicable',
    },
    materials: normalizedMaterials,
    materialLinks: normalizedLinks,
  }

  for (const guest of guests) {
    const requiredGuest = [
      text(guest.name, 160),
      text(guest.rg, 30),
      text(guest.cpf, 20),
      text(guest.email, 254),
      text(guest.whatsapp, 30),
      text(guest.social, 120),
    ]
    if (requiredGuest.some((value) => value.length < 2)) throw new Error('GUEST_INVALID')
  }

  return { requester, guests, booking: normalizedBooking, signature, idempotencyKey }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim().slice(0, 128)
  return (
    req.headers.get('x-real-ip')
    ?? req.headers.get('cf-connecting-ip')
    ?? ''
  ).slice(0, 128)
}

function safeHeader(value: unknown): string {
  return text(value, 160).replace(/[\r\n]+/g, ' ')
}

type MaterialAccessLink = { name: string; type: string; size: number; url: string }

async function createMaterialAccessLinks(admin: SupabaseClient, payload: JsonRecord): Promise<MaterialAccessLink[]> {
  const booking = isRecord(payload.booking_details) ? payload.booking_details : {}
  const materials = Array.isArray(booking.materials) ? booking.materials.filter(isRecord) : []
  const links: MaterialAccessLink[] = []
  for (const material of materials) {
    const path = text(material.path, 500)
    const { data, error } = await admin.storage.from('booking-materials').createSignedUrl(path, 7 * 24 * 60 * 60)
    if (error || !data?.signedUrl) throw error ?? new Error('MATERIAL_SIGNED_URL_FAILED')
    links.push({
      name: text(material.name, 160),
      type: text(material.type, 120),
      size: Number(material.size ?? 0),
      url: data.signedUrl,
    })
  }
  return links
}

async function sendBookingNotificationEmail(
  payload: JsonRecord,
  materialAccessLinks: MaterialAccessLink[],
): Promise<void> {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) throw new Error('SMTP_NOT_CONFIGURED')

  const requester = isRecord(payload.requester) ? payload.requester : {}
  const booking = isRecord(payload.booking_details) ? payload.booking_details : {}
  const program = isRecord(booking.program) ? booking.program : {}
  const externalLinks = Array.isArray(booking.materialLinks)
    ? booking.materialLinks.map((value) => text(value, 1000)).filter(Boolean)
    : []
  const guests = Array.isArray(payload.guests) ? payload.guests.filter(isRecord) : []
  const guestsList = guests.length
    ? guests.map((guest, index) =>
        `${index + 1}. ${text(guest.name, 160) || '-'}\n` +
        `   RG: ${text(guest.rg, 30) || '-'}\n` +
        `   CPF: ${text(guest.cpf, 20) || '-'}\n` +
        `   Email: ${text(guest.email, 254) || '-'}\n` +
        `   WhatsApp: ${text(guest.whatsapp, 30) || '-'}\n` +
        `   Rede social: ${text(guest.social, 120) || '-'}`
      ).join('\n\n')
    : 'Nenhum convidado adicional.'
  const storedMaterialsList = materialAccessLinks.length
    ? materialAccessLinks.map((material, index) =>
        `${index + 1}. ${material.name || 'Material'} (${material.type || 'arquivo'}, ${Math.round(material.size / 1024)} KB)\n   ${material.url}`
      ).join('\n\n')
    : 'Nenhum arquivo enviado pelo formulario.'
  const externalMaterialsList = externalLinks.length
    ? externalLinks.map((url, index) => `${index + 1}. ${url}`).join('\n')
    : 'Nenhum link externo informado.'

  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  })

  try {
    await client.send({
      from: gmailUser,
      to: ADMIN_RECIPIENTS,
      subject: `Nova solicitacao de agendamento - ${safeHeader(requester.name)}`,
      content:
        `Nova solicitacao de agendamento no Assego Studio.\n\n` +
        `===== Dados do solicitante =====\n` +
        `Nome: ${text(requester.name, 160) || '-'}\n` +
        `RG: ${text(requester.rg, 30) || '-'}\n` +
        `CPF: ${text(requester.cpf, 20) || '-'}\n` +
        `Email: ${text(requester.email, 254) || '-'}\n` +
        `WhatsApp: ${text(requester.whatsapp, 30) || '-'}\n` +
        `Rede social: ${text(requester.social, 120) || '-'}\n\n` +
        `Data: ${text(booking.date, 10)}\n` +
        `Horario: ${text(booking.time, 5)}\n` +
        `Tipo: ${text(booking.time, 5) > '17:00' ? 'Solicitacao excepcional apos as 17h' : 'Horario regular'}\n\n` +
        `===== Programa =====\n` +
        `Nome: ${text(program.name, 160) || '-'}\n` +
        `Formato: ${program.format === 'live' ? 'Ao vivo' : 'Gravado'}\n` +
        `Orientacoes: ${text(program.productionNotes, 2000) || 'Nenhuma orientacao adicional.'}\n` +
        `Canal do YouTube: ${text(program.youtubeChannelUrl, 500) || 'Nao se aplica'}\n` +
        `Acesso ao canal: ${program.format === 'live' ? 'Permissao delegada pelo YouTube Studio; nenhuma senha coletada.' : 'Nao se aplica'}\n\n` +
        `===== Arquivos privados (links validos por 7 dias) =====\n${storedMaterialsList}\n\n` +
        `===== Links de materiais externos =====\n${externalMaterialsList}\n\n` +
        `===== Convidados (${guests.length}) =====\n${guestsList}\n\n` +
        `Assinatura digital registrada para ${text(payload.signer_name, 160)}.\n` +
        `Acesse o app para aprovar ou rejeitar: https://assegostudio.vercel.app`,
    })
  } finally {
    await client.close()
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin') ?? ''
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(req, { error: 'Origem nao autorizada.' }, 403)
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Metodo nao permitido.' }, 405)

  const requestId = crypto.randomUUID()

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return jsonResponse(req, { error: 'Nao autenticado.' }, 401)

    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return jsonResponse(req, { error: 'Solicitacao muito grande.' }, 413)
    }

    let body: JsonRecord
    try {
      const parsed = JSON.parse(rawBody)
      if (!isRecord(parsed)) throw new Error('INVALID_JSON')
      body = parsed
    } catch {
      return jsonResponse(req, { error: 'JSON invalido.' }, 400)
    }

    const input = validatePayload(body)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('BACKEND_NOT_CONFIGURED')

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    if (userError || !user?.email) return jsonResponse(req, { error: 'Nao autenticado.' }, 401)

    const submittedMaterials = Array.isArray(input.booking.materials)
      ? input.booking.materials.filter(isRecord)
      : []
    const expectedPrefix = `${user.id}/${input.idempotencyKey}/`
    if (submittedMaterials.some((material) => {
      const path = text(material.path, 500)
      const fileName = path.slice(expectedPrefix.length)
      return !path.startsWith(expectedPrefix)
        || fileName.includes('/')
        || !/^\d{2}-[a-f0-9]{24}-/i.test(fileName)
    })) {
      return jsonResponse(req, { error: 'Material de agendamento invalido.' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    if (submittedMaterials.length > 0) {
      const folder = expectedPrefix.slice(0, -1)
      const { data: storedObjects, error: storageError } = await admin.storage
        .from('booking-materials')
        .list(folder, { limit: 100 })
      if (storageError) throw storageError
      const storedNames = new Set((storedObjects ?? []).map((item) => item.name))
      if (submittedMaterials.some((material) => !storedNames.has(text(material.path, 500).slice(expectedPrefix.length)))) {
        return jsonResponse(req, { error: 'Um ou mais materiais enviados nao foram encontrados.' }, 400)
      }
    }
    const { data: allowed, error: rateError } = await admin.rpc('consume_rate_limit_v1', {
      p_actor_id: user.id,
      p_action: 'submit_booking',
      p_limit: 5,
      p_window_seconds: 3600,
    })
    if (rateError) throw rateError
    if (!allowed) return jsonResponse(req, { error: 'Muitas solicitacoes. Tente novamente mais tarde.' }, 429)

    const { data: result, error: rpcError } = await admin.rpc('create_signed_booking_v1', {
      p_user_id: user.id,
      p_auth_email: user.email,
      p_idempotency_key: input.idempotencyKey,
      p_requester: input.requester,
      p_guests: input.guests,
      p_booking: input.booking,
      p_signature: input.signature,
      p_ip: clientIp(req),
      p_user_agent: text(req.headers.get('user-agent'), 512),
    })

    if (rpcError) {
      if (/duplicate key|studio_booking_active_slot_uniq/i.test(rpcError.message)) {
        return jsonResponse(req, { error: 'Este horario acabou de ser reservado.' }, 409)
      }
      if (/Data ou horario|Dados obrigatorios|Convidado|assinatura|termo/i.test(rpcError.message)) {
        return jsonResponse(req, { error: rpcError.message }, 400)
      }
      throw rpcError
    }

    const bookingId = text(result?.booking_id, 64)
    const outboxId = text(result?.outbox_id, 64)
    if (!bookingId) throw new Error('RPC_RESULT_INVALID')

    if (!outboxId) {
      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        signature_hash: result?.signature_hash,
        notification_status: 'already_processed',
      }, 200)
    }

    const { data: outbox, error: outboxError } = await admin
      .from('notification_outbox')
      .select('id, payload, status, attempts')
      .eq('id', outboxId)
      .single()
    if (outboxError || !outbox) throw outboxError ?? new Error('OUTBOX_NOT_FOUND')

    await admin
      .from('notification_outbox')
      .update({ status: 'sending', attempts: Number(outbox.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', outboxId)

    try {
      const outboxPayload = outbox.payload as JsonRecord
      const materialAccessLinks = await createMaterialAccessLinks(admin, outboxPayload)
      await sendBookingNotificationEmail(outboxPayload, materialAccessLinks)
      await admin
        .from('notification_outbox')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboxId)

      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        signature_hash: result?.signature_hash,
        notification_status: 'sent',
      }, 200)
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : 'EMAIL_ERROR'
      await admin
        .from('notification_outbox')
        .update({
          status: 'failed',
          last_error: message.slice(0, 500),
          next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', outboxId)

      console.error(`[${requestId}] Falha de notificacao`, message)
      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        signature_hash: result?.signature_hash,
        notification_status: 'pending_retry',
        warning: 'Pedido registrado. O aviso por email esta aguardando nova tentativa.',
      }, 202)
    }
  } catch (error) {
    console.error(`[${requestId}] Falha no submit-booking`, error)
    return jsonResponse(req, { error: 'Nao foi possivel concluir a solicitacao.', request_id: requestId }, 500)
  }
})
