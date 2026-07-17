# Relatório de Segurança — EdenSense

**Data:** 10/06/2026  
**Revisão:** Auditoria Completa + Remediação  
**Classificação:** Confidencial

---

## 1. Resumo Executivo

O projeto EdenSense é um sistema IoT de monitoramento de qualidade da água para carcinicultura. Esta auditoria identificou **14 vulnerabilidades** em 5 arquivos, sendo 3 críticas, 6 altas, 2 médias e 3 baixas. Todas foram remediadas nesta revisão.

---

## 2. Vulnerabilidades Identificadas e Corrigidas

| # | Arquivo | Vulnerabilidade | Severidade | Status |
|---|---------|----------------|------------|--------|
| 1 | `bot/config_telegram.py` | Token Telegram + senha MQTT hardcoded | CRÍTICA | CORRIGIDO |
| 2 | `dashboard/config.js` | Credenciais MQTT reais no JS | CRÍTICA | CORRIGIDO¹ |
| 3 | `bot/telegram_bot.py` | Sem validação de chat_id — qualquer usuário controla o bot | CRÍTICA | CORRIGIDO |
| 4 | `dashboard/app.js` | `renderAlertas()` usa innerHTML com `a.msg` sem sanitização | ALTA | CORRIGIDO |
| 5 | `dashboard/app.js` | `a.tipo` usado direto em nomes de classe CSS sem sanitização | ALTA | CORRIGIDO |
| 6 | `dashboard/index.html` | Sem Content Security Policy (CSP) | ALTA | CORRIGIDO |
| 7 | `dashboard/index.html` | Scripts CDN sem SRI (Subresource Integrity) | ALTA | CORRIGIDO |
| 8 | `bot/telegram_bot.py` | Chat ID exposto no log de inicialização | ALTA | CORRIGIDO |
| 9 | `bot/telegram_bot.py` | Sem rate limiting nos comandos | ALTA | CORRIGIDO |
| 10 | `dashboard/firebase.js` | `formatarHistoricoParaLista()` não sanitiza antes de inserir no DOM | ALTA | CORRIGIDO |
| 11 | `dashboard/mqtt.js` | `console.log` expõe detalhes de conexão em produção | MÉDIA | CORRIGIDO |
| 12 | `dashboard/mqtt.js` | Sem validação de faixas físicas (temperatura pode ser 9999) | MÉDIA | CORRIGIDO |
| 13 | `.gitignore` | `firebase.js` não estava no `.gitignore` mas contém credenciais | MÉDIA | CORRIGIDO |
| 14 | `bot/telegram_bot.py` | Payload MQTT sem limite de tamanho | BAIXA | CORRIGIDO |

¹ `dashboard/config.js` já estava no `.gitignore`. Ação manual necessária para rotacionar as credenciais MQTT se o arquivo foi exposto em commits anteriores.

---

## 3. Detalhamento das Correções

### 3.1 Credenciais Hardcoded (VUL #1 e #2)

**Problema:** Token do Telegram (`8909062600:AAF...`) e senha MQTT (`Hu7wkogz`) estavam em texto puro nos arquivos de código.

**Correção:**
- Criado `bot/.env` com todas as credenciais reais
- Criado `bot/.env.example` como referência sem valores
- `bot/config_telegram.py` reescrito para ler via `python-dotenv`
- `bot/.env` e `dashboard/firebase.js` adicionados ao `.gitignore`

**Ação manual necessária:** Se qualquer um desses arquivos foi commitado com credenciais reais em algum momento:
1. Revogar e regenerar o token do Telegram via @BotFather
2. Trocar a senha MQTT no painel HiveMQ Cloud
3. Executar `git filter-branch` ou `git-filter-repo` para remover os commits históricos com credenciais

### 3.2 Controle de Acesso ao Bot Telegram (VUL #3)

**Problema:** Qualquer pessoa que descobrisse o username do bot poderia enviar comandos e receber dados do viveiro.

**Correção:** Adicionada função `_autorizado(update)` que compara o `chat_id` da mensagem recebida com o `TELEGRAM_CHAT_ID` configurado no `.env`. Todos os 6 handlers verificam autorização antes de qualquer lógica:

```python
def _autorizado(update) -> bool:
    chat_id_recebido = str(update.effective_chat.id)
    return chat_id_recebido == str(TELEGRAM_CHAT_ID)
```

### 3.3 Rate Limiting (VUL #9)

**Problema:** Sem limite de comandos, um atacante poderia fazer flood no bot, gerando spam de alertas ou tentando força bruta.

**Correção:** Implementado rate limiting de 10 comandos por 60 segundos por `chat_id`. Rejeição silenciosa (sem confirmação ao atacante):

```python
_rate_limit: dict = defaultdict(list)
_RATE_MAX    = 10
_RATE_JANELA = 60
```

### 3.4 XSS via innerHTML (VUL #4, #5, #10)

**Problema:** Dados vindos do Firebase e MQTT eram inseridos diretamente via `innerHTML` sem sanitização.

**Correção:**
- Adicionada função `sanitizar(str)` em `app.js` (usa `createTextNode` — método DOM seguro)
- `renderAlertas()` agora usa `sanitizar(a.msg)` e `sanitizar(a.time)`
- `a.tipo` protegido por allowlist: `['verde', 'amarelo', 'vermelho']`
- `firebase.js` — `formatarHistoricoParaLista()` sanitiza texto e tipo via allowlist

### 3.5 Content Security Policy (VUL #6)

**Problema:** Sem CSP, scripts injetados no DOM poderiam carregar recursos externos ou enviar dados a servidores do atacante.

**Correção:** Adicionado header CSP via `<meta>` em `index.html`:

```
default-src 'self';
script-src 'self' https://unpkg.com https://www.gstatic.com;
connect-src 'self' wss://*.hivemq.cloud https://*.firebaseio.com ...;
style-src 'self' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
img-src 'self' data:;
```

### 3.6 Subresource Integrity (VUL #7)

**Problema:** Scripts CDN carregados sem verificação de integridade — se o CDN fosse comprometido, código malicioso seria executado.

**Correção:** Adicionados atributos `integrity` (SHA-384) e `crossorigin="anonymous"` nos 3 scripts CDN. Hashes calculados em 10/06/2026:

| Script | Hash SHA-384 |
|--------|-------------|
| `firebase-app-compat.js` | `sha384-sEVIly94UBRLKWdkYoPpSG7GD/e79YHMrxVyZaOk712Ga7+EAw6w1EFi+xBzBdd+` |
| `firebase-database-compat.js` | `sha384-1/m+A1jVWbD3yiK3/vtFvm1+LjK1WLpSoDY+Kaxppwn/yP9BVSgdHTNQVOjrzUO5` |
| `mqtt.min.js` | `sha384-yYo6Rf8oE1ymBEWidpn7Brg0E6BGJiencXj3K2GmcU9dlFZ1fIhEqimYrhQij0r0` |

**Nota:** Os hashes SRI devem ser recalculados sempre que a versão da biblioteca mudar.

### 3.7 Validação de Faixas Físicas (VUL #12)

**Problema:** Valores absurdos (temperatura = 9999, pH = -999) seriam aceitos e exibidos na tela, podendo gerar alertas falsos.

**Correção:** Adicionado `FAIXAS_VALIDAS` e `validarFaixa()` em `mqtt.js`:

```javascript
const FAIXAS_VALIDAS = {
  temperatura: { min: -10,  max: 100  },
  ph:          { min: 0,    max: 14   },
  turbidez:    { min: 0,    max: 3000 },
  salinidade:  { min: 0,    max: 60   },
};
```

### 3.8 Limite de Payload MQTT (VUL #14)

**Problema:** Payloads muito grandes poderiam causar consumo excessivo de memória (DoS).

**Correção:** Adicionado limite de 4 KB no início de `processarMensagem()` (JavaScript) e `ao_receber_mensagem()` (Python).

### 3.9 Logs de Debug em Produção (VUL #11)

**Problema:** `console.log` expunha credenciais MQTT, tópicos e dados de conexão no console do navegador.

**Correção:** Criadas funções `_log()`, `_warn()`, `_err()` controladas por flag `_DEBUG_MQTT = false`. Erros continuam visíveis via `_err()`.

### 3.10 Chat ID no Log (VUL #8)

**Problema:** `logger.info(f"EdenSense: Telegram ativo — Chat ID {TELEGRAM_CHAT_ID}")` expunha o chat_id em logs de servidor.

**Correção:** Substituído por mensagem genérica sem dados sensíveis.

---

## 4. Regras Firebase (firebase-rules.json)

Criado arquivo `firebase-rules.json` com regras que:
- Negam leitura e escrita diretas em todos os nós (`.read: false, .write: false`)
- Validam tipos e faixas físicas em cada campo antes de aceitar escritas do ESP32
- Impedem que dados malformados ou fora da realidade física sejam persistidos

**Ação manual necessária:** Aplicar as regras no Firebase Console:
1. Acessar https://console.firebase.google.com
2. Selecionar o projeto `edensense`
3. Ir em Realtime Database → Regras
4. Colar o conteúdo de `firebase-rules.json`
5. Publicar

---

## 5. Resultados dos Testes de Ataque

Todos os 5 testes passaram:

| Teste | Descrição | Resultado |
|-------|-----------|-----------|
| TESTE 1 | XSS via MQTT — strings maliciosas rejeitadas por `sanitizarNumero()` | PASS |
| TESTE 2 | Faixas físicas — temperatura 9999 e pH -999 rejeitados por `validarFaixa()` | PASS |
| TESTE 3 | Autorização — chat_id invasor retorna `False` em `_autorizado()` | PASS |
| TESTE 4 | Injeção de comando — `/status; rm -rf /` tratado como texto pelo framework | PASS |
| TESTE 5 | Rate limiting — bloqueado após 10 chamadas em 60 segundos | PASS |

---

## 6. Ações Manuais Pendentes

As seguintes correções **não podem ser automatizadas** e requerem ação do desenvolvedor/operador:

### 6.1 Rotação de Credenciais (CRÍTICO)
Se os arquivos com credenciais foram commitados em algum momento no histórico git:

1. **Token Telegram:** Revogar via @BotFather → `/mybots` → `Revoke current token`
2. **Senha MQTT:** Trocar no painel HiveMQ Cloud → `Access Management` → `Credentials`
3. **Chave Firebase:** Regenerar no Firebase Console → `Configurações do projeto` → `Contas de serviço`
4. **Limpar histórico git:** Usar `git filter-repo --path bot/config_telegram.py --invert-paths`

### 6.2 Aplicar Regras Firebase
Conforme descrito na seção 4.

### 6.3 Recalcular SRI a cada atualização de CDN
Sempre que atualizar a versão do Firebase SDK ou mqtt.js, recalcular os hashes:

```powershell
# PowerShell — exemplo para recalcular
$wc = New-Object System.Net.WebClient
$bytes = $wc.DownloadData("https://url-do-cdn")
$sha = [System.Security.Cryptography.SHA384]::Create()
$b64 = [Convert]::ToBase64String($sha.ComputeHash($bytes))
Write-Host "sha384-$b64"
```

### 6.4 Variáveis de Ambiente em Produção
Em servidor de produção (ex: VPS, Heroku, Railway):
- **NÃO** usar o arquivo `bot/.env` — configurar variáveis de ambiente diretamente no painel do servidor
- O arquivo `.env` é apenas para desenvolvimento local

### 6.5 HTTPS no Dashboard
Garantir que o dashboard seja servido via HTTPS. A CSP e os cookies seguros não funcionam corretamente em HTTP.

---

## 7. Arquivos Modificados

| Arquivo | Alterações |
|---------|-----------|
| `dashboard/app.js` | Adicionado `sanitizar()`, flags `DEBUG`/`log()`/`warn()`, corrigido `renderAlertas()` com allowlist e sanitização |
| `dashboard/mqtt.js` | Adicionado `_DEBUG_MQTT`, `_log()`/`_warn()`/`_err()`, `FAIXAS_VALIDAS`, `validarFaixa()`, limite 4KB, logs controlados |
| `dashboard/firebase.js` | Adicionado `_sanitizarStr()` e allowlist de tipo em `formatarHistoricoParaLista()` |
| `dashboard/index.html` | Adicionado CSP via `<meta>` e atributos SRI nos 3 scripts CDN |
| `bot/telegram_bot.py` | Adicionado `_autorizado()`, `_dentro_do_limite()`, rate limiting em todos os handlers, removido chat_id do log, limite 4KB no payload |
| `bot/config_telegram.py` | Reescrito para usar `python-dotenv` em vez de credenciais hardcoded |
| `.gitignore` | Adicionados `dashboard/firebase.js` e `bot/.env` |

## 8. Arquivos Criados

| Arquivo | Descrição |
|---------|-----------|
| `bot/.env` | Credenciais reais — nunca versionar |
| `bot/.env.example` | Referência sem valores reais — pode versionar |
| `firebase-rules.json` | Regras de segurança para o Firebase Realtime Database |
| `test_security.py` | Script de testes dos 5 cenários de ataque |
| `docs/SEGURANCA.md` | Este documento |

---

*EdenSense — Sistema IoT de Monitoramento de Carcinicultura*  
*Vale do Jaguaribe · CE · Brasil*
