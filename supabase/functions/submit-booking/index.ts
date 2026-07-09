import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10"

// Configuração de CORS para permitir requisições do seu Frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------
// Utilitários de Assinatura Digital (não-repúdio / LGPD)
// ---------------------------------------------------------------------

// Serializa de forma DETERMINÍSTICA (chaves ordenadas recursivamente),
// para que o mesmo conteúdo gere sempre o mesmo hash.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// IP real do cliente atrás de proxy (Supabase/Cloudflare usam x-forwarded-for).
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')
    ?? req.headers.get('cf-connecting-ip')
    ?? ''
}

serve(async (req) => {
  // 1. Tratamento de Preflight (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Extração do Token JWT do cabeçalho
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Token de autorização ausente.')
    }

    // 3. Inicialização do Supabase repassando o JWT do usuário (Segurança/RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Valida se o token é real e pega os dados do usuário autenticado
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('Usuário não autenticado ou token inválido.')

    // 4. Recebimento do Payload do Frontend
    const body = await req.json()
    const { requester, guests, booking_details, signature, approvers } = body

    // 4.1 Gate jurídico: sem assinatura válida, nada é gravado.
    if (!signature || signature.acceptedTerms !== true || !String(signature.fullName ?? '').trim()) {
      throw new Error('Assinatura digital ausente ou inválida. Baixe o Termo, aceite e assine.')
    }

    // 5. Inserção do Solicitante na tabela studio_booking_requests
    const { data: requestData, error: requestError } = await supabase
      .from('studio_booking_requests')
      .insert({
        requester_id: user.id,
        requester_name: requester.name,
        requester_rg: requester.rg,
        requester_cpf: requester.cpf,
        requester_email: requester.email,
        requester_whatsapp: requester.whatsapp,
        requester_social: requester.social,
        requested_date: booking_details.date,
        requested_time: booking_details.time,
        lgpd_accepted_at: new Date().toISOString()
      })
      .select()
      .single()

    if (requestError) throw requestError

    // 6. Inserção dos Convidados na tabela studio_booking_participants
    let guestsData: unknown[] = []
    if (guests && Array.isArray(guests) && guests.length > 0) {
      const guestsToInsert = guests.map((g: any) => ({
        booking_request_id: requestData.id,
        full_name: g.name,
        rg: g.rg,
        cpf: g.cpf,
        email: g.email,
        whatsapp: g.whatsapp,
        social: g.social
      }))

      const { data: insertedGuests, error: guestsError } = await supabase
        .from('studio_booking_participants')
        .insert(guestsToInsert)
        .select()

      if (guestsError) throw guestsError
      guestsData = insertedGuests ?? []
    }

    // 7. Assinatura Digital: carimba IP + timestamp + hash SHA-256 (não-repúdio)
    const signedAt = new Date().toISOString()
    const ip = clientIp(req)
    const userAgent = req.headers.get('user-agent') ?? String(signature.userAgent ?? '')

    // Payload canônico = exatamente o que foi assinado. O hash cobre tudo.
    const signedPayload = {
      booking_request_id: requestData.id,
      requester,
      guests: guests ?? [],
      booking_details,
      document_name: signature.termDocument ?? 'Termo_de_Uso_Assego.pdf',
      signer_name: String(signature.fullName).trim(),
      signer_email: signature.signedByEmail ?? user.email ?? null,
      accepted_terms: true,
      signed_at: signedAt,
    }
    const payloadHash = await sha256Hex(stableStringify(signedPayload))

    const { error: signatureError } = await supabase
      .from('legal_signatures')
      .insert({
        booking_request_id: requestData.id,
        signer_id: user.id,
        signer_name: signedPayload.signer_name,
        signer_email: signedPayload.signer_email,
        document_name: signedPayload.document_name,
        accepted: true,
        payload: signedPayload,
        payload_hash: payloadHash,
        ip_address: ip,
        user_agent: userAgent,
        signed_at: signedAt,
      })

    // Compensação: se a assinatura falhar, desfazemos a reserva para não
    // deixar agendamento sem prova jurídica (mantém a base consistente).
    if (signatureError) {
      await supabase.from('studio_booking_participants').delete().eq('booking_request_id', requestData.id)
      await supabase.from('studio_booking_requests').delete().eq('id', requestData.id)
      throw new Error(`Falha ao registrar assinatura digital: ${signatureError.message}`)
    }

    // 8. Roteamento Inteligente: Disparo do Webhook para o n8n
    const n8nWebhookUrl = Deno.env.get('N8N_WEBHOOK_URL')
    if (n8nWebhookUrl) {
      const n8nPayload = {
        event: "new_studio_booking",
        timestamp: signedAt,
        booking_id: requestData.id,
        requester: requestData,
        guests: guestsData,
        approvers: approvers ?? [],
        signature: {
          signer_name: signedPayload.signer_name,
          signer_email: signedPayload.signer_email,
          document_name: signedPayload.document_name,
          signed_at: signedAt,
          ip_address: ip,
          payload_hash: payloadHash,
        },
      }

      // Aguardamos o envio para garantir entrega ao n8n.
      await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(n8nPayload)
      }).catch(err => console.error("Erro ao notificar n8n:", err))
    } else {
      console.warn("Aviso: N8N_WEBHOOK_URL não configurada nas variáveis de ambiente.")
    }

    // 9. Retorno de Sucesso para o Frontend
    return new Response(
      JSON.stringify({ success: true, booking_id: requestData.id, signature_hash: payloadHash }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro inesperado.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
