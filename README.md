# EdenSense — Sistema de Monitoramento IoT para Carcinicultura

Sistema de monitoramento em tempo real da qualidade da água em viveiros de camarão.
Desenvolvido para pequenos e médios produtores rurais do Vale do Jaguaribe, Ceará.

O ESP32 lê os sensores a cada 5 segundos e publica os dados via MQTT. O dashboard web
exibe tudo em tempo real. O bot do Telegram avisa o produtor no celular quando qualquer
parâmetro sai da faixa ideal.

---

## Arquitetura do sistema

```
                        ┌─────────────────────────────────────────┐
                        │              ESP32 DevKit V1             │
                        │                                          │
  [Água do viveiro] ───►│  DS18B20 (temp)   PH-4502C (pH)         │
                        │  Turbidez (GPIO35) TDS/Sal (GPIO32)      │
                        │  LEDs (GPIO25/26/27)  Buzzer (GPIO14)    │
                        └──────────────┬──────────────────────────┘
                                       │ MQTT sobre TLS (porta 8883)
                                       ▼
                        ┌─────────────────────────────────────────┐
                        │       HiveMQ Cloud (broker MQTT)         │
                        │  11aeee...hivemq.cloud                   │
                        └──────────────┬──────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
          ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
          │  Dashboard   │  │  telegram_bot.py │  │    Firebase      │
          │  Web (HTML)  │  │  (Python)        │  │  Realtime DB     │
          │              │  │                  │  │                  │
          │ Gráficos ao  │  │ Avalia parâmetros│  │ Histórico de     │
          │ vivo via     │  │ Envia alertas no │  │ leituras (500    │
          │ WebSocket    │  │ Telegram do      │  │ registros)       │
          └──────────────┘  │ produtor         │  └──────────────────┘
                            └──────────────────┘
```

---

## Estrutura de pastas

```
edensense/
├── dashboard/              Frontend web do sistema
│   ├── index.html          Estrutura do dashboard (HTML)
│   ├── style.css           Visual dark mode responsivo
│   ├── app.js              Lógica do dashboard, simulação e Firebase
│   ├── mqtt.js             Conexão WebSocket com o broker MQTT
│   ├── firebase.js         Persistência no Firebase Realtime Database
│   └── config.js           Credenciais MQTT — NÃO subir ao GitHub
│
├── bot/                    Backend Python — alertas via Telegram
│   ├── telegram_bot.py     Servidor de notificações (MQTT → Telegram)
│   ├── config_telegram.py  Credenciais Telegram e MQTT — NÃO subir ao GitHub
│   └── requirements.txt    Dependências Python
│
├── firmware/               Código do ESP32 (Arduino/PlatformIO)
│   ├── firmware.ino        Código principal do ESP32
│   └── README_FIRMWARE.md  Guia completo de instalação e calibração
│
├── docs/                   Documentação do projeto
│   ├── CHECKLIST.md        Checklist de configuração e tarefas
│   ├── README_TELEGRAM.md  Guia detalhado do bot Telegram
│   └── ARQUITETURA.md      Documento técnico da arquitetura completa
│
├── .gitignore              Protege credenciais de irem ao GitHub
└── README.md               Este arquivo
```

---

## Como rodar o projeto

### Pré-requisito: configurar as credenciais

Antes de qualquer coisa, preencha os três arquivos de configuração:

**`dashboard/config.js`** — credenciais do broker MQTT:
```javascript
const MQTT_CONFIG = {
  host:    'SEU-BROKER.hivemq.cloud',
  porta:   8884,
  usuario: 'SEU_USUARIO',
  senha:   'SUA_SENHA',
  clientId: 'edensense-dashboard-' + Math.random().toString(16).slice(2, 8)
};
```

**`bot/config_telegram.py`** — token do bot e MQTT:
```python
TELEGRAM_BOT_TOKEN = "SEU_TOKEN_BOTFATHER"
TELEGRAM_CHAT_ID   = "SEU_CHAT_ID"
MQTT_HOST          = "SEU-BROKER.hivemq.cloud"
MQTT_USUARIO       = "SEU_USUARIO"
MQTT_SENHA         = "SUA_SENHA"
```

**`dashboard/firebase.js`** — credenciais Firebase (já configurado se você seguiu o setup):
```javascript
const FIREBASE_CONFIG = {
  apiKey:      "SUA_API_KEY",
  databaseURL: "https://SEU-PROJETO-default-rtdb.firebaseio.com",
  // ... demais campos do Firebase Console
};
```

---

### Dashboard web

1. Abra a pasta `dashboard/` no VS Code
2. Instale a extensão **Live Server** (se ainda não tiver)
3. Clique com o botão direito em `index.html` → **Open with Live Server**
4. O dashboard abre em `http://127.0.0.1:5500/index.html`

> O dashboard funciona em **modo simulação** mesmo sem o ESP32 conectado.
> Os valores mudam a cada 3 segundos automaticamente para demonstração.
> Quando o MQTT conectar com dados reais, a simulação para automaticamente.

---

### Bot Telegram

```bash
# Entre na pasta do bot
cd bot

# Instale as dependências (Python 3.10+ recomendado)
pip install -r requirements.txt

# Rode o servidor de notificações
python telegram_bot.py
```

O terminal deve mostrar:
```
[INFO]  MQTT: Conectado com sucesso
[INFO]  MQTT: assinando edensense/viveiro1/status
[INFO]  EdenSense: sistema de notificações iniciado. Aguardando dados do MQTT...
```

Comandos disponíveis no Telegram: `/status`, `/historico`, `/silenciar`, `/ativar`, `/ajuda`

---

## Hardware necessário (quando chegar)

| Componente | Finalidade | Pino no ESP32 |
|---|---|---|
| ESP32 DevKit V1 | Microcontrolador principal | — |
| Sensor DS18B20 | Temperatura da água | GPIO4 (One-Wire) |
| Sensor PH-4502C | pH da água | GPIO34 (ADC) |
| Sensor de turbidez | Turbidez em NTU | GPIO35 (ADC) |
| Sensor TDS/salinidade | Salinidade em ppt | GPIO32 (ADC) |
| LED verde | Status normal | GPIO25 |
| LED amarelo | Status atenção | GPIO26 |
| LED vermelho | Status crítico | GPIO27 |
| Buzzer ativo | Alarme sonoro crítico | GPIO14 |
| Botão | Silenciar alarme local | GPIO13 |
| Resistor 4,7 kΩ | Pull-up do DS18B20 | Entre VCC e GPIO4 |
| Protoboard + jumpers | Montagem | — |

---

## Tópicos MQTT

| Tópico | Tipo | Descrição |
|---|---|---|
| `edensense/viveiro1/status` | JSON | Leitura completa: `{"temperatura":27.4,"ph":7.8,...}` |
| `edensense/viveiro1/temperatura` | número | Temperatura em °C (ex: `27.4`) |
| `edensense/viveiro1/ph` | número | pH da água (ex: `7.8`) |
| `edensense/viveiro1/turbidez` | número | Turbidez em NTU (ex: `18`) |
| `edensense/viveiro1/salinidade` | número | Salinidade em ppt (ex: `22.0`) |
| `edensense/viveiro1/alerta` | texto | Mensagem de alerta gerada pelo ESP32 |

---

## Faixas ideais dos parâmetros

| Parâmetro | Mínimo | Máximo | Unidade | Ação se crítico |
|---|---|---|---|---|
| Temperatura | 23 | 30 | °C | Renovar água + intensificar aeração |
| pH | 7,5 | 8,5 | pH | Aplicar calcário dolomítico |
| Turbidez | 0 | 30 | NTU | Renovação de água + investigar causa |
| Salinidade | 10 | 35 | ppt | Renovar com água de salinidade adequada |

---

## Tecnologias utilizadas

| Camada | Tecnologia |
|---|---|
| Hardware | ESP32 DevKit V1, sensores analógicos e digital One-Wire |
| Comunicação | MQTT sobre TLS — HiveMQ Cloud (gratuito) |
| Frontend | HTML5, CSS3, JavaScript puro (sem framework) |
| Banco de dados | Firebase Realtime Database (plano Spark — gratuito) |
| Bot de alertas | Python 3.10+, python-telegram-bot 20+, paho-mqtt |
| Firmware | Arduino IDE / PlatformIO |
| Visão computacional | ESP32-CAM + OpenCV (planejado) |

---

## Status do projeto

- [x] Dashboard web completo com modo simulação
- [x] Conexão MQTT em tempo real com HiveMQ Cloud
- [x] Firebase salvando e carregando histórico
- [x] Bot Telegram com alertas inteligentes e cooldown
- [x] Comandos `/status`, `/historico`, `/silenciar`, `/ativar`
- [ ] Firmware ESP32 (aguardando chegada do hardware)
- [ ] Leitura da fita colorimétrica com ESP32-CAM
- [ ] App mobile (React Native ou PWA)
- [ ] IA preditiva de qualidade da água

---

## Segurança — IMPORTANTE

Os arquivos abaixo contêm **senhas, tokens e chaves de API reais**.
O `.gitignore` já os bloqueia, mas confirme antes de qualquer `git push`:

| Arquivo | O que contém |
|---|---|
| `dashboard/config.js` | Usuário e senha do broker MQTT |
| `bot/config_telegram.py` | Token do bot Telegram + credenciais MQTT |

**Nunca compartilhe esses arquivos publicamente.**
Se acidentalmente subir ao GitHub, revogue os tokens imediatamente:
- Token Telegram: `/revoke` no @BotFather
- MQTT HiveMQ: painel → Access Management → deletar credencial

---

## Próximos passos

1. **Quando o hardware chegar** — montar o circuito e fazer upload do `firmware/firmware.ino`
2. **Antes de 10/07/2026** — atualizar regras do Firebase para produção (ver `docs/ARQUITETURA.md`)
3. **Futuro** — visão computacional da fita colorimétrica com ESP32-CAM

---

## Desenvolvedor

**Isaac da Silva Viana**
Estudante de Sistemas de Informação — Unicatólica de Quixadá
Startup EdenSense — Vale do Jaguaribe, Ceará

---

*EdenSense © 2026 — Carcinicultura Inteligente*
