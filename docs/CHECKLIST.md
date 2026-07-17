# EdenSense — Checklist do Projeto

## Arquivos do projeto

- [x] `index.html` — estrutura do dashboard
- [x] `style.css` — visual dark mode responsivo
- [x] `app.js` — lógica do dashboard
- [x] `mqtt.js` — conexão broker
- [x] `config.js` — credenciais MQTT
- [x] `firebase.js` — persistência de dados (modo offline por padrão)
- [x] `telegram_bot.py` — bot de alertas
- [x] `config_telegram.py` — credenciais Telegram
- [x] `.gitignore` — proteção das credenciais

---

## Próximos passos

- [ ] Preencher `config.js` com credenciais reais do HiveMQ
- [ ] Criar conta gratuita no HiveMQ Cloud: https://console.hivemq.cloud
- [ ] Criar bot no Telegram via @BotFather e pegar o token
- [ ] Preencher `config_telegram.py` com `token` e `chat_id`
- [ ] Instalar Python e rodar: `pip install -r requirements.txt`
- [ ] Rodar o bot de alertas: `python telegram_bot.py`
- [ ] Programar o ESP32 com o firmware (`firmware.ino`) quando os componentes chegarem
- [ ] **Opcional:** criar conta Firebase para histórico persistente
  - Ativar a VERSÃO B em `firebase.js` (instruções dentro do arquivo)

---

## Como abrir o dashboard agora (sem hardware)

1. Abra `index.html` diretamente no navegador
2. O dashboard vai funcionar em **modo de simulação**
3. Os valores dos sensores mudam automaticamente a cada 3 segundos
4. Quando preencher o `config.js`, ele tenta conectar ao broker MQTT real
5. Se o MQTT conectar, os dados reais substituem a simulação automaticamente

---

## Estrutura dos tópicos MQTT (deve coincidir com o firmware ESP32)

| Tópico | Conteúdo |
|--------|----------|
| `edensense/viveiro1/status` | JSON com todos os sensores |
| `edensense/viveiro1/temperatura` | número (ex: `27.4`) |
| `edensense/viveiro1/ph` | número (ex: `7.8`) |
| `edensense/viveiro1/turbidez` | número inteiro (ex: `18`) |
| `edensense/viveiro1/salinidade` | número (ex: `22.0`) |
| `edensense/viveiro1/alerta` | texto livre do ESP32 |

---

## Faixas ideais dos parâmetros

| Parâmetro | Faixa ideal | Unidade |
|-----------|-------------|---------|
| Temperatura | 23 – 30 | °C |
| pH | 7.5 – 8.5 | pH |
| Turbidez | 0 – 30 | NTU |
| Salinidade | 10 – 35 | ppt |
