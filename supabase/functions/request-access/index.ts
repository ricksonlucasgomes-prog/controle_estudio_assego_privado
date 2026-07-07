// Supabase Edge Function: request-access
// Envia email aos admins pedindo liberacao de acesso para um usuario logado.
//
// Secrets necessarios:
//   supabase secrets set RESEND_API_KEY=... MAIL_FROM="Estudio ASSEGO <avisos@dominio>" \
//     MAIL_TO="ricksonlucasgomes@gmail.com,comunicacaoassego@gmail.com,P3dacao@gmail.com"
// Deploy:
//   supabase functions deploy request-access

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendEmail(subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  const to = (Deno.env.get('MAIL_TO') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!key || !from || to.length === 0) {
    throw new Error('Email nao configurado. Defina RESEND_API_KEY, MAIL_FROM e MAIL_TO nos secrets.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) throw new Error('Falha ao enviar email: ' + (await res.text()));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: 'nao autenticado' }), { status: 401, headers: cors });

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario');
    const email = String(user.email || body.email || '');
    const requestedRole = body.requestedRole === 'admin' ? 'admin' : 'borrower';
    const requestedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const html = `
      <h2>Pedido de liberacao de acesso</h2>
      <p><b>Nome:</b> ${escapeHtml(name)}</p>
      <p><b>Email:</b> ${escapeHtml(email)}</p>
      <p><b>ID do usuario:</b> ${escapeHtml(user.id)}</p>
      <p><b>Acesso solicitado:</b> ${escapeHtml(requestedRole)}</p>
      <p><b>Data:</b> ${escapeHtml(requestedAt)}</p>
      <hr />
      <p>Para liberar no SQL Editor do Supabase:</p>
      <pre>update public.profiles
set role = '${escapeHtml(requestedRole)}', full_name = '${escapeHtml(name.replace(/'/g, "''"))}'
where id = '${escapeHtml(user.id)}';</pre>
    `;

    await sendEmail(`Liberar acesso ao Estudio ASSEGO: ${name}`, html);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
