import { serve } from 'https://deno.land/std@0.192.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const ADMIN_RECIPIENTS = [
  'ricksonlucasgomes@gmail.com',
  'comunicacaoassego@gmail.com',
  'P3dacao@gmail.com',
]

type JsonRecord = Record<string, unknown>
type OutboxRow = {
  id: string
  event_type: 'booking_created' | 'booking_status_changed' | 'equipment_request_created'
  payload: JsonRecord
  attempts: number
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeHeader(value: unknown): string {
  return text(value, 160).replace(/[\r\n]+/g, ' ')
}

function response(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function resolveAdminRecipients(admin: SupabaseClient): Promise<string[]> {
  const recipients = new Set(ADMIN_RECIPIENTS.map((email) => email.toLowerCase()))
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'developer'])
  if (error) throw error

  const users = await Promise.all((profiles ?? []).map(({ id }) => admin.auth.admin.getUserById(id)))
  users.forEach(({ data, error: userError }) => {
    if (userError) throw userError
    const email = data.user?.email?.trim().toLowerCase()
    if (email) recipients.add(email)
  })
  return [...recipients]
}

async function sendMail(to: string | string[], subject: string, content: string): Promise<void> {
  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD')
  if (!gmailUser || !gmailPass) throw new Error('SMTP_NOT_CONFIGURED')

  const client = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: gmailUser, password: gmailPass },
    },
  })
  try {
    await client.send({ from: gmailUser, to, subject: safeHeader(subject), content })
  } finally {
    await client.close()
  }
}

async function retryBookingCreated(admin: SupabaseClient, payload: JsonRecord): Promise<void> {
  const requester = isRecord(payload.requester) ? payload.requester : {}
  const booking = isRecord(payload.booking_details) ? payload.booking_details : {}
  const program = isRecord(booking.program) ? booking.program : {}
  const guests = Array.isArray(payload.guests) ? payload.guests.filter(isRecord) : []
  const materials = Array.isArray(booking.materials) ? booking.materials.filter(isRecord) : []
  const externalLinks = Array.isArray(booking.materialLinks)
    ? booking.materialLinks.map((value) => text(value, 1000)).filter(Boolean)
    : []

  const materialLines: string[] = []
  for (const material of materials) {
    const path = text(material.path, 500)
    const { data, error } = await admin.storage.from('booking-materials').createSignedUrl(path, 7 * 24 * 60 * 60)
    if (error || !data?.signedUrl) throw error ?? new Error('MATERIAL_SIGNED_URL_FAILED')
    materialLines.push(`${text(material.name, 160) || 'Material'}: ${data.signedUrl}`)
  }

  const guestLines = guests.length
    ? guests.map((guest, index) =>
        `${index + 1}. ${text(guest.name, 160)} | CPF: ${text(guest.cpf, 20)} | ` +
        `Email: ${text(guest.email, 254)} | WhatsApp: ${text(guest.whatsapp, 30)} | ` +
        `Rede social: ${text(guest.social, 120)}`
      ).join('\n')
    : 'Nenhum convidado adicional.'
  const recipients = await resolveAdminRecipients(admin)
  await sendMail(
    recipients,
    `Nova solicitacao de agendamento - ${text(requester.name, 160)}`,
    `Nova solicitacao de agendamento no Assego Studio.\n\n` +
      `Nome: ${text(requester.name, 160)}\nCPF: ${text(requester.cpf, 20)}\n` +
      `Email: ${text(requester.email, 254)}\nWhatsApp: ${text(requester.whatsapp, 30)}\n` +
      `Rede social: ${text(requester.social, 120)}\n\n` +
      `Data: ${text(booking.date, 10)}\nInicio: ${text(booking.time, 5)}\n` +
      `Termino: ${text(booking.endTime, 5)}\n\nPrograma: ${text(program.name, 160)}\n` +
      `Formato: ${program.format === 'live' ? 'Ao vivo' : 'Gravado'}\n` +
      `Orientacoes: ${text(program.productionNotes, 2000) || 'Nenhuma.'}\n` +
      `Canal do YouTube: ${text(program.youtubeChannelUrl, 500) || 'Nao se aplica'}\n\n` +
      `Arquivos privados:\n${materialLines.join('\n') || 'Nenhum arquivo.'}\n\n` +
      `Links externos:\n${externalLinks.join('\n') || 'Nenhum link.'}\n\n` +
      `Convidados:\n${guestLines}\n\nAcesse: https://assegostudio.vercel.app`,
  )
}

async function retryBookingStatus(payload: JsonRecord): Promise<void> {
  const recipient = text(payload.requester_email, 254)
  if (!recipient) throw new Error('REQUESTER_EMAIL_MISSING')
  const approved = payload.status === 'approved'
  await sendMail(
    recipient,
    approved ? 'Sua gravacao no Assego Studio foi aprovada' : 'Atualizacao da sua solicitacao no Assego Studio',
    `Ola, ${text(payload.requester_name, 160) || 'solicitante'}.\n\n` +
      `Sua solicitacao para ${text(payload.requested_date, 10)}, das ${text(payload.requested_time, 5)} ` +
      `as ${text(payload.requested_end_time, 5)}, foi ${approved ? 'aprovada' : 'nao aprovada'}.\n\n` +
      'Consulte tambem o sininho de Notificacoes: https://assegostudio.vercel.app',
  )
}

async function retryEquipment(admin: SupabaseClient, payload: JsonRecord): Promise<void> {
  const recipients = await resolveAdminRecipients(admin)
  await sendMail(
    recipients,
    `Pedido de equipamento - ${text(payload.requester_name, 160)}`,
    `${text(payload.requester_name, 160)} (${text(payload.requester_email, 254)}) pediu ` +
      `o equipamento "${text(payload.equipment_name, 160)}".\n\n` +
      `Justificativa:\n${text(payload.justification, 1000)}\n\n` +
      'Acesse: https://assegostudio.vercel.app',
  )
}

async function deliver(admin: SupabaseClient, row: OutboxRow): Promise<void> {
  if (row.event_type === 'booking_created') return await retryBookingCreated(admin, row.payload)
  if (row.event_type === 'booking_status_changed') return await retryBookingStatus(row.payload)
  if (row.event_type === 'equipment_request_created') return await retryEquipment(admin, row.payload)
  throw new Error('EVENT_TYPE_UNSUPPORTED')
}

serve(async (req) => {
  if (req.method !== 'POST') return response({ error: 'Metodo nao permitido.' }, 405)
  const expectedSecret = Deno.env.get('NOTIFICATION_WORKER_SECRET') ?? ''
  const providedSecret = req.headers.get('x-cron-secret') ?? ''
  if (!expectedSecret || providedSecret !== expectedSecret) return response({ error: 'Nao autorizado.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return response({ error: 'Backend nao configurado.' }, 500)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  let batchSize = 10
  try {
    const body = await req.json()
    batchSize = Math.max(1, Math.min(25, Number(body?.batchSize ?? 10)))
  } catch {
    // Corpo vazio usa o lote padrao.
  }

  const now = new Date()
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
  await admin.from('notification_outbox').update({
    status: 'failed',
    last_error: 'WORKER_RECOVERED_STALE_CLAIM',
    next_attempt_at: now.toISOString(),
    updated_at: now.toISOString(),
  }).eq('status', 'sending').lt('updated_at', staleBefore)

  const { data, error } = await admin
    .from('notification_outbox')
    .select('id, event_type, payload, attempts')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(batchSize)
  if (error) return response({ error: 'Falha ao consultar a fila.' }, 500)

  let sent = 0
  let failed = 0
  for (const candidate of (data ?? []) as OutboxRow[]) {
    const { data: claimed, error: claimError } = await admin
      .from('notification_outbox')
      .update({
        status: 'sending',
        attempts: Number(candidate.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidate.id)
      .in('status', ['pending', 'failed'])
      .select('id')
    if (claimError || !claimed?.length) continue

    try {
      await deliver(admin, candidate)
      await admin.from('notification_outbox').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', candidate.id)
      sent += 1
    } catch (deliveryError) {
      const attempts = Number(candidate.attempts ?? 0) + 1
      const delayMinutes = Math.min(1440, 5 * (2 ** Math.min(attempts - 1, 8)))
      const message = deliveryError instanceof Error ? deliveryError.message : 'DELIVERY_ERROR'
      await admin.from('notification_outbox').update({
        status: 'failed',
        last_error: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', candidate.id)
      failed += 1
    }
  }

  return response({ success: true, processed: (data ?? []).length, sent, failed })
})
