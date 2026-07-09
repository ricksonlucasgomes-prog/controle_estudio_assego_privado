import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')
    ?? req.headers.get('cf-connecting-ip')
    ?? ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Token de autorizacao ausente.')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) throw new Error('Usuario nao autenticado ou token invalido.')

    const body = await req.json()
    const { requester, guests, booking_details, signature } = body

    if (!signature || signature.acceptedTerms !== true || !String(signature.fullName ?? '').trim()) {
      throw new Error('Assinatura digital ausente ou invalida. Baixe o Termo, aceite e assine.')
    }

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
        lgpd_accepted_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (requestError) throw requestError

    if (guests && Array.isArray(guests) && guests.length > 0) {
      const guestsToInsert = guests.map((g: any) => ({
        booking_request_id: requestData.id,
        full_name: g.name,
        rg: g.rg,
        cpf: g.cpf,
        email: g.email,
        whatsapp: g.whatsapp,
        social: g.social,
      }))

      const { error: guestsError } = await supabase
        .from('studio_booking_participants')
        .insert(guestsToInsert)

      if (guestsError) throw guestsError
    }

    const signedAt = new Date().toISOString()
    const ip = clientIp(req)
    const userAgent = req.headers.get('user-agent') ?? String(signature.userAgent ?? '')

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

    if (signatureError) {
      await supabase.from('studio_booking_participants').delete().eq('booking_request_id', requestData.id)
      await supabase.from('studio_booking_requests').delete().eq('id', requestData.id)
      throw new Error(`Falha ao registrar assinatura digital: ${signatureError.message}`)
    }

    return new Response(
      JSON.stringify({ success: true, booking_id: requestData.id, signature_hash: payloadHash }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro inesperado.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})
