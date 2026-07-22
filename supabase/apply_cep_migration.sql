-- =====================================================================
-- Migração CEP — script único e consolidado (22/07/2026)
-- Cole TUDO isto no SQL Editor do Supabase e clique em Run uma única vez.
-- Faz, na ordem correta:
--   1) cria as colunas requester_cep e cep;
--   2) recria a RPC create_signed_booking_v1 já com o CEP;
--   3) recria as funções de anonimização (zerando também o CEP).
-- Idempotente e reexecutável (add column if not exists / create or replace).
-- =====================================================================

-- 1) COLUNAS ----------------------------------------------------------
alter table public.studio_booking_requests
  add column if not exists requester_cep text;
alter table public.studio_booking_participants
  add column if not exists cep text;

comment on column public.studio_booking_requests.requester_cep is
  'CEP do solicitante (8 dígitos). Coletado desde 22/07/2026. Existência validada via ViaCEP no front/Edge Function; aqui só o formato. Coberto pela anonimização.';
comment on column public.studio_booking_participants.cep is
  'CEP do convidado (8 dígitos). Coletado desde 22/07/2026. Existência validada via ViaCEP no front/Edge Function; aqui só o formato. Coberto pela anonimização.';

-- 2) RPC create_signed_booking_v1 (agora com CEP) ---------------------
create or replace function public.create_signed_booking_v1(
  p_user_id uuid,
  p_auth_email text,
  p_idempotency_key uuid,
  p_requester jsonb,
  p_guests jsonb,
  p_booking jsonb,
  p_signature jsonb,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking_id uuid;
  v_outbox_id uuid;
  v_signed_at timestamptz := clock_timestamp();
  v_requested_date date;
  v_requested_time text;
  v_requested_end_time text;
  v_requester_name text;
  v_requester_cpf text;
  v_requester_cep text;
  v_requester_whatsapp text;
  v_requester_social text;
  v_signer_name text;
  v_payload jsonb;
  v_hash text;
  v_guest jsonb;
  v_guest_count integer;
begin
  if p_user_id is null or p_idempotency_key is null then
    raise exception 'Usuário e chave de idempotência são obrigatórios.';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and lower(coalesce(u.email, '')) = lower(trim(coalesce(p_auth_email, '')))
  ) then
    raise exception 'Identidade autenticada inválida.';
  end if;

  select r.id into v_booking_id
  from public.studio_booking_requests r
  where r.requester_id = p_user_id
    and r.idempotency_key = p_idempotency_key;

  if v_booking_id is not null then
    select s.payload_hash into v_hash
    from public.legal_signatures s
    where s.booking_request_id = v_booking_id;

    select o.id into v_outbox_id
    from public.notification_outbox o
    where o.event_type = 'booking_created'
      and o.aggregate_id = v_booking_id;

    return jsonb_build_object(
      'booking_id', v_booking_id,
      'signature_hash', v_hash,
      'outbox_id', v_outbox_id,
      'idempotent_replay', true
    );
  end if;

  if coalesce((p_signature->>'acceptedTerms')::boolean, false) is not true then
    raise exception 'O termo precisa ser aceito.';
  end if;

  v_requester_name := trim(coalesce(p_requester->>'name', ''));
  v_requester_cpf := trim(coalesce(p_requester->>'cpf', ''));
  v_requester_cep := trim(coalesce(p_requester->>'cep', ''));
  v_requester_whatsapp := trim(coalesce(p_requester->>'whatsapp', ''));
  v_requester_social := trim(coalesce(p_requester->>'social', ''));
  v_signer_name := trim(coalesce(p_signature->>'fullName', ''));

  if length(v_requester_name) not between 3 and 160
    or length(regexp_replace(v_requester_cpf, '\D', '', 'g')) <> 11
    or length(regexp_replace(v_requester_cep, '\D', '', 'g')) <> 8
    or length(v_requester_whatsapp) not between 8 and 30
    or length(v_requester_social) not between 2 and 120
    or length(v_signer_name) not between 3 and 160
  then
    raise exception 'Dados obrigatórios ausentes ou fora dos limites.';
  end if;

  if lower(v_signer_name) <> lower(v_requester_name) then
    raise exception 'A assinatura deve corresponder ao nome do solicitante.';
  end if;

  begin
    v_requested_date := (p_booking->>'date')::date;
  exception when others then
    raise exception 'Data de agendamento inválida.';
  end;

  v_requested_time := trim(coalesce(p_booking->>'time', ''));
  v_requested_end_time := trim(coalesce(p_booking->>'endTime', ''));
  if v_requested_date < current_date
    or v_requested_date > current_date + 365
    or not (
      (
        v_requested_time in ('09:00', '10:00', '11:00')
        and v_requested_end_time in ('10:00', '11:00', '12:00')
        and v_requested_end_time > v_requested_time
      )
      or (
        v_requested_time in ('13:00', '14:00', '15:00', '16:00')
        and v_requested_end_time in ('14:00', '15:00', '16:00', '17:00')
        and v_requested_end_time > v_requested_time
      )
      or (
        v_requested_time ~ '^(17:30|1[89]:(00|30)|2[0-2]:(00|30)|23:00)$'
        and v_requested_end_time ~ '^(1[89]:(00|30)|2[0-2]:(00|30)|23:(00|30))$'
        and v_requested_end_time > v_requested_time
      )
    )
  then
    raise exception 'Data ou período fora da agenda permitida.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_requested_date::text));
  if exists (
    select 1
    from public.studio_booking_requests r
    where r.requested_date = v_requested_date
      and r.status in ('requested', 'approved')
      and r.requested_time < v_requested_end_time
      and coalesce(
        r.requested_end_time,
        case
          when r.requested_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            then to_char(r.requested_time::time + interval '1 hour', 'HH24:MI')
          else r.requested_time
        end
      ) > v_requested_time
  ) then
    raise exception 'O período solicitado conflita com outro agendamento ativo.';
  end if;

  if jsonb_typeof(coalesce(p_guests, '[]'::jsonb)) <> 'array' then
    raise exception 'A lista de convidados é inválida.';
  end if;

  v_guest_count := jsonb_array_length(coalesce(p_guests, '[]'::jsonb));
  if v_guest_count > 20 then
    raise exception 'Limite de 20 convidados excedido.';
  end if;

  for v_guest in select value from jsonb_array_elements(coalesce(p_guests, '[]'::jsonb))
  loop
    if length(trim(coalesce(v_guest->>'name', ''))) not between 3 and 160
      or length(regexp_replace(trim(coalesce(v_guest->>'cpf', '')), '\D', '', 'g')) <> 11
      or length(regexp_replace(trim(coalesce(v_guest->>'cep', '')), '\D', '', 'g')) <> 8
      or length(trim(coalesce(v_guest->>'email', ''))) not between 5 and 254
      or length(trim(coalesce(v_guest->>'whatsapp', ''))) not between 8 and 30
      or length(trim(coalesce(v_guest->>'social', ''))) not between 2 and 120
    then
      raise exception 'Convidado com dados ausentes ou fora dos limites.';
    end if;
  end loop;

  insert into public.studio_booking_requests (
    requester_id,
    requester_name,
    requester_cpf,
    requester_cep,
    requester_email,
    requester_whatsapp,
    requester_social,
    requested_date,
    requested_time,
    requested_end_time,
    status,
    lgpd_accepted_at,
    idempotency_key
  ) values (
    p_user_id,
    v_requester_name,
    v_requester_cpf,
    v_requester_cep,
    lower(trim(p_auth_email)),
    v_requester_whatsapp,
    v_requester_social,
    v_requested_date,
    v_requested_time,
    v_requested_end_time,
    'requested',
    v_signed_at,
    p_idempotency_key
  ) returning id into v_booking_id;

  insert into public.studio_booking_participants (
    booking_request_id, full_name, cpf, cep, email, whatsapp, social
  )
  select
    v_booking_id,
    trim(value->>'name'),
    trim(value->>'cpf'),
    trim(value->>'cep'),
    lower(trim(value->>'email')),
    trim(value->>'whatsapp'),
    trim(value->>'social')
  from jsonb_array_elements(coalesce(p_guests, '[]'::jsonb));

  v_payload := jsonb_build_object(
    'booking_request_id', v_booking_id,
    'requester', jsonb_build_object(
      'name', v_requester_name,
      'cpf', v_requester_cpf,
      'cep', v_requester_cep,
      'email', lower(trim(p_auth_email)),
      'whatsapp', v_requester_whatsapp,
      'social', v_requester_social
    ),
    'guests', coalesce(p_guests, '[]'::jsonb),
    'booking_details', jsonb_build_object(
      'date', v_requested_date,
      'time', v_requested_time,
      'endTime', v_requested_end_time,
      'scheduleType', case when v_requested_time > '17:00' then 'after_hours' else 'regular' end,
      'program', coalesce(p_booking->'program', '{}'::jsonb),
      'materials', coalesce(p_booking->'materials', '[]'::jsonb),
      'materialLinks', coalesce(p_booking->'materialLinks', '[]'::jsonb)
    ),
    'document_name', 'Termo_de_Uso_Assego.pdf',
    'signer_name', v_signer_name,
    'signer_email', lower(trim(p_auth_email)),
    'accepted_terms', true,
    'signed_at', v_signed_at
  );

  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.legal_signatures (
    booking_request_id,
    signer_id,
    signer_name,
    signer_email,
    document_name,
    accepted,
    payload,
    payload_hash,
    ip_address,
    user_agent,
    signed_at
  ) values (
    v_booking_id,
    p_user_id,
    v_signer_name,
    lower(trim(p_auth_email)),
    'Termo_de_Uso_Assego.pdf',
    true,
    v_payload,
    v_hash,
    left(coalesce(p_ip, ''), 128),
    left(coalesce(p_user_agent, ''), 512),
    v_signed_at
  );

  insert into public.notification_outbox (event_type, aggregate_id, payload)
  values ('booking_created', v_booking_id, v_payload)
  returning id into v_outbox_id;

  insert into public.app_notifications (
    recipient_id,
    event_key,
    type,
    title,
    message,
    booking_request_id,
    metadata
  )
  select
    p.id,
    'booking:' || v_booking_id::text || ':created',
    'booking_created',
    'Nova solicitação de gravação',
    v_requester_name || ' solicitou o estúdio para ' || to_char(v_requested_date, 'DD/MM/YYYY') || ', das ' || v_requested_time || ' às ' || v_requested_end_time || '.',
    v_booking_id,
    jsonb_build_object('date', v_requested_date, 'time', v_requested_time, 'endTime', v_requested_end_time, 'requesterName', v_requester_name)
  from public.profiles p
  where p.role in ('admin', 'developer')
  on conflict (recipient_id, event_key) do nothing;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'signature_hash', v_hash,
    'outbox_id', v_outbox_id,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_signed_booking_v1(
  uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_signed_booking_v1(
  uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) to service_role;

-- 3) ANONIMIZAÇÃO (agora também zera o CEP) ---------------------------
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
  with anonymized as (
    update public.studio_booking_requests r
    set requester_name = '[dados removidos]',
        requester_cpf = null,
        requester_cep = null,
        requester_email = null,
        requester_whatsapp = null,
        requester_social = null
    where r.status in ('approved', 'rejected', 'cancelled')
      and r.requested_date < v_cutoff_date
      and r.requester_name is distinct from '[dados removidos]'
    returning r.id
  )
  select count(*) into v_bookings from anonymized;

  with anonymized as (
    update public.studio_booking_participants p
    set full_name = '[dados removidos]',
        cpf = null,
        cep = null,
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

  with deleted as (
    delete from public.notification_outbox o
    where o.status = 'sent'
      and coalesce(o.sent_at, o.created_at) < v_cutoff_ts
    returning o.id
  )
  select count(*) into v_outbox from deleted;

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
        requester_cep = null,
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
        cep = null,
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
