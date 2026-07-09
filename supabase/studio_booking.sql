-- =====================================================================
-- Agendamento do Estúdio ASSEGO — tabelas de solicitação e participantes
-- Execute no SQL Editor do Supabase.
--
-- ORDEM DE EXECUÇÃO:
--   1) schema.sql          (cria profiles + função current_user_role)
--   2) studio_booking.sql  (ESTE ARQUIVO)
--   3) legal_signatures.sql (referencia studio_booking_requests via FK)
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
  requester_rg       text,
  requester_cpf      text,
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
  rg        text,
  cpf       text,
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

-- Solicitante vê as suas; admin vê todas (avaliação da diretoria).
create policy "booking_req_select_own_or_admin" on public.studio_booking_requests
for select to authenticated
using (requester_id = auth.uid() or public.current_user_role() = 'admin');

-- Mudança de status (aprovar/rejeitar/cancelar) é ato da diretoria.
create policy "booking_req_update_admin" on public.studio_booking_requests
for update to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

-- DELETE necessário para a compensação transacional da função:
-- se a assinatura falhar, a reserva é desfeita para não deixar
-- agendamento sem prova jurídica. Restrito ao dono ou admin.
create policy "booking_req_delete_own_or_admin" on public.studio_booking_requests
for delete to authenticated
using (requester_id = auth.uid() or public.current_user_role() = 'admin');

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
  public.current_user_role() = 'admin'
  or exists (
    select 1 from public.studio_booking_requests r
    where r.id = booking_request_id and r.requester_id = auth.uid()
  )
);

create policy "booking_part_delete_own_or_admin" on public.studio_booking_participants
for delete to authenticated
using (
  public.current_user_role() = 'admin'
  or exists (
    select 1 from public.studio_booking_requests r
    where r.id = booking_request_id and r.requester_id = auth.uid()
  )
);
