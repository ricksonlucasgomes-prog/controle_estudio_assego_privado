-- =====================================================================
-- CORREÇÃO CRÍTICA — Aprovação por UUID (não por full_name) e
-- resolução do conflito das duas policies de UPDATE de agendamento.
--
-- STATUS: PROPOSTA — NÃO EXECUTADA. Revisar com o Lucas antes de rodar.
-- Decisão registrada (2026-07): SOMENTE o Lucas aprova/rejeita
-- agendamentos e retiradas. Badu, Sérgio Vinicius e Sgt. Tiago Raiz
-- continuam VENDO as listas (por role = 'admin'), mas não aprovam.
--
-- Problemas que este arquivo corrige:
--   #1  current_user_is_lead_approver() e current_user_is_booking_approver()
--       autorizavam por lower(full_name) like 'lucas%' / 'badu' / etc.
--       Como profiles_update_admin (schema.sql) deixa qualquer admin dar
--       UPDATE em qualquer profile, um admin podia se renomear para
--       "Lucas..." e virar aprovador único. Escalada de privilégio.
--   #2  booking_req_update_admin era criada 2x com corpos diferentes
--       (studio_booking.sql -> is_booking_approver; equipment_access.sql
--       -> is_lead_approver). Qual valia dependia da ordem de execução.
--
-- Rodar no SQL Editor DEPOIS de schema.sql, studio_booking.sql,
-- equipment_access.sql e add_developer_role.sql. Idempotente/reexecutável.
--
-- IMPORTANTE (durabilidade do fix #2): para que reexecutar studio_booking.sql
-- não reintroduza o conflito, a linha do booking_req_update_admin naquele
-- arquivo também precisa passar a usar current_user_is_lead_approver().
-- Edição separada, a combinar com o Lucas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) CHECAGEM (rode ANTES; não altera nada). Deve listar SÓ o Lucas.
--    Confirme o id/e-mail antes de setar a flag no passo 6.
-- ---------------------------------------------------------------------
-- select p.id, p.full_name, p.role, u.email
--   from public.profiles p
--   join auth.users u on u.id = p.id
--   where lower(u.email) = 'ricksonlucasgomes@gmail.com'
--      or lower(p.full_name) like 'lucas%'
--      or p.role = 'developer';

-- ---------------------------------------------------------------------
-- 1) Flag de aprovador único — por UUID, nunca por nome.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_lead_approver boolean not null default false;

-- ---------------------------------------------------------------------
-- 2) Aprovador único = quem tem a flag (identificado por auth.uid()).
--    Deixa de depender de lower(full_name) like 'lucas%'.
-- ---------------------------------------------------------------------
create or replace function public.current_user_is_lead_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_lead_approver = true
  );
$$;

-- ---------------------------------------------------------------------
-- 3) Quem VÊ todas as solicitações (não muda quem APROVA): admin/developer.
--    Identificado por ROLE — atribuído só manualmente no SQL Editor — sem
--    match de full_name. Remove o spoofing de nome também na leitura.
-- ---------------------------------------------------------------------
create or replace function public.current_user_is_booking_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'developer')
  );
$$;

-- ---------------------------------------------------------------------
-- 4) Policy de UPDATE de agendamento: DEFINIDA UMA ÚNICA VEZ, só aprovador
--    único. Resolve o conflito (studio_booking.sql vs equipment_access.sql).
--    equip_req_update_lead_approver (equipment_access.sql) já usa a mesma
--    função — nada a fazer para retirada.
-- ---------------------------------------------------------------------
drop policy if exists "booking_req_update_admin" on public.studio_booking_requests;
create policy "booking_req_update_admin" on public.studio_booking_requests
for update to authenticated
using (public.current_user_is_lead_approver())
with check (public.current_user_is_lead_approver());

-- ---------------------------------------------------------------------
-- 5) BLINDAGEM anti-escalada: impede o app de alterar role / is_lead_approver
--    de QUALQUER profile. Só service_role (SQL Editor) muda essas colunas.
--    full_name fica livre de propósito — como a autorização não olha mais o
--    nome, renomear não dá poder nenhum.
-- ---------------------------------------------------------------------
create or replace function public.protect_privileged_profile_cols()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SQL Editor / backend com service_role: liberado.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_lead_approver is distinct from old.is_lead_approver then
    raise exception
      'Alteracao de role/is_lead_approver nao e permitida pelo app (somente SQL Editor).';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_cols on public.profiles;
create trigger trg_protect_profile_cols
  before update on public.profiles
  for each row execute function public.protect_privileged_profile_cols();

-- ---------------------------------------------------------------------
-- 6) Marcar o Lucas como aprovador único (rode DEPOIS de conferir o passo 0).
-- ---------------------------------------------------------------------
-- update public.profiles set is_lead_approver = true
--   where id = (select id from auth.users
--               where lower(email) = 'ricksonlucasgomes@gmail.com');
--
-- Garantia de exclusividade (zera qualquer outro que por engano esteja true):
-- update public.profiles set is_lead_approver = false
--   where id <> (select id from auth.users
--                where lower(email) = 'ricksonlucasgomes@gmail.com');
--
-- Conferência final (deve retornar exatamente 1 linha, a do Lucas):
-- select p.id, u.email, p.is_lead_approver
--   from public.profiles p join auth.users u on u.id = p.id
--   where p.is_lead_approver = true;
