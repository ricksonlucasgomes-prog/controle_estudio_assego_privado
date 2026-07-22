-- =====================================================================
-- Inclusão do CEP no fluxo de agendamento
-- Data: 22/07/2026
--
-- DECISÃO do responsável pelo sistema (Lucas Rickson): além dos dados já
-- coletados, o CEP do solicitante e de cada convidado passa a ser
-- coletado, armazenado e enviado no e-mail de notificação. A validação de
-- EXISTÊNCIA do CEP (consulta à API pública ViaCEP) é feita nas camadas
-- que têm acesso a rede — front-end e Edge Function `submit-booking`. Esta
-- camada de banco só garante o FORMATO (8 dígitos), do mesmo modo que a
-- RPC já só confere os 11 dígitos do CPF (sem validar dígito verificador).
--
-- Consequência de privacidade conhecida e aceita: o CEP é dado pessoal
-- (compõe endereço) e volta a trafegar no e-mail de texto puro junto com
-- os demais campos. Em contrapartida, as novas colunas foram incluídas na
-- rotina de retenção/anonimização em `data_retention.sql`, para que o CEP
-- não fique no banco indefinidamente.
--
-- ORDEM DE APLICAÇÃO (importante):
--   1) ESTE arquivo (cria as colunas);
--   2) `security_hardening_phase1.sql` (a RPC create_signed_booking_v1
--      atualizada JÁ INSERE nessas colunas — se rodar antes, quebra);
--   3) `data_retention.sql` (expurgo cobrindo os novos campos).
--
-- Não destrutivo e reexecutável (add column if not exists).
-- =====================================================================

begin;

alter table public.studio_booking_requests
  add column if not exists requester_cep text;

alter table public.studio_booking_participants
  add column if not exists cep text;

comment on column public.studio_booking_requests.requester_cep is
  'CEP do solicitante (8 dígitos). Coletado desde 22/07/2026 por decisão do responsável. Existência validada via ViaCEP no front/Edge Function; aqui só o formato. Coberto pela anonimização em purge_expired_booking_pii_v1/anonymize_titular_pii_v1.';

comment on column public.studio_booking_participants.cep is
  'CEP do convidado (8 dígitos). Coletado desde 22/07/2026 por decisão do responsável. Existência validada via ViaCEP no front/Edge Function; aqui só o formato. Coberto pela anonimização em purge_expired_booking_pii_v1/anonymize_titular_pii_v1.';

commit;

-- ---------------------------------------------------------------------
-- Conferência pós-aplicação: as duas colunas devem aparecer.
-- ---------------------------------------------------------------------
-- select table_name, column_name, is_nullable
--   from information_schema.columns
--  where table_schema = 'public'
--    and column_name in ('requester_cep', 'cep');

-- ---------------------------------------------------------------------
-- As colunas nascem NULLABLE de propósito: linhas antigas (criadas antes
-- da coleta de CEP) ficam com NULL e um `not null` falharia. Só considere
-- tornar obrigatório no banco DEPOIS de conferir que não há linha pendente
-- (as duas contagens abaixo precisam dar 0) e com autorização do
-- responsável:
-- ---------------------------------------------------------------------
-- select count(*) as bookings_sem_cep
--   from public.studio_booking_requests where requester_cep is null;
-- select count(*) as convidados_sem_cep
--   from public.studio_booking_participants where cep is null;
--
-- alter table public.studio_booking_requests
--   alter column requester_cep set not null;
-- alter table public.studio_booking_participants
--   alter column cep set not null;
