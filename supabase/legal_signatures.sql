-- =====================================================================
-- Trilha de auditoria de Assinatura Digital (LGPD / não-repúdio)
-- Execute no SQL Editor do Supabase.
-- Tabela IMUTÁVEL: só permite INSERT (do próprio usuário) e SELECT (admin).
-- Sem UPDATE/DELETE -> RLS nega por padrão (nenhuma policy concede).
-- =====================================================================

create extension if not exists "pgcrypto";

create table if not exists public.legal_signatures (
  id uuid primary key default gen_random_uuid(),

  -- Vínculo com a solicitação de agendamento assinada.
  booking_request_id uuid references public.studio_booking_requests(id) on delete cascade,

  -- Quem assinou (sessão autenticada) + o nome digitado como assinatura.
  signer_id      uuid references auth.users(id),
  signer_name    text not null,          -- nome completo digitado (assinatura)
  signer_email   text,

  -- Documento aceito e flag de consentimento.
  document_name  text not null default 'Termo_de_Uso_Assego.pdf',
  accepted       boolean not null default true,

  -- Prova criptográfica de não-repúdio.
  payload        jsonb not null,         -- dados exatos que foram assinados
  payload_hash   text  not null,         -- SHA-256 (hex) do payload canônico
  ip_address     text,                   -- x-forwarded-for (1º IP)
  user_agent     text,

  signed_at      timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists legal_signatures_booking_idx
  on public.legal_signatures (booking_request_id);
create index if not exists legal_signatures_signer_idx
  on public.legal_signatures (signer_id);

alter table public.legal_signatures enable row level security;

-- Reexecutável.
drop policy if exists "legal_sig_insert_self" on public.legal_signatures;
drop policy if exists "legal_sig_select_admin" on public.legal_signatures;

-- Usuário autenticado só insere assinatura em seu próprio nome.
create policy "legal_sig_insert_self" on public.legal_signatures
for insert to authenticated
with check (signer_id = auth.uid());

-- Leitura restrita à diretoria (admin) — dado sensível.
create policy "legal_sig_select_admin" on public.legal_signatures
for select to authenticated
using (public.current_user_is_booking_approver());

-- Observação: propositalmente NÃO existem policies de UPDATE/DELETE.
-- Com RLS habilitada, isso torna cada registro imutável para os usuários,
-- preservando a integridade da trilha de auditoria (princípio da inalterabilidade).
