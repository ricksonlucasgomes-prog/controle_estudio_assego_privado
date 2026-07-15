import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const ALLOWED_ORIGINS = new Set([
  'https://assegostudio.vercel.app',
  'https://controle-estudio-assego-privado.vercel.app',
  'http://127.0.0.1:5173',
  'tauri://localhost',
  'http://tauri.localhost',
])

type JsonRecord = Record<string, unknown>

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function safeHeader(value: unknown): string {
  return text(value, 160).replace(/[\r\n]+/g, ' ')
}

async function sendDecisionEmail(payload: JsonRecord): Promise<void> {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  const recipient = text(payload.requester_email, 254)
  if (!gmailUser || !gmailPass) throw new Error('SMTP_NOT_CONFIGURED')
  if (!recipient) throw new Error('REQUESTER_EMAIL_MISSING')

  const approved = payload.status === 'approved'
  const statusLabel = approved ? 'aprovada' : 'não aprovada'
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
      to: recipient,
      subject: safeHeader(approved
        ? 'Sua gravação no Assego Studio foi aprovada'
        : 'Atualização da sua solicitação no Assego Studio'),
      content:
        `Olá, ${text(payload.requester_name, 160) || 'solicitante'}.\n\n` +
        `Sua solicitação de gravação para ${text(payload.requested_date, 10)}, das ${text(payload.requested_time, 5)} às ${text(payload.requested_end_time, 5)}, foi ${statusLabel}.\n\n` +
        (approved
          ? 'A reserva foi aprovada. A equipe da ASSEGO poderá entrar em contato caso seja necessário alinhar detalhes da produção.\n\n'
          : 'Acesse o aplicativo ou entre em contato com a equipe da ASSEGO caso precise de mais informações.\n\n') +
        'Você também recebeu este aviso no sininho de Notificações do aplicativo.\n' +
        'Acesse: https://assegostudio.vercel.app',
    })
  } finally {
    await client.close()
  }
}

// ---------------------------------------------------------------------
// Google Calendar: ao aprovar, cria automaticamente o evento no calendario
// do administrador. Requer secrets (OAuth com escopo de Calendar):
//   supabase secrets set GOOGLE_CALENDAR_REFRESH_TOKEN=... \
//     [GOOGLE_CALENDAR_CLIENT_ID=... GOOGLE_CALENDAR_CLIENT_SECRET=...] \
//     [GOOGLE_CALENDAR_ID=primary]
// Se GOOGLE_CALENDAR_CLIENT_ID/SECRET nao forem definidos, reutiliza
// GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (mesmo OAuth client do Drive).
// Sem refresh token configurado, a aprovacao continua normal (skip do evento).
// ---------------------------------------------------------------------
const CALENDAR_TZ = 'America/Sao_Paulo'

function addOneHour(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!match) return hhmm
  const total = (Number(match[1]) * 60 + Number(match[2]) + 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

async function googleCalendarAccessToken(): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID') ?? Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET') ?? Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  const refreshToken = Deno.env.get('GOOGLE_CALENDAR_REFRESH_TOKEN') ?? ''
  if (!clientId || !clientSecret || !refreshToken) return ''
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  if (!res.ok) throw new Error('CALENDAR_TOKEN_REFRESH_FAILED: ' + (await res.text()).slice(0, 200))
  return String((await res.json()).access_token ?? '')
}

// Cria o evento de forma idempotente: o id do evento e o UUID da reserva sem
// hifens (base32hex valido). Reaprovar/reenviar nao duplica (409 = ja existe).
async function createBookingCalendarEvent(admin: SupabaseClient, bookingId: string): Promise<string> {
  const accessToken = await googleCalendarAccessToken()
  if (!accessToken) return 'not_configured'

  const { data: booking, error } = await admin
    .from('studio_booking_requests')
    .select('requester_name, requester_email, requester_whatsapp, requester_social, requested_date, requested_time, requested_end_time')
    .eq('id', bookingId)
    .single()
  if (error || !booking) throw new Error('BOOKING_NOT_FOUND')

  const date = text(booking.requested_date, 10)
  const startTime = text(booking.requested_time, 5)
  const endTime = text(booking.requested_end_time, 5) || addOneHour(startTime)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error('BOOKING_DATETIME_INVALID')
  }

  const { data: parts } = await admin
    .from('studio_booking_participants')
    .select('full_name, email, whatsapp')
    .eq('booking_request_id', bookingId)
  const guests = (parts ?? []) as Array<{ full_name: string; email: string | null; whatsapp: string | null }>

  const description = [
    `Solicitante: ${text(booking.requester_name, 160)}`,
    `E-mail: ${text(booking.requester_email, 254) || '-'}`,
    `WhatsApp: ${text(booking.requester_whatsapp, 30) || '-'}`,
    `Rede social: ${text(booking.requester_social, 120) || '-'}`,
    '',
    `Participantes (${guests.length}):`,
    ...(guests.length
      ? guests.map((g, i) => `${i + 1}. ${text(g.full_name, 160)} — ${text(g.email, 254) || 'sem e-mail'} — ${text(g.whatsapp, 30) || 'sem WhatsApp'}`)
      : ['Nenhum convidado adicional.']),
    '',
    'Reserva aprovada pelo Assego Studio.',
  ].join('\n')

  const event = {
    id: bookingId.replace(/-/g, ''),
    summary: `Gravação no estúdio — ${text(booking.requester_name, 160)}`,
    location: 'Assego Studio — ASSEGO PM & BM',
    description,
    start: { dateTime: `${date}T${startTime}:00`, timeZone: CALENDAR_TZ },
    end: { dateTime: `${date}T${endTime}:00`, timeZone: CALENDAR_TZ },
  }

  const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') || 'primary'
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    },
  )
  if (res.status === 409) return 'already_exists'
  if (!res.ok) throw new Error('CALENDAR_INSERT_FAILED: ' + res.status + ' ' + (await res.text()).slice(0, 200))
  return 'created'
}

serve(async (req) => {
  const origin = req.headers.get('origin') ?? ''
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(req, { error: 'Origem não autorizada.' }, 403)
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Método não permitido.' }, 405)

  const requestId = crypto.randomUUID()
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return jsonResponse(req, { error: 'Não autenticado.' }, 401)

    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).length > 4096) {
      return jsonResponse(req, { error: 'Solicitação muito grande.' }, 413)
    }
    let body: JsonRecord
    try {
      const parsed = JSON.parse(rawBody)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON')
      body = parsed as JsonRecord
    } catch {
      return jsonResponse(req, { error: 'JSON inválido.' }, 400)
    }

    const bookingId = text(body.bookingId, 64)
    const status = text(body.status, 16)
    if (!/^[0-9a-f-]{36}$/i.test(bookingId) || !['approved', 'rejected'].includes(status)) {
      return jsonResponse(req, { error: 'Decisão inválida.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('BACKEND_NOT_CONFIGURED')

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    if (userError || !user) return jsonResponse(req, { error: 'Não autenticado.' }, 401)

    const { data: decision, error: decisionError } = await authClient.rpc('set_booking_status_v1', {
      p_id: bookingId,
      p_status: status,
    })
    if (decisionError) {
      if (/Apenas o aprovador principal/i.test(decisionError.message)) {
        return jsonResponse(req, { error: 'Sem permissão para decidir esta solicitação.' }, 403)
      }
      if (/inexistente|finalizada|Status inv[aá]lido/i.test(decisionError.message)) {
        return jsonResponse(req, { error: decisionError.message }, 409)
      }
      throw decisionError
    }

    const outboxId = text(decision?.outbox_id, 64)
    if (!outboxId) throw new Error('OUTBOX_RESULT_INVALID')
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    // Na aprovacao, cria o evento no Google Calendar do administrador.
    // Nao-fatal: se falhar ou nao estiver configurado, a aprovacao segue normal.
    let calendarStatus = 'skipped'
    if (status === 'approved') {
      try {
        calendarStatus = await createBookingCalendarEvent(admin, bookingId)
      } catch (calendarError) {
        calendarStatus = 'error'
        console.error(`[${requestId}] Falha ao criar evento no Google Calendar`, calendarError instanceof Error ? calendarError.message : calendarError)
      }
    }

    const { data: outbox, error: outboxError } = await admin
      .from('notification_outbox')
      .select('id, payload, status, attempts')
      .eq('id', outboxId)
      .single()
    if (outboxError || !outbox) throw outboxError ?? new Error('OUTBOX_NOT_FOUND')

    if (outbox.status === 'sent') {
      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        status,
        calendar_status: calendarStatus,
        notification_status: 'already_sent',
      }, 200)
    }

    const { data: claimedOutbox, error: claimError } = await admin
      .from('notification_outbox')
      .update({ status: 'sending', attempts: Number(outbox.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', outboxId)
      .in('status', ['pending', 'failed'])
      .select('id')
    if (claimError) throw claimError
    if (!claimedOutbox?.length) {
      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        status,
        calendar_status: calendarStatus,
        notification_status: 'processing',
      }, 202)
    }

    try {
      await sendDecisionEmail(outbox.payload as JsonRecord)
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
        status,
        calendar_status: calendarStatus,
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

      console.error(`[${requestId}] Falha no e-mail de decisão`, message)
      return jsonResponse(req, {
        success: true,
        booking_id: bookingId,
        status,
        calendar_status: calendarStatus,
        notification_status: 'pending_retry',
        warning: 'Decisão registrada e aviso no app criado. O e-mail aguarda nova tentativa.',
      }, 202)
    }
  } catch (error) {
    console.error(`[${requestId}] Falha no decide-booking`, error)
    return jsonResponse(req, { error: 'Não foi possível concluir a decisão.', request_id: requestId }, 500)
  }
})
