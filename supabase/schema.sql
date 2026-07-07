-- Controle de Equipamentos do Estudio ASSEGO
-- Execute este arquivo no SQL Editor do Supabase.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'viewer' check (role in ('admin', 'borrower', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Geral',
  patrimony_code text,
  serial_number text,
  location text not null default 'Estudio',
  status text not null default 'available' check (status in ('available', 'borrowed', 'maintenance', 'missing')),
  image_url text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_loans (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  borrower_name text not null,
  checkout_notes text,
  checked_out_by uuid not null references auth.users(id),
  checked_out_at timestamptz not null default now(),
  expected_return_at timestamptz,
  returned_by uuid references auth.users(id),
  returned_at timestamptz,
  return_notes text
);

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  checklist_type text not null default 'closing' check (checklist_type in ('opening', 'closing', 'inventory')),
  status text not null default 'draft' check (status in ('draft', 'completed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  equipment_id uuid references public.equipment(id),
  label text not null,
  is_checked boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.equipment enable row level security;
alter table public.equipment_loans enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer');
$$;

create policy "profiles_select_authenticated" on public.profiles
for select to authenticated using (true);

create policy "profiles_insert_self" on public.profiles
for insert to authenticated with check (id = auth.uid());

create policy "profiles_update_admin" on public.profiles
for update to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

create policy "equipment_select_authenticated" on public.equipment
for select to authenticated using (true);

create policy "equipment_insert_staff" on public.equipment
for insert to authenticated with check (public.current_user_role() in ('admin', 'borrower'));

create policy "equipment_update_staff" on public.equipment
for update to authenticated using (public.current_user_role() in ('admin', 'borrower')) with check (public.current_user_role() in ('admin', 'borrower'));

create policy "loans_select_authenticated" on public.equipment_loans
for select to authenticated using (true);

create policy "loans_insert_staff" on public.equipment_loans
for insert to authenticated with check (public.current_user_role() in ('admin', 'borrower'));

create policy "loans_update_staff" on public.equipment_loans
for update to authenticated using (public.current_user_role() in ('admin', 'borrower')) with check (public.current_user_role() in ('admin', 'borrower'));

create policy "checklists_select_authenticated" on public.checklists
for select to authenticated using (true);

create policy "checklists_insert_staff" on public.checklists
for insert to authenticated with check (public.current_user_role() in ('admin', 'borrower'));

create policy "checklists_update_staff" on public.checklists
for update to authenticated using (public.current_user_role() in ('admin', 'borrower')) with check (public.current_user_role() in ('admin', 'borrower'));

create policy "items_select_authenticated" on public.checklist_items
for select to authenticated using (true);

create policy "items_insert_staff" on public.checklist_items
for insert to authenticated with check (public.current_user_role() in ('admin', 'borrower'));

create policy "items_update_staff" on public.checklist_items
for update to authenticated using (public.current_user_role() in ('admin', 'borrower')) with check (public.current_user_role() in ('admin', 'borrower'));

create policy "audit_select_authenticated" on public.audit_logs
for select to authenticated using (true);

create policy "audit_insert_authenticated" on public.audit_logs
for insert to authenticated with check (actor_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case
      when lower(new.email) = 'ricksonlucasgomes@gmail.com' then 'admin'
      else 'viewer'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Depois que os usuarios criarem login, rode updates como estes:
-- update public.profiles set role = 'admin', full_name = 'Lucas' where id = '<uuid_do_lucas>';
-- update public.profiles set role = 'borrower', full_name = 'Sergio Vinicius' where id = '<uuid_do_sergio>';
-- update public.profiles set role = 'borrower', full_name = 'Badu' where id = '<uuid_do_badu>';

update public.profiles p
set role = 'admin', full_name = 'Lucas Rickson'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'ricksonlucasgomes@gmail.com';

-- Dados compartilhados da tela atual do estudio.
-- Mantem o modelo simples do App.tsx e substitui o localStorage entre aparelhos.
create table if not exists public.studio_checklist (
  item_id text primary key,
  checked boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_checkouts (
  item_id text primary key,
  user_name text not null,
  user_id uuid references auth.users(id),
  qty int not null default 1,
  photo text,
  taken_at timestamptz not null default now()
);

create table if not exists public.studio_observations (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_conferences (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  author_id uuid references auth.users(id),
  checked_ids text[] not null default '{}',
  missing_ids text[] not null default '{}',
  notes text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.studio_media (
  id uuid primary key default gen_random_uuid(),
  equipment_id text not null default 'geral',
  title text not null,
  photo text,
  added_by text,
  added_by_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.studio_checklist enable row level security;
alter table public.studio_checkouts enable row level security;
alter table public.studio_observations enable row level security;
alter table public.studio_conferences enable row level security;
alter table public.studio_media enable row level security;

drop policy if exists "sel_checklist" on public.studio_checklist;
drop policy if exists "wr_checklist" on public.studio_checklist;
drop policy if exists "sel_checkouts" on public.studio_checkouts;
drop policy if exists "wr_checkouts" on public.studio_checkouts;
drop policy if exists "sel_obs" on public.studio_observations;
drop policy if exists "wr_obs" on public.studio_observations;
drop policy if exists "sel_conf" on public.studio_conferences;
drop policy if exists "wr_conf" on public.studio_conferences;
drop policy if exists "sel_media" on public.studio_media;
drop policy if exists "wr_media" on public.studio_media;

create policy "sel_checklist" on public.studio_checklist
for select to authenticated using (true);
create policy "wr_checklist" on public.studio_checklist
for all to authenticated
using (public.current_user_role() in ('admin', 'borrower'))
with check (public.current_user_role() in ('admin', 'borrower'));

create policy "sel_checkouts" on public.studio_checkouts
for select to authenticated using (true);
create policy "wr_checkouts" on public.studio_checkouts
for all to authenticated
using (public.current_user_role() in ('admin', 'borrower'))
with check (public.current_user_role() in ('admin', 'borrower'));

create policy "sel_obs" on public.studio_observations
for select to authenticated using (true);
create policy "wr_obs" on public.studio_observations
for all to authenticated
using (public.current_user_role() in ('admin', 'borrower'))
with check (public.current_user_role() in ('admin', 'borrower'));

create policy "sel_conf" on public.studio_conferences
for select to authenticated using (true);
create policy "wr_conf" on public.studio_conferences
for all to authenticated
using (public.current_user_role() in ('admin', 'borrower'))
with check (public.current_user_role() in ('admin', 'borrower'));

create policy "sel_media" on public.studio_media
for select to authenticated using (true);
create policy "wr_media" on public.studio_media
for all to authenticated
using (public.current_user_role() in ('admin', 'borrower'))
with check (public.current_user_role() in ('admin', 'borrower'));

do $$
begin
  alter publication supabase_realtime add table public.studio_checklist;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_checkouts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_observations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_conferences;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.studio_media;
exception when duplicate_object then null;
end $$;
