import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Horario de funcionamento do estudio (seg-sex 9-17, exceto 12h; sab 9-12).
// weekday: 0=domingo ... 6=sabado. Blocos de 1h.
const BUSINESS_HOURS: Record<number, string[]> = {
  1: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'],
  2: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'],
  3: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'],
  4: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'],
  5: ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'],
  6: ['09:00', '10:00', '11:00'],
}
const SLOT_DURATION_MIN = 60
const DAYS_AHEAD = 45
const TZ_OFFSET_HOURS = 3 // America/Sao_Paulo (UTC-3), sem horario de verao hoje

type BusyInterval = { start: number; end: number }

// Converte um valor DTSTART/DTEND do ICS (ex: 20260710T140000Z ou
// 20260710T140000 ou 20260710) para epoch ms em UTC.
function parseIcsDate(raw: string): number {
  const clean = raw.trim()
  const isUtc = clean.endsWith('Z')
  const digits = clean.replace('Z', '')
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6)) - 1
  const day = Number(digits.slice(6, 8))
  if (digits.length <= 8) {
    // evento de dia inteiro
    return Date.UTC(year, month, day)
  }
  const hour = Number(digits.slice(9, 11))
  const minute = Number(digits.slice(11, 13))
  const second = Number(digits.slice(13, 15) || '0')
  if (isUtc) return Date.UTC(year, month, day, hour, minute, second)
  // Sem timezone explicito no ICS: assume horario local de Sao Paulo.
  return Date.UTC(year, month, day, hour + TZ_OFFSET_HOURS, minute, second)
}

// Parser simples de VEVENT: pega DTSTART/DTEND de cada bloco.
// Nao expande eventos recorrentes (RRULE) - limitacao conhecida do MVP.
function extractBusyIntervals(icsText: string): BusyInterval[] {
  const intervals: BusyInterval[] = []
  const events = icsText.split('BEGIN:VEVENT').slice(1)
  for (const raw of events) {
    const block = raw.split('END:VEVENT')[0]
    const dtStartMatch = block.match(/DTSTART[^:]*:([0-9TZ]+)/)
    const dtEndMatch = block.match(/DTEND[^:]*:([0-9TZ]+)/)
    if (!dtStartMatch) continue
    const start = parseIcsDate(dtStartMatch[1])
    const end = dtEndMatch ? parseIcsDate(dtEndMatch[1]) : start + 60 * 60 * 1000
    intervals.push({ start, end })
  }
  return intervals
}

function slotIsBusy(dateStr: string, time: string, busy: BusyInterval[]): boolean {
  const [h, m] = time.split(':').map(Number)
  const [y, mo, d] = dateStr.split('-').map(Number)
  const slotStart = Date.UTC(y, mo - 1, d, h + TZ_OFFSET_HOURS, m)
  const slotEnd = slotStart + SLOT_DURATION_MIN * 60000
  return busy.some((b) => slotStart < b.end && slotEnd > b.start)
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

    const icsUrl = Deno.env.get('STUDIO_CALENDAR_ICAL_URL')
    if (!icsUrl) throw new Error('STUDIO_CALENDAR_ICAL_URL nao configurada.')

    const icsRes = await fetch(icsUrl)
    if (!icsRes.ok) throw new Error(`Falha ao buscar agenda do estudio (${icsRes.status}).`)
    const icsText = await icsRes.text()
    const busy = extractBusyIntervals(icsText)

    const days: Array<{ date: string; weekday: number; slots: { time: string; available: boolean }[]; hasAvailability: boolean }> = []
    const today = new Date()
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())

    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dayMs = todayUtc + i * 86400000
      const d = new Date(dayMs)
      const weekday = d.getUTCDay()
      const times = BUSINESS_HOURS[weekday]
      if (!times) continue // domingo: estudio fechado

      const dateStr = d.toISOString().slice(0, 10)
      const slots = times.map((time) => ({ time, available: !slotIsBusy(dateStr, time, busy) }))
      days.push({ date: dateStr, weekday, slots, hasAvailability: slots.some((s) => s.available) })
    }

    return new Response(JSON.stringify({ days }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro inesperado.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})
