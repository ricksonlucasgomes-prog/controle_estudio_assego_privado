-- =====================================================================
-- Reintrodução do CPF no fluxo de agendamento
-- Data: 21/07/2026
--
-- DECISÃO CONSCIENTE, registrada a pedido do responsável pelo sistema
-- (Lucas Rickson): o CPF do solicitante e de cada convidado volta a ser
-- coletado, armazenado e enviado no e-mail de notificação.
--
-- Isto REVERTE PARCIALMENTE a medida de minimização de dados aplicada
-- anteriormente em `studio_booking.sql` (que dropou `requester_cpf` e
-- `cpf`) e em `remove_booking_rg.sql`. A reversão é DELIBERADA e limitada:
--   * CPF  -> volta a ser coletado;
--   * RG   -> PERMANECE FORA da coleta (não recriar `requester_rg`/`rg`).
--
-- Consequência de privacidade conhecida e aceita: o CPF de terceiros
-- (convidados) volta a trafegar em e-mail de texto puro. Em contrapartida,
-- as novas colunas foram incluídas na rotina de retenção/anonimização em
-- `data_retention.sql`, para que o CPF não fique no banco indefinidamente.
--
-- ORDEM DE APLICAÇÃO (importante):
--   1) ESTE arquivo (cria as colunas);
--   2) `security_hardening_phase1.sql` (a RPC create_signed_booking_v1
--      atualizada JÁ INSERE nessas colunas — se rodar antes, quebra);
--   3) `data_retention.sql` (expurgo cobrindo os novos campos).
--
-- ATENÇÃO — ARMADILHA CONHECIDA: `studio_booking.sql` continua contendo
-- `drop column if exists requester_cpf` / `drop column if exists cpf`.
-- Se aquele arquivo for reexecutado DEPOIS deste, as colunas de CPF são
-- dropadas de novo e o recurso quebra silenciosamente. Reaplique este
-- arquivo caso isso aconteça.
--
-- Não destrutivo e reexecutável (add column if not exists).
-- =====================================================================

begin;

alter table public.studio_booking_requests
  add column if not exists requester_cpf text;

alter table public.studio_booking_participants
  add column if not exists cpf text;

comment on column public.studio_booking_requests.requester_cpf is
  'CPF do solicitante. Recoletado desde 21/07/2026 por decisão do responsável (reverte a minimização anterior). Coberto pela anonimização em purge_expired_booking_pii_v1/anonymize_titular_pii_v1.';

comment on column public.studio_booking_participants.cpf is
  'CPF do convidado. Recoletado desde 21/07/2026 por decisão do responsável (reverte a minimização anterior). Coberto pela anonimização em purge_expired_booking_pii_v1/anonymize_titular_pii_v1.';

commit;

-- ---------------------------------------------------------------------
-- Conferência pós-aplicação: as duas colunas devem aparecer, e as de RG
-- devem continuar ausentes.
-- ---------------------------------------------------------------------
-- select table_name, column_name, is_nullable
--   from information_schema.columns
--  where table_schema = 'public'
--    and column_name in ('requester_cpf', 'cpf', 'requester_rg', 'rg');

-- ---------------------------------------------------------------------
-- As colunas nascem NULLABLE de propósito: linhas antigas (criadas no
-- período sem coleta de CPF) ficam com NULL e um `not null` falharia.
-- Só considere tornar obrigatório no banco DEPOIS de conferir que não há
-- linha pendente — rode as duas contagens abaixo e só siga se derem 0:
-- ---------------------------------------------------------------------
-- select count(*) as bookings_sem_cpf
--   from public.studio_booking_requests where requester_cpf is null;
-- select count(*) as convidados_sem_cpf
--   from public.studio_booking_participants where cpf is null;
--
-- Se ambas retornarem 0 e o responsável autorizar:
-- alter table public.studio_booking_requests
--   alter column requester_cpf set not null;
-- alter table public.studio_booking_participants
--   alter column cpf set not null;
