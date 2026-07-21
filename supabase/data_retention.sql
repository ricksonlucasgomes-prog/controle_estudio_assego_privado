-- =====================================================================
-- Retenção e eliminação de dados pessoais (LGPD art. 15, 16 e 18)
-- Execute no SQL Editor do Supabase DEPOIS de:
--   1) schema.sql
--   2) studio_booking.sql
--   3) legal_signatures.sql
--   4) security_hardening_phase1.sql / phase2.sql
--   5) equipment_access.sql
-- Reexecutável (create or replace / idempotente).
--
-- PRINCÍPIO: guardar dado pessoal apenas pelo tempo necessário à finalidade.
-- Depois da janela de retenção, a PII operacional é ANONIMIZADA no lugar
-- (não some a linha, para não quebrar histórico/estatística e a FK da
-- assinatura), enquanto a trilha `legal_signatures` permanece intacta —
-- base legal de guarda: cumprimento de obrigação/defesa de direitos
-- (LGPD art. 7º, VI e art. 16, I). A assinatura é a prova de não-repúdio.
-- Observação: o RG não é mais coletado pelo app. O CPF VOLTOU a ser
-- coletado em 21/07/2026 por decisão do responsável (ver
-- supabase/readd_booking_cpf.sql) e por isso `requester_cpf` e `cpf`
-- entram na anonimização abaixo, junto com os demais dados pessoais.
-- Pré-requisito: rode `readd_booking_cpf.sql` ANTES deste arquivo, senão
-- as colunas não existem e as funções falham ao ser criadas.
-- =====================================================================

create extension if not exists "pgcrypto";

begin;

-- Marcador usado para tornar a anonimização idempotente (não reprocessa
-- linhas já anonimizadas) e legível para quem audita a tabela.
-- '[dados removidos]'

-- ---------------------------------------------------------------------
-- 1) Expurgo periódico por tempo de retenção.
--    p_retention_months: quantos meses manter a PII após o encerramento
--    da finalidade. Padrão: 6 meses. Ajuste conforme política da ASSEGO.
-- ---------------------------------------------------------------------
create or replace function public.purge_expired_booking_pii_v1(
  p_retention_months integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cutoff_ts timestamptz := clock_timestamp() - make_interval(months => greatest(p_retention_months, 1));
  v_cutoff_date date := (clock_timestamp() - make_interval(months => greatest(p_retention_months, 1)))::date;
  v_bookings integer := 0;
  v_participants integer := 0;
  v_equipment integer := 0;
  v_checkout_hist integer := 0;
  v_outbox integer := 0;
  v_app_notif integer := 0;
begin
  -- Solicitações de agendamento já finalizadas e fora da janela: anonimiza a
  -- PII do solicitante. A linha e a assinatura correspondente continuam.
  with anonymized as (
    update public.studio_booking_requests r
    set requester_name = '[dados removidos]',
        requester_cpf = null,
        requester_email = null,
        requester_whatsapp = null,
        requester_social = null
    where r.status in ('approved', 'rejected', 'cancelled')
      and r.requested_date < v_cutoff_date
      and r.requester_name is distinct from '[dados removidos]'
    returning r.id
  )
  select count(*) into v_bookings from anonymized;

  -- Participantes/convidados das solicitações fora da janela.
  with anonymized as (
    update public.studio_booking_participants p
    set full_name = '[dados removidos]',
        cpf = null,
        email = null,
        whatsapp = null,
        social = null
    from public.studio_booking_requests r
    where p.booking_request_id = r.id
      and r.status in ('approved', 'rejected', 'cancelled')
      and r.requested_date < v_cutoff_date
      and p.full_name is distinct from '[dados removidos]'
    returning p.id
  )
  select count(*) into v_participants from anonymized;

  -- Pedidos de equipamento finalizados fora da janela.
  with anonymized as (
    update public.studio_equipment_requests e
    set requester_name = '[dados removidos]',
        requester_email = null
    where e.status in ('approved', 'rejected')
      and e.created_at < v_cutoff_ts
      and e.requester_name is distinct from '[dados removidos]'
    returning e.id
  )
  select count(*) into v_equipment from anonymized;

  -- Histórico de retiradas encerradas (guarda nome/e-mail/foto base64).
  with anonymized as (
    update public.studio_checkout_history h
    set user_name = '[dados removidos]',
        user_email = null,
        photo = null
    where h.returned_at < v_cutoff_ts
      and h.user_name is distinct from '[dados removidos]'
    returning h.id
  )
  select count(*) into v_checkout_hist from anonymized;

  -- Fila de notificações já entregues: o payload carrega PII (nome, e-mail,
  -- WhatsApp de convidados). Depois de enviada e fora da janela, apaga.
  with deleted as (
    delete from public.notification_outbox o
    where o.status = 'sent'
      and coalesce(o.sent_at, o.created_at) < v_cutoff_ts
    returning o.id
  )
  select count(*) into v_outbox from deleted;

  -- Avisos do sininho já lidos e fora da janela.
  with deleted as (
    delete from public.app_notifications n
    where n.read_at is not null
      and n.created_at < v_cutoff_ts
    returning n.id
  )
  select count(*) into v_app_notif from deleted;

  return jsonb_build_object(
    'cutoff_date', v_cutoff_date,
    'bookings_anonymized', v_bookings,
    'participants_anonymized', v_participants,
    'equipment_requests_anonymized', v_equipment,
    'checkout_history_anonymized', v_checkout_hist,
    'notification_outbox_deleted', v_outbox,
    'app_notifications_deleted', v_app_notif
  );
end;
$$;

revoke all on function public.purge_expired_booking_pii_v1(integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_booking_pii_v1(integer)
  to service_role;

-- ---------------------------------------------------------------------
-- 2) Atendimento a pedido de eliminação do titular (LGPD art. 18, VI).
--    Anonimiza TODA a PII operacional de um titular específico, sob demanda,
--    independente da janela de retenção. Restrito ao aprovador principal
--    (controlador media o pedido). A `legal_signatures` é preservada
--    (base legal de guarda), mas registra-se em audit_logs que a eliminação
--    foi atendida.
-- ---------------------------------------------------------------------
create or replace function public.anonymize_titular_pii_v1(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bookings integer := 0;
  v_participants integer := 0;
  v_equipment integer := 0;
  v_checkouts integer := 0;
  v_checkout_hist integer := 0;
begin
  if not public.current_user_is_lead_approver() then
    raise exception 'Apenas o aprovador principal pode atender pedidos de eliminação.';
  end if;
  if p_user_id is null then
    raise exception 'Titular (user_id) é obrigatório.';
  end if;

  with anonymized as (
    update public.studio_booking_requests r
    set requester_name = '[dados removidos]',
        requester_cpf = null,
        requester_email = null,
        requester_whatsapp = null,
        requester_social = null
    where r.requester_id = p_user_id
      and r.requester_name is distinct from '[dados removidos]'
    returning r.id
  )
  select count(*) into v_bookings from anonymized;

  with anonymized as (
    update public.studio_booking_participants p
    set full_name = '[dados removidos]',
        cpf = null,
        email = null,
        whatsapp = null,
        social = null
    from public.studio_booking_requests r
    where p.booking_request_id = r.id
      and r.requester_id = p_user_id
      and p.full_name is distinct from '[dados removidos]'
    returning p.id
  )
  select count(*) into v_participants from anonymized;

  with anonymized as (
    update public.studio_equipment_requests e
    set requester_name = '[dados removidos]',
        requester_email = null
    where e.requester_id = p_user_id
      and e.requester_name is distinct from '[dados removidos]'
    returning e.id
  )
  select count(*) into v_equipment from anonymized;

  with anonymized as (
    update public.studio_checkouts c
    set user_name = '[dados removidos]',
        user_email = null,
        photo = null
    where c.user_id = p_user_id
      and c.user_name is distinct from '[dados removidos]'
    returning c.item_id
  )
  select count(*) into v_checkouts from anonymized;

  with anonymized as (
    update public.studio_checkout_history h
    set user_name = '[dados removidos]',
        user_email = null,
        photo = null
    where h.user_id = p_user_id
      and h.user_name is distinct from '[dados removidos]'
    returning h.id
  )
  select count(*) into v_checkout_hist from anonymized;

  insert into public.audit_logs (actor_id, action, entity, entity_id, details)
  values (
    auth.uid(),
    'lgpd_erasure_fulfilled',
    'titular',
    p_user_id,
    jsonb_build_object(
      'bookings_anonymized', v_bookings,
      'participants_anonymized', v_participants,
      'equipment_requests_anonymized', v_equipment,
      'checkouts_anonymized', v_checkouts,
      'checkout_history_anonymized', v_checkout_hist,
      'note', 'legal_signatures preservada por base legal de guarda (defesa de direitos).'
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'bookings_anonymized', v_bookings,
    'participants_anonymized', v_participants,
    'equipment_requests_anonymized', v_equipment,
    'checkouts_anonymized', v_checkouts,
    'checkout_history_anonymized', v_checkout_hist
  );
end;
$$;

revoke all on function public.anonymize_titular_pii_v1(uuid) from public, anon;
grant execute on function public.anonymize_titular_pii_v1(uuid) to authenticated;

commit;

-- ---------------------------------------------------------------------
-- 3) Agendamento diário do expurgo (SQL puro, sem Edge Function).
--    Requer a extensão pg_cron habilitada em Database > Extensions.
--    Ajuste o número de meses no corpo do job conforme a política oficial.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'assego-purge-expired-pii-daily';

  perform cron.schedule(
    'assego-purge-expired-pii-daily',
    '30 4 * * *', -- 04:30 UTC (01:30 em Brasília), fora do horário de pico
    $cron$ select public.purge_expired_booking_pii_v1(6); $cron$
  );
end;
$$;

-- Conferir / rodar manualmente:
-- select public.purge_expired_booking_pii_v1(6);            -- expurgo por janela
-- select public.anonymize_titular_pii_v1('<uuid_do_titular>'); -- pedido do titular
-- select * from cron.job where jobname = 'assego-purge-expired-pii-daily';
-- select cron.unschedule('assego-purge-expired-pii-daily');
