-- =====================================================================
-- Agendamento do Estúdio ASSEGO — tabelas de solicitação e participantes
-- Execute no SQL Editor do Supabase.
--
-- ORDEM DE EXECUÇÃO:
--   1) schema.sql          (cria profiles + função current_user_role)
--   2) studio_booking.sql  (ESTE ARQUIVO)
--   3) legal_signatures.sql (referencia studio_booking_requests via FK)
--
-- current_user_is_booking_approver() (abaixo) já refere-se a profiles.role
-- = 'developer'. Esse valor só é aceito pela coluna depois que
-- supabase/add_developer_role.sql rodar (ainda pendente de confirmação do
-- Lucas) — até lá, nenhum profile consegue ter role = 'developer' mesmo,
-- então a cláusula fica inofensiva (nunca casa com nada).
--
-- As colunas abaixo espelham EXATAMENTE o que a Edge Function
-- `submit-booking` insere. Não renomear sem ajustar a função.
-- Reexecutável (create if not exists / drop policy if exists).
-- =====================================================================

create extension if not exists "pgcrypto";

-- Solicitação de reserva (1 por pedido de gravação).
create table if not exists public.studio_booking_requests (
  id uuid primary key default gen_random_uuid(),

  requester_id       uuid references auth.users(id),
  requester_name     text not null,
  requester_email    text,
  requester_whatsapp text,
  requester_social   text,

  requested_date     date,          -- <input type="date"> -> 'YYYY-MM-DD'
  requested_time     text,          -- <input type="time"> -> 'HH:MM'

  status             text not null default 'requested'
                       check (status in ('requested', 'approved', 'rejected', 'cancelled')),

  lgpd_accepted_at   timestamptz,
  created_at         timestamptz not null default now()
);

-- Convidados/participantes vinculados a uma solicitação.
create table if not exists public.studio_booking_participants (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.studio_booking_requests(id) on delete cascade,

  full_name text not null,
  email     text,
  whatsapp  text,
  social    text,

  created_at timestamptz not null default now()
);

create index if not exists studio_booking_requests_requester_idx
  on public.studio_booking_requests (requester_id);
create index if not exists studio_booking_participants_request_idx
  on public.studio_booking_participants (booking_request_id);

alter table public.studio_booking_requests enable row level security;
alter table public.studio_booking_participants enable row level security;

-- Aprovadores oficiais que podem ver dados pessoais de agendamento no app.
--
-- Admins oficiais após aprovação manual (ninguém aqui é criado
-- automaticamente — cada um precisa se cadastrar no app primeiro; só depois
-- alguém promove profiles.role = 'admin' manualmente no SQL Editor):
--   Badu, Sérgio Vinicius, Sgt. Tiago Raiz.
-- 'Serginho' é tratado só como possível apelido de Sérgio Vinicius, não é
-- um quarto usuário/admin separado. O match de Tiago usa '%tiago raiz%'
-- (nunca 'tiago%' sozinho) para não confundir com "Tiago Junior", que é só
-- usuário autorizado de retirada (ver AGENTS.md), não admin.
-- Lucas Rickson não é mais 'admin', é 'developer' (acesso total — ver
-- supabase/add_developer_role.sql, que ainda precisa ser executada para
-- o CHECK da coluna aceitar esse valor). Ele passa aqui pelo role check,
-- sem precisar bater nome, já que só ele pode ter esse papel.
-- IMPORTANTE (F-04): a autorizacao e baseada apenas no papel (role), nunca em
-- full_name. Nome e texto livre e falsificavel; usa-lo permitiria a um admin
-- se renomear como um aprovador legitimo e ler todos os agendamentos (com PII).
-- Quem VE a lista sao admin/developer; quem DECIDE (aprova/rejeita) continua
-- restrito ao aprovador unico via current_user_is_lead_approver(). Alinhado a
-- security_hardening_phase2.sql.
create or replace function public.current_user_is_booking_approver()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'developer')
  );
$$;

-- ---------------------------------------------------------------------
-- Reconciliação de tabela pré-existente
-- O `create table if not exists` acima NÃO altera colunas de uma tabela
-- que já existia com outra definição. Uma versão anterior desta tabela
-- usava status default 'pending' (nullable, sem check). Alinhamos aqui:
-- migra o sentinela antigo 'pending' -> 'requested' e fixa default/check.
-- Idempotente: após a 1ª execução, vira no-op.
-- ---------------------------------------------------------------------
-- RG e CPF deixaram de ser coletados. Removemos tambem as colunas historicas
-- para minimizar dados pessoais armazenados e impedir que schemas antigos
-- continuem exigindo esses campos no backend.
alter table public.studio_booking_requests
  drop column if exists requester_rg;
alter table public.studio_booking_requests
  drop column if exists requester_cpf;

alter table public.studio_booking_participants
  drop column if exists rg;
alter table public.studio_booking_participants
  drop column if exists cpf;

update public.studio_booking_requests
  set status = 'requested'
  where status is null or status = 'pending';

alter table public.studio_booking_requests
  alter column status set default 'requested';
alter table public.studio_booking_requests
  alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.studio_booking_requests'::regclass
      and conname = 'studio_booking_requests_status_check'
  ) then
    alter table public.studio_booking_requests
      add constraint studio_booking_requests_status_check
      check (status in ('requested', 'approved', 'rejected', 'cancelled'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RLS: studio_booking_requests
-- A Edge Function roda com o JWT do usuário (anon key + Authorization),
-- então estas policies valem para as escritas dela.
-- ---------------------------------------------------------------------
drop policy if exists "booking_req_insert_self"          on public.studio_booking_requests;
drop policy if exists "booking_req_select_own_or_admin"  on public.studio_booking_requests;
drop policy if exists "booking_req_update_admin"         on public.studio_booking_requests;
drop policy if exists "booking_req_delete_own_or_admin"  on public.studio_booking_requests;
drop policy if exists "Users can insert own bookings"    on public.studio_booking_requests;
drop policy if exists "Users can view own bookings"      on public.studio_booking_requests;
drop policy if exists "Admins can view all bookings"     on public.studio_booking_requests;

-- Usuário só cria solicitação em seu próprio nome.
create policy "booking_req_insert_self" on public.studio_booking_requests
for insert to authenticated
with check (requester_id = auth.uid());

-- Solicitante vê as suas; aprovadores oficiais veem todas.
create policy "booking_req_select_own_or_admin" on public.studio_booking_requests
for select to authenticated
using (requester_id = auth.uid() or public.current_user_is_booking_approver());

-- Mudança de status (aprovar/rejeitar/cancelar) é ato da diretoria.
create policy "booking_req_update_admin" on public.studio_booking_requests
for update to authenticated
using (public.current_user_is_booking_approver())
with check (public.current_user_is_booking_approver());

-- DELETE necessário para a compensação transacional da função:
-- se a assinatura falhar, a reserva é desfeita para não deixar
-- agendamento sem prova jurídica. Restrito ao dono ou admin.
create policy "booking_req_delete_own_or_admin" on public.studio_booking_requests
for delete to authenticated
using (requester_id = auth.uid() or public.current_user_is_booking_approver());

-- ---------------------------------------------------------------------
-- RLS: studio_booking_participants (herda o dono via solicitação-pai)
-- ---------------------------------------------------------------------
drop policy if exists "booking_part_insert_own"         on public.studio_booking_participants;
drop policy if exists "booking_part_select_own_or_admin" on public.studio_booking_participants;
drop policy if exists "booking_part_delete_own_or_admin" on public.studio_booking_participants;
drop policy if exists "Users can insert participants"    on public.studio_booking_participants;
drop policy if exists "Admins can view all participants" on public.studio_booking_participants;

create policy "booking_part_insert_own" on public.studio_booking_participants
for insert to authenticated
with check (
  exists (
    select 1 from public.studio_booking_requests r
    where r.id = booking_request_id and r.requester_id = auth.uid()
  )
);

create policy "booking_part_select_own_or_admin" on public.studio_booking_participants
for select to authenticated
using (
  public.current_user_is_booking_approver()
  or exists (
    select 1 from public.studio_booking_requests r
    where r.id = booking_request_id and r.requester_id = auth.uid()
  )
);

create policy "booking_part_delete_own_or_admin" on public.studio_booking_participants
for delete to authenticated
using (
  public.current_user_is_booking_approver()
  or exists (
    select 1 from public.studio_booking_requests r
    where r.id = booking_request_id and r.requester_id = auth.uid()
  )
);
