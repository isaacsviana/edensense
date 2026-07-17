# EdenSense — Arquitetura Técnica do Sistema

Documento de referência para qualquer desenvolvedor que entrar no projeto.
Explica como cada parte funciona, por que foi escolhida e como as partes se comunicam.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Fluxo de dados completo](#2-fluxo-de-dados-completo)
3. [Camada 1 — Hardware (ESP32)](#3-camada-1--hardware-esp32)
4. [Camada 2 — Comunicação (MQTT)](#4-camada-2--comunicação-mqtt)
5. [Camada 3 — Backend (Bot Telegram)](#5-camada-3--backend-bot-telegram)
6. [Camada 4 — Persistência (Firebase)](#6-camada-4--persistência-firebase)
7. [Camada 5 — Frontend (Dashboard)](#7-camada-5--frontend-dashboard)
8. [Decisões técnicas e por quê](#8-decisões-técnicas-e-por-quê)
9. [Como adicionar um novo sensor](#9-como-adicionar-um-novo-sensor)
10. [Como adicionar um novo viveiro](#10-como-adicionar-um-novo-viveiro)
11. [Segurança e próximos passos](#11-segurança-e-próximos-passos)
12. [Glossário](#12-glossário)

---

## 1. Visão geral

O EdenSense é um sistema IoT de 5 camadas:

```
CAMADA 1      CAMADA 2       CAMADA 3        CAMADA 4        CAMADA 5
Hardware   →  Comunicação →  Backend     →   Persistência →  Frontend
ESP32         MQTT/HiveMQ    Python bot       Firebase        Dashboard
                             Telegram         Realtime DB     HTML/JS
```

Cada camada é independente: o dashboard funciona sem o ESP32 (modo simulação),
o bot funciona sem o Firebase, e assim por diante.

---

## 2. Fluxo de dados completo

```
┌────────────────────────────────────────────────────────────────────┐
│                         VIVEIRO DE CAMARÃO                          │
│                                                                      │
│  [Água] → DS18B20 ─────────────────────────────┐                   │
│  [Água] → PH-4502C ──────────────────────────  │                   │
│  [Água] → Sensor turbidez ─────────────────── ESP32 DevKit V1      │
│  [Água] → Sensor TDS/salinidade ─────────────  │                   │
│                                                 │                   │
│          LEDs + Buzzer ◄────────────────────────┘                   │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              │ Wi-Fi → Internet
                              │ MQTT sobre TLS (porta 8883)
                              │ Publica a cada 5 segundos
                              ▼
               ┌──────────────────────────────┐
               │   HiveMQ Cloud (broker MQTT)  │
               │   Tópicos:                    │
               │   edensense/viveiro1/status   │
               │   edensense/viveiro1/ph       │
               │   edensense/viveiro1/...      │
               └──────┬──────────────┬─────────┘
                      │              │
          ┌───────────┘              └────────────────┐
          │ WebSocket (porta 8884)                    │ TCP+TLS (porta 8883)
          ▼                                           ▼
┌──────────────────────┐                  ┌──────────────────────────┐
│   Dashboard Web      │                  │   telegram_bot.py        │
│   (navegador)        │                  │   (servidor Python)      │
│                      │                  │                          │
│  Assina tópicos MQTT │                  │  Assina tópicos MQTT     │
│  Renderiza valores   │                  │  Avalia faixas ideais    │
│  Atualiza gráficos   │                  │  Envia alerta se crítico │
│  Mostra histórico    │                  │  Respeita cooldown 15min │
└──────────┬───────────┘                  └──────────────────────────┘
           │                                          │
           │ Firebase SDK (HTTPS)                     │ API Telegram (HTTPS)
           ▼                                          ▼
┌──────────────────────┐                  ┌──────────────────────────┐
│   Firebase Realtime  │                  │   Telegram do produtor   │
│   Database           │                  │                          │
│                      │                  │  🚨 RISCO CRÍTICO        │
│  viveiros/           │                  │  Parâmetro: pH           │
│    viveiro1/         │                  │  Valor: 6.8              │
│      leituras/       │                  │  Ação: Aplicar calcário  │
│        {timestamp}   │                  └──────────────────────────┘
└──────────────────────┘
```

---

## 3. Camada 1 — Hardware (ESP32)

### O que faz

O ESP32 é o coração do sistema físico. Ele:
- Lê os 4 sensores a cada 5 segundos
- Acende o LED correspondente ao status (verde/amarelo/vermelho)
- Aciona o buzzer em situações críticas
- Publica as leituras no broker MQTT via Wi-Fi

### Pinout completo

| GPIO | Componente | Tipo de sinal |
|---|---|---|
| GPIO4 | DS18B20 (temperatura) | Digital One-Wire |
| GPIO34 | PH-4502C (pH) | Analógico (ADC1) |
| GPIO35 | Sensor turbidez | Analógico (ADC1) |
| GPIO32 | Sensor TDS/salinidade | Analógico (ADC1) |
| GPIO25 | LED verde | Saída digital |
| GPIO26 | LED amarelo | Saída digital |
| GPIO27 | LED vermelho | Saída digital |
| GPIO14 | Buzzer ativo | Saída digital (PWM) |
| GPIO13 | Botão silenciar | Entrada digital (pull-up) |

> GPIOs 34, 35 e 32 são somente leitura (input-only) — não usar como saída.
> ADC1 (GPIOs 32–39) funciona normalmente com Wi-Fi ativo; ADC2 não.

### Ciclo de execução do firmware

```
BOOT → auto-teste LEDs/buzzer → inicializa sensores
     → conecta Wi-Fi → conecta MQTT → loop principal (5s):
         1. Lê todos os sensores (média de 10 amostras)
         2. Avalia status (verde/amarelo/vermelho)
         3. Aciona LED e buzzer correspondentes
         4. Publica JSON no tópico status
         5. Publica individualmente em cada tópico de sensor
         6. A cada 12 ciclos (60s): salva no Firebase via HTTP REST
```

### Por que ESP32 e não Arduino?

O Arduino UNO/Mega não tem Wi-Fi nem processamento suficiente para TLS.
O ESP32 resolve os dois problemas e custa praticamente o mesmo.

---

## 4. Camada 2 — Comunicação (MQTT)

### O que é MQTT

MQTT é um protocolo de mensagens leve, criado para IoT. Funciona no modelo
**publish/subscribe**: o ESP32 *publica* dados em um tópico; o dashboard e o bot
*assinam* o mesmo tópico e recebem os dados automaticamente.

### Por que HiveMQ Cloud

- Plano gratuito com conexões ilimitadas de baixo volume
- Suporte a TLS/SSL sem configuração adicional
- Alta disponibilidade (uptime 99,9%)
- Alternativas: Mosquitto (self-hosted), CloudMQTT, EMQX Cloud

### Tópicos e payloads

| Tópico | Quem publica | Quem assina | Payload |
|---|---|---|---|
| `edensense/viveiro1/status` | ESP32 | Dashboard, Bot | `{"temperatura":27.4,"ph":7.8,"turbidez":18,"salinidade":22,"status":"verde","alerta":""}` |
| `edensense/viveiro1/temperatura` | ESP32 | Dashboard | `"27.4"` |
| `edensense/viveiro1/ph` | ESP32 | Dashboard | `"7.8"` |
| `edensense/viveiro1/turbidez` | ESP32 | Dashboard | `"18"` |
| `edensense/viveiro1/salinidade` | ESP32 | Dashboard | `"22.0"` |
| `edensense/viveiro1/alerta` | ESP32 | Dashboard, Bot | texto livre |

### Portas utilizadas

| Porta | Protocolo | Quem usa |
|---|---|---|
| 8883 | MQTT sobre TCP+TLS | ESP32, telegram_bot.py |
| 8884 | MQTT sobre WebSocket+TLS | Dashboard (navegador) |

> O navegador não pode abrir sockets TCP diretamente — por isso usa WebSocket.
> O ESP32 e o Python usam TCP puro com TLS, que é mais eficiente.

---

## 5. Camada 3 — Backend (Bot Telegram)

### Arquivo: `bot/telegram_bot.py`

O bot é um servidor Python que fica rodando continuamente.
Ele mantém **duas conexões simultâneas em threads separadas**:

```
Thread principal (asyncio):
  └── python-telegram-bot polling
        └── Responde /status, /historico, /silenciar, /ativar, /ajuda

Thread daemon (paho-mqtt):
  └── Conectado ao HiveMQ Cloud
        └── ao_receber_mensagem() → run_coroutine_threadsafe()
              └── verificar_e_alertar() → bot.send_message()
```

### Lógica de alertas

```python
# Níveis: 'normal', 'amarelo', 'vermelho'
# Regras de envio:
if novo_nivel == 'vermelho' and nivel_anterior != 'vermelho':
    envia_imediatamente()          # escalou → envia na hora
elif mesmo_nivel and passou_15_min:
    envia_novamente()              # repetição com cooldown
elif novo_nivel == 'normal' and estava_em_alerta:
    envia_normalizacao()           # voltou ao normal → uma vez
```

### Estado em memória

| Variável | Tipo | Função |
|---|---|---|
| `sensores_atuais` | dict | Última leitura de cada sensor |
| `ultimo_nivel_enviado` | dict | Nível do último alerta enviado por sensor |
| `ultimo_envio_ts` | dict | Timestamp do último envio por sensor |
| `silenciado_ate` | datetime | Quando termina o silenciamento |
| `alertas_log` | list | Histórico em memória (máx 500) |

O estado é perdido ao reiniciar o servidor — o `alertas_log` é persistido em
`alertas_log.json` para sobreviver a reinicializações.

---

## 6. Camada 4 — Persistência (Firebase)

### Arquivo: `dashboard/firebase.js`

O Firebase é usado **apenas pelo dashboard** (navegador).
O bot Python não salva diretamente no Firebase — ele salva no `alertas_log.json`.

### Estrutura do banco

```
viveiros/
  viveiro1/
    leituras/
      1781123969/              ← timestamp Unix em segundos
        temperatura: 27.4
        ph: 7.8
        turbidez: 18
        salinidade: 22
        status: "verde"
        alerta: ""
        timestamp: 1781123969
      1781124029/              ← próxima leitura (60s depois)
        ...
```

### Limites do plano gratuito (Spark)

| Recurso | Limite | Nossa configuração |
|---|---|---|
| Armazenamento | 1 GB | Máx 500 registros (~50 KB) |
| Transferência | 10 GB/mês | ~1 leitura/min × 30 dias = mínimo |
| Conexões simultâneas | 100 | Suficiente para MVP |

### Quando atualizar as regras de segurança

O banco está em **modo de teste** com prazo de expiração (90 dias desde a criação).
Antes do prazo, atualizar para regras de produção no Firebase Console:

```json
{
  "rules": {
    "viveiros": {
      "viveiro1": {
        "leituras": {
          ".read": true,
          ".write": false,
          ".indexOn": ["timestamp"]
        }
      }
    }
  }
}
```

A escrita no banco em produção deve exigir autenticação (Service Account do ESP32).

---

## 7. Camada 5 — Frontend (Dashboard)

### Arquivos: `dashboard/`

O dashboard é um SPA (Single Page Application) sem framework.
Quatro arquivos JavaScript com responsabilidades separadas:

| Arquivo | Responsabilidade |
|---|---|
| `config.js` | Credenciais MQTT — carregado primeiro |
| `firebase.js` | Inicializa Firebase e expõe funções de leitura/escrita |
| `mqtt.js` | Conecta ao broker, assina tópicos, chama funções do `app.js` |
| `app.js` | Renderiza o dashboard, simulação, histórico, alertas visuais |

### Ordem de carregamento (crítica — não alterar)

```html
<script src="config.js"></script>         <!-- 1º: credenciais -->
<script src="firebase-app-compat.js"></script>  <!-- 2º: SDK Firebase -->
<script src="firebase-database-compat.js"></script>
<script src="firebase.js"></script>       <!-- 3º: wrapper Firebase -->
<script src="mqtt.min.js"></script>       <!-- 4º: biblioteca MQTT -->
<script src="mqtt.js"></script>           <!-- 5º: conexão MQTT -->
<script src="app.js"></script>            <!-- 6º: lógica do dashboard -->
```

### Modo simulação vs. modo real

```
Ao abrir o dashboard:
  1. Inicia simulação (valores aleatórios a cada 3s)
  2. Tenta conectar ao MQTT
  3. Se MQTT conectar → para simulação, usa dados reais
  4. Se MQTT desconectar → volta à simulação automaticamente
```

---

## 8. Decisões técnicas e por quê

| Decisão | Alternativas consideradas | Por que esta |
|---|---|---|
| MQTT como protocolo | HTTP polling, WebSocket direto | MQTT é padrão IoT: leve, baixa latência, suporte a QoS |
| HiveMQ Cloud | Mosquitto self-hosted, CloudMQTT | Gratuito, zero manutenção, TLS incluído |
| Firebase Realtime DB | PostgreSQL, MongoDB, Supabase | SDK JavaScript simples, plano gratuito generoso, sem servidor |
| python-telegram-bot | telebot, aiogram | Oficial, bem documentado, async nativo na v20+ |
| JavaScript puro | React, Vue, Angular | Sem build step, abre direto no navegador, menor curva de aprendizado |
| ESP32 | Arduino + ESP8266, Raspberry Pi | Wi-Fi + ADC + processamento no mesmo chip, custo baixo |

---

## 9. Como adicionar um novo sensor

Exemplo: adicionar sensor de **oxigênio dissolvido** (DO).

### 1. Firmware (`firmware/firmware.ino`)

```cpp
// Defina o pino e os limites
#define DO_PIN        33
#define DO_IDEAL_MIN  5.0    // mg/L
#define DO_IDEAL_MAX  9.0
#define DO_AMARELO    0.15   // 15% da borda

// Na função lerSensores():
float oxigenio = lerADC(DO_PIN) * FATOR_DO;
dados["oxigenio"] = oxigenio;

// Na função avaliarStatus():
if (oxigenio < DO_IDEAL_MIN || oxigenio > DO_IDEAL_MAX) status = VERMELHO;
```

### 2. Bot Python (`bot/telegram_bot.py`)

```python
# No dicionário PARAMETROS, adicione:
"oxigenio": {
    "nome":          "Oxigênio Dissolvido",
    "faixa_texto":   "5 a 9 mg/L",
    "unidade":       " mg/L",
    "rec_amarelo":   "Verifique a aeração do viveiro.",
    "acao_vermelho": "Intensifique a aeração imediatamente.",
    "avaliar": lambda v: (
        "vermelho" if (v < 4.0 or v > 10.0) else
        "amarelo"  if (v < 5.0 or v > 9.0)  else
        "normal"
    ),
},
```

### 3. Dashboard (`dashboard/app.js` e `dashboard/index.html`)

Adicione um card de sensor no `index.html` seguindo o padrão dos 4 existentes,
e registre o novo sensor no mapa de parâmetros em `app.js`.

### 4. Tópico MQTT

O ESP32 deve publicar em: `edensense/viveiro1/oxigenio`
E incluir `"oxigenio"` no JSON do tópico `status`.

---

## 10. Como adicionar um novo viveiro

Exemplo: adicionar **Viveiro 02**.

### 1. Tópicos MQTT

Padronize os tópicos com o ID do viveiro:
```
edensense/viveiro2/status
edensense/viveiro2/temperatura
edensense/viveiro2/ph
...
```

### 2. Bot Python

Duplique ou parametrize o cliente MQTT para assinar os tópicos do viveiro2.
Atualize `NOME_VIVEIRO` e `LOCAL_VIVEIRO` em `config_telegram.py`,
ou crie um segundo arquivo de configuração e rode dois processos bot.

### 3. Dashboard

Adicione uma aba ou dropdown de seleção de viveiro em `index.html`.
Em `mqtt.js`, parametrize os tópicos com o viveiro selecionado.

### 4. Firebase

Os dados já são separados por viveiro na estrutura:
```
viveiros/viveiro1/leituras/...
viveiros/viveiro2/leituras/...   ← novo
```

Nenhuma mudança necessária no banco.

---

## 11. Segurança e próximos passos

### Estado atual (MVP)

| Aspecto | Status | Risco |
|---|---|---|
| Firebase em modo teste | Qualquer um pode ler/escrever | Baixo (dados não sensíveis) |
| Credenciais MQTT no `config.js` | Não vai ao GitHub, mas visível no browser | Médio |
| Bot Telegram sem autenticação | Qualquer um que descubra o token pode enviar comandos | Médio |
| Firmware sem OTA | Atualizar exige cabo USB | Baixo |

### Melhorias de segurança para produção

1. **Firebase**: migrar para regras com autenticação (ver seção 6)
2. **MQTT**: criar credencial separada de leitura apenas para o dashboard
3. **Bot Telegram**: adicionar verificação de `chat_id` antes de responder comandos
4. **Firmware**: implementar OTA (Over-The-Air update) para atualizar sem cabo

---

## 12. Glossário

### Termos técnicos

| Termo | Definição |
|---|---|
| **MQTT** | Message Queuing Telemetry Transport — protocolo leve de mensagens para IoT |
| **Broker** | Servidor intermediário que recebe e distribui mensagens MQTT |
| **Publish/Subscribe** | Modelo onde quem envia (publish) não sabe quem recebe (subscribe) |
| **TLS/SSL** | Criptografia de transporte — protege os dados em trânsito |
| **GPIO** | General Purpose Input/Output — pinos do microcontrolador |
| **ADC** | Analog-to-Digital Converter — converte tensão analógica em número digital |
| **One-Wire** | Protocolo de comunicação serial que usa apenas um fio de dados (DS18B20) |
| **QoS** | Quality of Service — garante entrega de mensagens no MQTT (0=dispara-esquece, 1=pelo menos uma vez, 2=exatamente uma vez) |
| **WebSocket** | Protocolo que permite comunicação bidirecional em tempo real no navegador |
| **Polling** | Técnica de verificar periodicamente se há novos dados (usado pelo bot Telegram) |
| **Cooldown** | Tempo mínimo de espera entre dois alertas do mesmo tipo |
| **SPA** | Single Page Application — site que carrega uma vez e atualiza sem recarregar |

### Termos de carcinicultura

| Termo | Definição |
|---|---|
| **Carcinicultura** | Criação comercial de camarões em viveiros controlados |
| **Viveiro** | Tanque ou lago artificial onde os camarões são criados |
| **pH** | Medida de acidez/alcalinidade da água (0-14; neutro = 7) |
| **Turbidez** | Quantidade de partículas em suspensão na água, medida em NTU |
| **Salinidade** | Concentração de sais dissolvidos na água, medida em ppt (partes por mil) |
| **NTU** | Nephelometric Turbidity Unit — unidade de medida de turbidez |
| **ppt** | Partes por mil — unidade de salinidade (ex: água do mar ≈ 35 ppt) |
| **DS18B20** | Sensor de temperatura digital à prova d'água, ideal para aquicultura |
| **PH-4502C** | Módulo de sensor de pH analógico para Arduino/ESP32 |
| **TDS** | Total Dissolved Solids — sólidos totais dissolvidos, correlacionado com salinidade |
| **Calcário dolomítico** | Corretivo agrícola usado para elevar o pH da água do viveiro |
| **Aeração** | Processo de adicionar oxigênio à água usando aeradores ou bombas |
| **Biota** | Conjunto de organismos vivos presentes no viveiro |

---

*EdenSense © 2026 — Vale do Jaguaribe, Ceará*
