# Integração com Google Sheets (tempo real) — Agendamentos

Cada solicitação de gravação enviada pelo app é gravada, **em tempo real**, como
uma linha numa planilha do Google Sheets, com todos os dados pessoais do
solicitante e dos convidados (inclui **CPF** e **CEP**).

A gravação é feita pela Edge Function `submit-booking`, que faz um `POST` para um
**Google Apps Script publicado como app da web**. É *best-effort*: se a planilha
estiver indisponível, o agendamento continua funcionando normalmente (a falha só
vai para o log da função). Não há duplicação de linhas em reenvios (idempotência).

> ⚠️ **Privacidade / LGPD.** A planilha passa a conter dados pessoais (nome, CPF,
> CEP, e-mail, WhatsApp) do solicitante e dos convidados. Restrinja o
> compartilhamento da planilha ao mínimo necessário e não a publique.

---

## Passo 1 — Criar a planilha e o script

1. Crie uma planilha nova em <https://sheets.google.com>.
2. Menu **Extensões → Apps Script**.
3. Apague o conteúdo padrão e cole o script abaixo.
4. Troque o valor de `SHEET_SECRET` por um segredo forte (guarde-o; ele será
   usado também no Supabase, no passo 3).

```javascript
// Segredo compartilhado com a Edge Function (SHEETS_WEBHOOK_SECRET no Supabase).
const SHEET_SECRET = 'COLE_UM_SEGREDO_FORTE_AQUI';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // Rejeita chamadas sem o segredo correto (evita que alguém que descubra a
    // URL injete linhas na planilha).
    if (SHEET_SECRET && body.secret !== SHEET_SECRET) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const name = body.sheetName || 'Dados';
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);

    // Escreve o cabeçalho na primeira vez (aba vazia).
    if (sheet.getLastRow() === 0 && Array.isArray(body.header)) {
      sheet.appendRow(body.header);
      sheet.getRange(1, 1, 1, body.header.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    if (Array.isArray(body.row)) sheet.appendRow(body.row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

## Passo 2 — Publicar como app da web

1. No editor do Apps Script, clique em **Implantar → Nova implantação**.
2. Em **Tipo**, escolha **App da Web**.
3. Configure:
   - **Executar como:** *Eu* (sua conta, dona da planilha).
   - **Quem tem acesso:** *Qualquer pessoa*.
     (Necessário porque o servidor da Edge Function chama sem login Google; a
     proteção real é o `SHEET_SECRET`.)
4. Clique em **Implantar**, autorize os acessos solicitados e **copie a URL do
   app da web** (algo como `https://script.google.com/macros/s/AKfy.../exec`).

> Ao alterar o script depois, use **Implantar → Gerenciar implantações → editar
> → Nova versão** para que as mudanças entrem no ar sem trocar a URL.

## Passo 3 — Configurar os secrets no Supabase

No Supabase (Edge Functions → Secrets, ou via CLI), defina:

```bash
supabase secrets set SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/AKfy.../exec"
supabase secrets set SHEETS_WEBHOOK_SECRET="o_mesmo_segredo_do_SHEET_SECRET"
```

Depois, **reimplante** a função:

```bash
supabase functions deploy submit-booking
```

Enquanto `SHEETS_WEBHOOK_URL` não estiver definido, a integração fica desligada
(o app funciona normalmente, apenas não grava na planilha).

---

## Colunas gravadas (aba "Agendamentos")

`Enviado em` · `ID` · `Status` · `Solicitante` · `CPF` · `CEP` · `E-mail` ·
`WhatsApp` · `Rede social` · `Data` · `Início` · `Término` · `Tipo` · `Programa` ·
`Formato` · `Orientações` · `Canal YouTube` · `Nº convidados` · `Convidados`

A coluna **Convidados** traz todos os participantes num único bloco de texto
(uma linha por convidado): `nº. Nome | CPF … | CEP … | e-mail | WhatsApp | rede`.

O `Status` gravado é sempre `Pendente` (momento do envio). Aprovações/rejeições
posteriores são feitas no app e **não** atualizam a planilha.

## Como testar

1. Faça um agendamento de teste pelo app.
2. A linha deve aparecer na aba **Agendamentos** em segundos.
3. Se não aparecer: confira os logs em *Edge Functions → submit-booking → Logs*
   (procure por "Falha ao registrar no Google Sheets") e verifique a URL/segredo.
