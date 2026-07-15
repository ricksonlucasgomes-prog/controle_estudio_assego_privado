-- =====================================================================
-- ASSEGO Studio - hardening de seguranca (fase 1, aditiva)
--
-- Execute antes de publicar as Edge Functions endurecidas. Esta fase cria
-- RPCs transacionais, outbox, idempotencia e identidade do aprovador sem
-- remover as policies antigas. A fase 2 fecha o acesso direto somente depois
-- que o novo fluxo estiver validado em produção.
-- =====================================================================

create extension if not exists "pgcrypto";

begin;

-- Materiais enviados pelo solicitante ficam privados. O primeiro diretorio
-- do objeto é sempre o UUID do próprio usuário autenticado.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'booking-materials',
  'booking-materials',
  false,
  52428800,
  array['image/*', 'video/*', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "booking_materials_insert_own" on storage.objects;
drop policy if exists "booking_materials_select_own_or_staff" on storage.objects;
drop policy if exists "booking_materials_update_own" on storage.objects;
drop policy if exists "booking_materials_delete_own" on storage.objects;

create policy "booking_materials_insert_own" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'booking-materials'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "booking_materials_select_own_or_staff" on storage.objects
for select to authenticated
using (
  bucket_id = 'booking-materials'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.current_user_role() in ('admin', 'developer')
  )
);

-- Não conceder UPDATE ou DELETE ao solicitante: depois do upload, o material
-- referenciado na assinatura e no e-mail precisa permanecer imutável.

-- Identidade imutavel do aprovador principal. Nenhuma policy cliente.
create table if not exists public.lead_approvers (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.lead_approvers enable row level security;
revoke all on public.lead_approvers from anon, authenticated;

insert into public.lead_approvers (user_id)
select id
from auth.users
where lower(email) = 'ricksonlucasgomes@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.current_user_is_lead_approver()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.lead_approvers a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.current_user_is_lead_approver() from public, anon;
grant execute on function public.current_user_is_lead_approver() to authenticated;

-- Outbox duravel: gravada na mesma transacao do pedido.
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('booking_created', 'booking_status_changed', 'equipment_request_created')),
  aggregate_id uuid not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_type, aggregate_id)
);

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
grant all on public.notification_outbox to service_role;

-- Caixa de notificacoes persistente exibida no sininho do aplicativo.
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  type text not null check (type in ('booking_created', 'booking_approved', 'booking_rejected')),
  title text not null,
  message text not null,
  booking_request_id uuid references public.studio_booking_requests(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, event_key)
);

create index if not exists app_notifications_recipient_created_idx
  on public.app_notifications (recipient_id, created_at desc);

alter table public.app_notifications enable row level security;
revoke all on public.app_notifications from anon, authenticated;
grant select on public.app_notifications to authenticated;
grant update (read_at) on public.app_notifications to authenticated;
grant all on public.app_notifications to service_role;

drop policy if exists "app_notifications_select_own" on public.app_notifications;
drop policy if exists "app_notifications_mark_own" on public.app_notifications;

create policy "app_notifications_select_own" on public.app_notifications
for select to authenticated
using (recipient_id = auth.uid());

create policy "app_notifications_mark_own" on public.app_notifications
for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

do $$
begin
  begin
    alter publication supabase_realtime add table public.app_notifications;
  exception
    when duplicate_object then null;
  end;
end;
$$;

-- Atualiza instalacoes onde notification_outbox ja existia com o CHECK antigo.
do $$
declare
  v_constraint text;
begin
  select c.conname into v_constraint
  from pg_constraint c
  where c.conrelid = 'public.notification_outbox'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%event_type%';

  if v_constraint is not null then
    execute format('alter table public.notification_outbox drop constraint %I', v_constraint);
  end if;

  alter table public.notification_outbox
    add constraint notification_outbox_event_type_check
    check (event_type in ('booking_created', 'booking_status_changed', 'equipment_request_created'));
exception
  when duplicate_object then null;
end;
$$;

-- Idempotencia para impedir pedidos duplicados em reenvios/timeouts.
alter table public.studio_booking_requests
  add column if not exists idempotency_key uuid;

alter table public.studio_booking_requests
  add column if not exists requested_end_time text;

update public.studio_booking_requests
set requested_end_time = to_char(requested_time::time + interval '1 hour', 'HH24:MI')
where requested_end_time is null
  and requested_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';

create unique index if not exists studio_booking_request_idempotency_uniq
  on public.studio_booking_requests (requester_id, idempotency_key)
  where idempotency_key is not null;

alter table public.studio_equipment_requests
  add column if not exists idempotency_key uuid;

create unique index if not exists studio_equipment_request_idempotency_uniq
  on public.studio_equipment_requests (requester_id, idempotency_key)
  where idempotency_key is not null;

-- Impede corrida de duas solicitações ativas para o mesmo horário.
do $$
begin
  if exists (
    select 1
    from public.studio_booking_requests
    where status in ('requested', 'approved')
    group by requested_date, requested_time
    having count(*) > 1
  ) then
    raise exception 'Existem horarios ativos duplicados. Reconcilie-os antes da fase 1.';
  end if;
end;
$$;

create unique index if not exists studio_booking_active_slot_uniq
  on public.studio_booking_requests (requested_date, requested_time)
  where status in ('requested', 'approved');

-- Uma unica assinatura por agendamento.
do $$
begin
  if exists (
    select 1
    from public.legal_signatures
    group by booking_request_id
    having count(*) > 1
  ) then
    raise exception 'Existem assinaturas duplicadas. Reconcilie-as antes da fase 1.';
  end if;
end;
$$;

create unique index if not exists legal_signatures_one_per_booking
  on public.legal_signatures (booking_request_id);

-- Rate limit simples e atomico, acessivel apenas pelo backend.
create table if not exists public.security_rate_limits (
  actor_id uuid not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (actor_id, action)
);

alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from anon, authenticated;
grant all on public.security_rate_limits to service_role;

create or replace function public.consume_rate_limit_v1(
  p_actor_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_actor_id is null
    or length(trim(coalesce(p_action, ''))) = 0
    or p_limit < 1
    or p_window_seconds < 1
  then
    raise exception 'Parametros de rate limit invalidos.';
  end if;

  insert into public.security_rate_limits (actor_id, action, window_started_at, request_count)
  values (p_actor_id, p_action, v_now, 1)
  on conflict (actor_id, action) do update
  set window_started_at = case
        when public.security_rate_limits.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
        then v_now
        else public.security_rate_limits.window_started_at
      end,
      request_count = case
        when public.security_rate_limits.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
        then 1
        else public.security_rate_limits.request_count + 1
      end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit_v1(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit_v1(uuid, text, integer, integer)
  to service_role;

-- Cria agendamento, participantes, assinatura e outbox em uma transacao.
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
  v_requester_whatsapp := trim(coalesce(p_requester->>'whatsapp', ''));
  v_requester_social := trim(coalesce(p_requester->>'social', ''));
  v_signer_name := trim(coalesce(p_signature->>'fullName', ''));

  if length(v_requester_name) not between 3 and 160
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

  -- Serializa pedidos do mesmo dia e impede qualquer sobreposição de período.
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
    booking_request_id, full_name, email, whatsapp, social
  )
  select
    v_booking_id,
    trim(value->>'name'),
    lower(trim(value->>'email')),
    trim(value->>'whatsapp'),
    trim(value->>'social')
  from jsonb_array_elements(coalesce(p_guests, '[]'::jsonb));

  v_payload := jsonb_build_object(
    'booking_request_id', v_booking_id,
    'requester', jsonb_build_object(
      'name', v_requester_name,
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

-- Alteração de status, aviso no app e outbox de e-mail na mesma transação.
drop function if exists public.set_booking_status_v1(uuid, text);
create function public.set_booking_status_v1(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking public.studio_booking_requests%rowtype;
  v_outbox_id uuid;
  v_payload jsonb;
  v_status_label text;
begin
  if not public.current_user_is_lead_approver() then
    raise exception 'Apenas o aprovador principal pode alterar a solicitação.';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'Status inválido.';
  end if;

  select * into v_booking
  from public.studio_booking_requests
  where id = p_id
  for update;

  if not found then
    raise exception 'Solicitação inexistente.';
  end if;

  if v_booking.status = p_status then
    select id into v_outbox_id
    from public.notification_outbox
    where event_type = 'booking_status_changed'
      and aggregate_id = p_id;

    return jsonb_build_object(
      'booking_id', p_id,
      'status', p_status,
      'outbox_id', v_outbox_id,
      'idempotent_replay', true
    );
  end if;

  if v_booking.status <> 'requested' then
    raise exception 'Solicitação já finalizada.';
  end if;

  update public.studio_booking_requests
  set status = p_status
  where id = p_id;

  v_status_label := case when p_status = 'approved' then 'aprovada' else 'rejeitada' end;
  v_payload := jsonb_build_object(
    'booking_id', p_id,
    'status', p_status,
    'requester_id', v_booking.requester_id,
    'requester_name', v_booking.requester_name,
    'requester_email', v_booking.requester_email,
    'requested_date', v_booking.requested_date,
    'requested_time', v_booking.requested_time,
    'requested_end_time', v_booking.requested_end_time
  );

  insert into public.app_notifications (
    recipient_id,
    event_key,
    type,
    title,
    message,
    booking_request_id,
    metadata
  ) values (
    v_booking.requester_id,
    'booking:' || p_id::text || ':status:' || p_status,
    case when p_status = 'approved' then 'booking_approved' else 'booking_rejected' end,
    case when p_status = 'approved' then 'Gravação aprovada' else 'Solicitação não aprovada' end,
    'Sua solicitação para ' || to_char(v_booking.requested_date, 'DD/MM/YYYY') || ', das ' || v_booking.requested_time || ' às ' || coalesce(v_booking.requested_end_time, 'horário não informado') || ', foi ' || v_status_label || '.',
    p_id,
    jsonb_build_object('date', v_booking.requested_date, 'time', v_booking.requested_time, 'endTime', v_booking.requested_end_time, 'status', p_status)
  )
  on conflict (recipient_id, event_key) do nothing;

  insert into public.notification_outbox (event_type, aggregate_id, payload)
  values ('booking_status_changed', p_id, v_payload)
  on conflict (event_type, aggregate_id)
  do update set payload = excluded.payload, updated_at = now()
  returning id into v_outbox_id;

  return jsonb_build_object(
    'booking_id', p_id,
    'status', p_status,
    'outbox_id', v_outbox_id,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.set_booking_status_v1(uuid, text) from public, anon;
grant execute on function public.set_booking_status_v1(uuid, text) to authenticated;

-- Pedido de equipamento transacional e idempotente.
create or replace function public.create_equipment_request_v1(
  p_user_id uuid,
  p_auth_email text,
  p_idempotency_key uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request_id uuid;
  v_outbox_id uuid;
  v_name text := trim(coalesce(p_request->>'requesterName', ''));
  v_equipment_id text := trim(coalesce(p_request->>'equipmentId', ''));
  v_equipment_name text := trim(coalesce(p_request->>'equipmentName', ''));
  v_justification text := trim(coalesce(p_request->>'justification', ''));
begin
  if p_user_id is null or p_idempotency_key is null then
    raise exception 'Usuário e chave de idempotência são obrigatórios.';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and lower(coalesce(u.email, '')) = lower(trim(coalesce(p_auth_email, '')))
  ) then
    raise exception 'Identidade autenticada invalida.';
  end if;

  select r.id into v_request_id
  from public.studio_equipment_requests r
  where r.requester_id = p_user_id
    and r.idempotency_key = p_idempotency_key;

  if v_request_id is not null then
    return jsonb_build_object('request_id', v_request_id, 'idempotent_replay', true);
  end if;

  if length(v_name) not between 3 and 160
    or length(v_equipment_id) not between 1 and 100
    or length(v_equipment_name) not between 1 and 160
    or length(v_justification) not between 10 and 1000
  then
    raise exception 'Dados do pedido ausentes ou fora dos limites.';
  end if;

  insert into public.studio_equipment_requests (
    requester_id,
    requester_name,
    requester_email,
    equipment_id,
    equipment_name,
    justification,
    status,
    idempotency_key
  ) values (
    p_user_id,
    v_name,
    lower(trim(p_auth_email)),
    v_equipment_id,
    v_equipment_name,
    v_justification,
    'requested',
    p_idempotency_key
  ) returning id into v_request_id;

  insert into public.notification_outbox (event_type, aggregate_id, payload)
  values (
    'equipment_request_created',
    v_request_id,
    jsonb_build_object(
      'request_id', v_request_id,
      'requester_name', v_name,
      'requester_email', lower(trim(p_auth_email)),
      'equipment_id', v_equipment_id,
      'equipment_name', v_equipment_name,
      'justification', v_justification
    )
  ) returning id into v_outbox_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'outbox_id', v_outbox_id,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_equipment_request_v1(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_equipment_request_v1(uuid, text, uuid, jsonb)
  to service_role;

create or replace function public.set_equipment_request_status_v1(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.current_user_is_lead_approver() then
    raise exception 'Apenas o aprovador principal pode alterar a solicitação.';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'Status inválido.';
  end if;

  update public.studio_equipment_requests
  set status = p_status
  where id = p_id and status = 'requested';

  if not found then
    raise exception 'Solicitação inexistente ou já finalizada.';
  end if;
end;
$$;

revoke all on function public.set_equipment_request_status_v1(uuid, text) from public, anon;
grant execute on function public.set_equipment_request_status_v1(uuid, text) to authenticated;

commit;
