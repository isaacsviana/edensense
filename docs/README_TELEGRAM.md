# EdenSense — Notificações via Telegram

Guia completo para configurar o bot que envia alertas automáticos
sobre o viveiro diretamente no celular do produtor.

---

## Como funciona

```
ESP32  →  Broker MQTT  →  telegram_bot.py  →  Telegram do produtor
```

O servidor Python (`telegram_bot.py`) fica rodando em segundo plano,
assina os tópicos MQTT do viveiro e envia mensagem no Telegram sempre
que um parâmetro sair da faixa ideal.

---

## 1. Criar o bot no Telegram (passo a passo com @BotFather)

1. Abra o Telegram e busque por **@BotFather**
2. Envie o comando `/newbot`
3. Escolha um **nome de exibição** para o bot (ex: `EdenSense Viveiro`)
4. Escolha um **username** único que termine em `bot` (ex: `edensense_viveiro_bot`)
5. O BotFather enviará uma mensagem com o **Token de acesso**, parecido com:
   ```
   7123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. Copie esse token e cole em `config_telegram.py`:
   ```python
   TELEGRAM_BOT_TOKEN = "7123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```

> ⚠️ Guarde o token em segredo. Com ele, qualquer pessoa controla o bot.

---

## 2. Obter o Chat ID do produtor

O Chat ID identifica para qual conversa o bot vai enviar as mensagens.

**Passo a passo:**

1. Abra o Telegram e inicie uma conversa com o bot que você criou
   (busque pelo username, ex: `@edensense_viveiro_bot`)
2. Envie qualquer mensagem para ele (ex: `Olá`)
3. Abra o seguinte endereço no navegador (substitua `SEU_TOKEN`):
   ```
   https://api.telegram.org/botSEU_TOKEN/getUpdates
   ```
4. Procure pelo campo `"id"` dentro de `"chat"`:
   ```json
   {
     "message": {
       "chat": {
         "id": 987654321,
         ...
       }
     }
   }
   ```
5. Copie esse número e cole em `config_telegram.py`:
   ```python
   TELEGRAM_CHAT_ID = "987654321"
   ```

> 💡 Para notificar um grupo: adicione o bot ao grupo e use o ID do grupo
> (geralmente começa com `-`).

---

## 3. Instalar as dependências Python

Certifique-se de ter o **Python 3.10 ou superior** instalado.

```bash
# Instala todas as dependências de uma vez
pip install -r requirements.txt
```

Para verificar se a instalação funcionou:

```bash
python -c "import paho.mqtt.client; import telegram; print('OK')"
```

---

## 4. Configurar e rodar o servidor

1. Edite `config_telegram.py` com suas credenciais reais:
   ```python
   TELEGRAM_BOT_TOKEN = "seu_token_aqui"
   TELEGRAM_CHAT_ID   = "seu_chat_id_aqui"
   MQTT_HOST          = "seu-broker.hivemq.cloud"
   MQTT_USUARIO       = "seu_usuario"
   MQTT_SENHA         = "sua_senha"
   ```

2. Execute o servidor:
   ```bash
   python telegram_bot.py
   ```

3. Você verá no terminal:
   ```
   10/06/2026 14:32:00  [INFO]  MQTT: Conectado com sucesso
   10/06/2026 14:32:00  [INFO]  MQTT: assinando edensense/viveiro1/status
   10/06/2026 14:32:00  [INFO]  EdenSense: sistema de notificações iniciado
   ```

---

## 5. Deixar rodando em segundo plano

### Windows

**Opção A — Minimizado no terminal (simples):**
```batch
start /B pythonw telegram_bot.py
```

**Opção B — Serviço permanente com NSSM:**
1. Baixe o [NSSM](https://nssm.cc/download) e extraia
2. Abra o terminal como administrador na pasta do NSSM
3. Execute:
   ```batch
   nssm install EdenSenseTelegram
   ```
4. Na janela que abrir, configure:
   - **Path:** caminho do Python (ex: `C:\Python311\python.exe`)
   - **Arguments:** caminho completo do `telegram_bot.py`
   - **Startup directory:** pasta do projeto
5. Clique em "Install service"
6. Inicie o serviço:
   ```batch
   nssm start EdenSenseTelegram
   ```

### Linux / Raspberry Pi

**Opção A — Rodar em background simples:**
```bash
nohup python telegram_bot.py > edensense.log 2>&1 &
echo $! > edensense.pid  # salva o PID para parar depois
```

Para parar:
```bash
kill $(cat edensense.pid)
```

**Opção B — Serviço systemd (reinicia automaticamente):**

Crie o arquivo `/etc/systemd/system/edensense-telegram.service`:
```ini
[Unit]
Description=EdenSense Telegram Bot
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/edensense
ExecStart=/usr/bin/python3 /home/pi/edensense/telegram_bot.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Ativar e iniciar:
```bash
sudo systemctl daemon-reload
sudo systemctl enable edensense-telegram
sudo systemctl start edensense-telegram

# Ver status e logs:
sudo systemctl status edensense-telegram
sudo journalctl -u edensense-telegram -f
```

---

## 6. Testar se está funcionando

**Teste 1 — Verificar se o bot responde:**
1. Abra o Telegram e envie `/status` para o bot
2. Ele deve responder com as leituras atuais dos sensores

**Teste 2 — Simular um alerta:**
Use o terminal ou um cliente MQTT para publicar um valor fora da faixa:
```bash
# Exemplo com mosquitto_pub (instalar com: sudo apt install mosquitto-clients)
mosquitto_pub \
  -h SEU-BROKER.hivemq.cloud \
  -p 8883 \
  --tls-use-os-certs \
  -u SEU_USUARIO \
  -P SUA_SENHA \
  -t "edensense/viveiro1/status" \
  -m '{"temperatura": 33.5, "ph": 7.8, "turbidez": 15, "salinidade": 22}'
```

O bot deve enviar imediatamente:
```
🚨 RISCO CRÍTICO — EdenSense
Viveiro: Viveiro 01 · Jaguaribe · CE
Parâmetro: Temperatura
Valor atual: 33.5°C
...
```

**Teste 3 — Verificar o log:**
```bash
cat alertas_log.json
```

---

## 7. Comandos disponíveis no Telegram

| Comando | O que faz |
|---|---|
| `/start` | Mensagem de boas-vindas e instruções iniciais |
| `/status` | Leitura atual dos 4 sensores (temperatura, pH, turbidez, salinidade) |
| `/historico` | Últimos 10 alertas enviados pelo sistema |
| `/silenciar 30` | Silencia alertas por 30 minutos |
| `/silenciar 60` | Silencia alertas por 60 minutos (qualquer valor entre 5 e 480) |
| `/ativar` | Reativa os alertas imediatamente |
| `/ajuda` | Lista todos os comandos com descrição |

> ⚠️ Alertas **CRÍTICOS** (🚨 vermelho) **nunca são silenciados** — o produtor
> sempre é notificado de situações de risco imediato.

---

## Regras de envio inteligente

| Situação | Comportamento |
|---|---|
| Mesmo sensor, mesmo nível | Envia no máximo 1× a cada 15 minutos |
| Sensor escala (⚠️ → 🚨) | Envia **imediatamente**, sem esperar cooldown |
| Sensor normaliza | Envia mensagem ✅ uma única vez |
| Alertas silenciados | Segura os envios amarelos; críticos passam |

---

## Arquivos gerados

| Arquivo | Descrição |
|---|---|
| `telegram_bot.py` | Servidor principal |
| `config_telegram.py` | Credenciais (não subir ao GitHub) |
| `requirements.txt` | Dependências Python |
| `alertas_log.json` | Histórico persistente de alertas enviados |

---

## Solução de problemas

**Bot não responde ao /status:**
- Verifique se `TELEGRAM_BOT_TOKEN` está correto em `config_telegram.py`
- Confirme que você iniciou uma conversa com o bot antes de testar

**Nenhum alerta chegando:**
- Verifique o terminal — deve mostrar `MQTT: Conectado com sucesso`
- Confirme que o ESP32 está publicando nos tópicos corretos
- Teste publicando manualmente (ver Teste 2 acima)

**Erro de TLS/SSL:**
- O HiveMQ Cloud requer TLS na porta 8883
- Verifique se `MQTT_PORTA = 8883` em `config_telegram.py`

**`ModuleNotFoundError`:**
- Execute novamente: `pip install -r requirements.txt`
- Se usar múltiplos Pythons: `python3 -m pip install -r requirements.txt`
