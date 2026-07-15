# submit-booking - solicitação interna no app

A Edge Function `submit-booking` grava a solicitação de agendamento e a
assinatura digital. Ela não envia WhatsApp, Telegram ou n8n neste fluxo.

Depois que a reserva e a assinatura são gravadas, a notificação acontece dentro
do próprio app:

1. o solicitante recebe sucesso no formulário;
2. os aprovadores oficiais entram na aba **Agenda**;
3. o painel **Notificações de agendamento** mostra as solicitações pendentes;
4. cada solicitação exibe os dados pessoais preenchidos pelo usuário e pelos
   convidados;
5. Lucas, Badu e Sérgio Vinicius podem aprovar ou rejeitar.

## Segurança

Os dados pessoais ficam no Supabase e são lidos pelo frontend apenas via RLS.

A política usa `public.current_user_is_booking_approver()`, que exige:

- `profiles.role = 'admin'`;
- `profiles.full_name` compatível com Lucas, Badu, Sérgio Vinicius ou Serginho.

Hoje, para Badu e Sérgio receberem as notificações internas, eles precisam:

1. criar login no app;
2. ter seus perfis atualizados para `role = 'admin'`;
3. ter `full_name` preenchido como `Badu`, `Sergio Vinicius`, `Sérgio Vinicius`
   ou `Serginho`.

## Payload recebido do frontend

```jsonc
{
  "requester": {
    "name": "Lucas Rickson Gomes da Silva",
    "email": "...",
    "whatsapp": "...",
    "social": "...",
    "date": "2026-07-09",
    "time": "12:00"
  },
  "guests": [
    {
      "name": "Badu",
      "whatsapp": "...",
      "email": "...",
      "social": "..."
    }
  ],
  "booking_details": {
    "date": "2026-07-09",
    "time": "12:00"
  },
  "signature": {
    "fullName": "...",
    "acceptedTerms": true,
    "termDocument": "Termo_de_Uso_Assego.pdf",
    "signedByEmail": "...",
    "userAgent": "..."
  }
}
```

## Tabelas envolvidas

- `studio_booking_requests`
- `studio_booking_participants`
- `legal_signatures`

## Deploy

```bash
supabase db query --linked --file supabase/studio_booking.sql
supabase db query --linked --file supabase/legal_signatures.sql
supabase functions deploy submit-booking
```
