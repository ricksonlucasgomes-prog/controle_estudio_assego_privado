# Política de Dados Pessoais — Assego Studio (LGPD)

Documento operacional para a administração da ASSEGO. Descreve quais dados
pessoais o app trata, por quanto tempo, com que base legal, e como atender
pedidos dos titulares. Complementa o Termo de Uso exibido no app
(`src/termsContent.ts`) e o `Termo_de_Uso_Assego.pdf`.

## 1. Dados tratados

| Contexto | Dados pessoais | Onde ficam |
|---|---|---|
| Agendamento do estúdio | Nome, WhatsApp, e-mail, rede social, data/horário | `studio_booking_requests`, `studio_booking_participants` |
| Assinatura/aceite do termo | Nome, e-mail, IP, user-agent, hash do payload assinado | `legal_signatures` (imutável) |
| Pedido de equipamento | Nome, e-mail, justificativa | `studio_equipment_requests` |
| Retirada de equipamento | Nome, e-mail, foto | `studio_checkouts`, `studio_checkout_history` |
| Notificações | Nome/e-mail no corpo; payloads de fila com PII | `app_notifications`, `notification_outbox` |
| Aprovação de reserva | Nome/e-mail/WhatsApp do solicitante e participantes na descrição do evento | Google Calendar do administrador (operador: Google) |

> **RG e CPF não são coletados** pelo app (princípio da minimização — LGPD
> art. 6º, III). O controle de acesso ao estúdio usa nome + contato +
> assinatura digital.

## 2. Bases legais (LGPD art. 7º)

- **Controle de acesso, segurança e gestão do estúdio**: legítimo interesse /
  execução de procedimento a pedido do titular (art. 7º, V e IX).
- **Guarda da assinatura digital (`legal_signatures`)**: exercício regular de
  direitos e cumprimento de obrigação (art. 7º, II e VI; art. 16, I). É a prova
  de não-repúdio do aceite — por isso é **imutável** e **preservada mesmo após
  pedidos de eliminação**.

## 3. Retenção e eliminação

Rotina técnica: [`supabase/data_retention.sql`](supabase/data_retention.sql).

- **Janela padrão: 6 meses** após o encerramento da finalidade (data da
  reserva / devolução / finalização do pedido). Ajustável no parâmetro
  `p_retention_months` da função e no corpo do job de cron.
- Passada a janela, a **PII operacional é anonimizada** (`[dados removidos]` /
  `NULL`), preservando linhas e estatísticas. Fotos base64 do histórico são
  apagadas. Fila de notificações já entregue é apagada.
- A `legal_signatures` **não** é tocada (base legal de guarda acima).

Agendamento automático (pg_cron, diário às 04:30 UTC):
```sql
-- já incluso em data_retention.sql; requer extensão pg_cron habilitada
select public.purge_expired_booking_pii_v1(6);
```

## 4. Atender pedidos do titular (art. 18)

**Canal do titular / Encarregado (DPO) — controle do estúdio:**
- **Telefone/WhatsApp:** (62) 99434-9416
- **E-mail:** ricksonlucasgomes@gmail.com

**Contato institucional da ASSEGO:**
- **E-mail:** comunicacaoassego@gmail.com
- **Site:** https://www.assego.com.br
- **Localização:** Goiânia/GO
- **Endereço e telefone institucional:** _a confirmar/publicar pela ASSEGO._

Registrar cada pedido (data, titular, solicitação e providência tomada).

- **Acesso / confirmação de tratamento (art. 18, I–II)**: a diretoria consulta
  os dados do titular no próprio app (autenticada) ou no SQL Editor.
- **Correção (art. 18, III)**: o titular corrige nome/contato numa nova
  solicitação; dados antigos são anonimizados pela retenção.
- **Eliminação / anonimização (art. 18, VI)**: rodar, como aprovador principal:
  ```sql
  select public.anonymize_titular_pii_v1('<uuid_do_titular>');
  ```
  Isso anonimiza toda a PII operacional daquele titular sob demanda (agendamentos,
  participantes, pedidos e retiradas), **mantendo a assinatura** por base legal, e
  registra o atendimento em `audit_logs` (`action = 'lgpd_erasure_fulfilled'`).
  Pedidos podem ser feitos pelos canais do titular acima.

  Para descobrir o `uuid` a partir do e-mail:
  ```sql
  select id from auth.users where lower(email) = lower('titular@exemplo.com');
  ```

## 5. Acesso interno (quem vê o quê)

- `viewer`: não vê PII operacional nem dados de agendamento de terceiros (RLS).
- `admin` (Badu, Sérgio Vinicius, Sgt. Tiago Raiz): veem as listas para gestão.
- `developer` / aprovador principal (Lucas): único que aprova/rejeita e atende
  pedidos de eliminação.
- `legal_signatures`: leitura restrita à diretoria; ninguém edita/exclui.

## 6. Pendências recomendadas

- Publicar o **endereço e telefone institucional** da ASSEGO (o canal do
  titular e o e-mail institucional já constam na seção 4).
- Confirmar com a ASSEGO o **prazo de retenção** definitivo (hoje 6 meses).
- Manter o `Termo_de_Uso_Assego.pdf` **sincronizado** com o texto do app
  (RG e CPF já foram removidos de `src/termsContent.ts` e do PDF).
