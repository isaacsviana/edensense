#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EdenSense — telegram_bot.py
Servidor de notificações Telegram para carcinicultura.

Fluxo:
  ESP32 lê sensor
    → publica MQTT
      → este servidor assina os tópicos
        → avalia parâmetros
          → envia alerta no Telegram do produtor

Como rodar:
  python telegram_bot.py

Dependências:
  pip install -r requirements.txt
"""

import asyncio
import json
import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import paho.mqtt.client as mqtt
from telegram import Bot, Update
from telegram.ext import Application, CommandHandler, ContextTypes

# Importa as credenciais do arquivo de configuração separado
from config_telegram import (
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    NOME_VIVEIRO,
    LOCAL_VIVEIRO,
    MQTT_HOST,
    MQTT_PORTA,
    MQTT_USUARIO,
    MQTT_SENHA,
)


# ═══════════════════════════════════════════════════
#  SEGURANÇA: AUTORIZAÇÃO E RATE LIMITING
# ═══════════════════════════════════════════════════

def _autorizado(update) -> bool:
    """
    SEGURANÇA: verifica se a mensagem veio do chat_id autorizado.
    Rejeita silenciosamente qualquer outra origem.
    """
    chat_id_recebido = str(update.effective_chat.id)
    return chat_id_recebido == str(TELEGRAM_CHAT_ID)


# SEGURANÇA: rate limiting — máximo 10 comandos por minuto por chat_id
_rate_limit: dict = defaultdict(list)
_RATE_MAX    = 10
_RATE_JANELA = 60  # segundos


def _dentro_do_limite(chat_id: str) -> bool:
    """Retorna True se ainda está dentro do limite de comandos."""
    agora  = time.time()
    janela = _rate_limit[chat_id]
    # Remove timestamps fora da janela de 60s
    _rate_limit[chat_id] = [t for t in janela if agora - t < _RATE_JANELA]
    if len(_rate_limit[chat_id]) >= _RATE_MAX:
        return False
    _rate_limit[chat_id].append(agora)
    return True


# ═══════════════════════════════════════════════════
#  LOGGING
#  Exibe data/hora, nível e mensagem no terminal
# ═══════════════════════════════════════════════════
logging.basicConfig(
    format="%(asctime)s  [%(levelname)s]  %(message)s",
    datefmt="%d/%m/%Y %H:%M:%S",
    level=logging.INFO,
)
logger = logging.getLogger("EdenSense")


# ═══════════════════════════════════════════════════
#  TÓPICOS MQTT
#  Devem coincidir exatamente com os que o ESP32
#  publica no firmware
# ═══════════════════════════════════════════════════
TOPICO_STATUS = "edensense/viveiro1/status"   # JSON completo
TOPICO_ALERTA = "edensense/viveiro1/alerta"   # texto de alerta livre


# ═══════════════════════════════════════════════════
#  PARÂMETROS DOS SENSORES
#  Limites, mensagens e função de avaliação
#  para cada sensor monitorado
# ═══════════════════════════════════════════════════
PARAMETROS = {
    "temperatura": {
        "nome":          "Temperatura",
        "faixa_texto":   "23°C a 30°C",
        "unidade":       "°C",
        "rec_amarelo":   "Verifique a aeração do viveiro.",
        "acao_vermelho": "Reduza a temperatura renovando água e intensificando aeração.",
        # Retorna 'normal', 'amarelo' ou 'vermelho'
        "avaliar": lambda v: (
            "vermelho" if v > 32 else
            "amarelo"  if (v < 23 or v > 30) else
            "normal"
        ),
    },
    "ph": {
        "nome":          "pH",
        "faixa_texto":   "7.5 a 8.5",
        "unidade":       "",
        "rec_amarelo":   "Monitore de perto e prepare solução corretiva.",
        "acao_vermelho": "Aplique calcário dolomítico imediatamente para corrigir o pH.",
        "avaliar": lambda v: (
            "vermelho" if (v < 7.0 or v > 9.0) else
            "amarelo"  if (v < 7.5 or v > 8.5) else
            "normal"
        ),
    },
    "turbidez": {
        "nome":          "Turbidez",
        "faixa_texto":   "0 a 30 NTU",
        "unidade":       " NTU",
        "rec_amarelo":   "Verifique a biota e reduza a alimentação.",
        "acao_vermelho": "Faça renovação de água e identifique a causa da turbidez.",
        "avaliar": lambda v: (
            "vermelho" if v > 50 else
            "amarelo"  if v > 30 else
            "normal"
        ),
    },
    "salinidade": {
        "nome":          "Salinidade",
        "faixa_texto":   "10 a 35 ppt",
        "unidade":       " ppt",
        "rec_amarelo":   "Ajuste a entrada de água doce ou salgada conforme necessário.",
        "acao_vermelho": "Realize renovação urgente com água de salinidade adequada.",
        "avaliar": lambda v: (
            "vermelho" if (v < 5 or v > 40) else
            "amarelo"  if (v < 10 or v > 35) else
            "normal"
        ),
    },
}


# ═══════════════════════════════════════════════════
#  ESTADO GLOBAL
#  Compartilhado entre as threads MQTT e asyncio.
#  Protegido por threading.Lock onde necessário.
# ═══════════════════════════════════════════════════

# Últimas leituras recebidas pelo MQTT
sensores_atuais: dict = {k: None for k in PARAMETROS}

# Último nível enviado ao Telegram para cada sensor
#   None     = nunca enviou
#   'normal' = último envio foi normalização
#   'amarelo'/'vermelho' = último envio foi alerta
ultimo_nivel_enviado: dict = {k: None for k in PARAMETROS}

# Timestamp do último envio por sensor
ultimo_envio_ts: dict = {k: None for k in PARAMETROS}

# Silenciamento agendado: datetime até quando fica mudo
silenciado_ate: datetime | None = None

# Histórico de alertas enviados (máximo 500 entradas em memória)
alertas_log: list = []

# Lock para acesso seguro ao estado compartilhado
estado_lock = threading.Lock()

# Referência ao loop asyncio (preenchida em main())
loop_asyncio: asyncio.AbstractEventLoop | None = None

# Cooldown: intervalo mínimo entre alertas do mesmo sensor/nível
COOLDOWN_MINUTOS = 15

# Arquivo de log persistente
LOG_ARQUIVO = Path("alertas_log.json")


# ═══════════════════════════════════════════════════
#  PERSISTÊNCIA DO LOG
# ═══════════════════════════════════════════════════

def carregar_log() -> list:
    """Carrega o histórico salvo em disco ao iniciar."""
    if not LOG_ARQUIVO.exists():
        return []
    try:
        with open(LOG_ARQUIVO, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Não foi possível carregar o log anterior: {e}")
        return []


def salvar_log_em_disco() -> None:
    """Persiste o histórico em alertas_log.json."""
    try:
        with open(LOG_ARQUIVO, "w", encoding="utf-8") as f:
            json.dump(alertas_log, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Erro ao salvar log: {e}")


def registrar_log(sensor_key: str, nivel: str, valor: float, mensagem: str) -> None:
    """Adiciona uma entrada ao log e persiste."""
    entrada = {
        "timestamp": datetime.now().isoformat(),
        "sensor":    sensor_key,
        "nivel":     nivel,
        "valor":     round(valor, 2),
        "mensagem":  mensagem,
    }
    alertas_log.insert(0, entrada)
    # Limita a 500 entradas para não crescer indefinidamente
    del alertas_log[500:]
    salvar_log_em_disco()


# ═══════════════════════════════════════════════════
#  FORMATADORES DE MENSAGEM TELEGRAM
# ═══════════════════════════════════════════════════

def _horario_agora() -> str:
    """Retorna horário formatado para o rodapé das mensagens."""
    agora = datetime.now()
    return f"{agora.strftime('%H:%M')} — {agora.strftime('%d/%m/%Y')}"


def formatar_alerta(sensor_key: str, nivel: str, valor: float) -> str:
    """Formata a mensagem completa conforme o nível do alerta."""
    p = PARAMETROS[sensor_key]
    unidade = p["unidade"]
    # Inteiro para turbidez, 1 decimal para os demais
    valor_str = (f"{int(round(valor))}{unidade}" if sensor_key == "turbidez"
                 else f"{valor:.1f}{unidade}")

    if nivel == "vermelho":
        return (
            f"🚨 RISCO CRÍTICO — EdenSense\n"
            f"Viveiro: {NOME_VIVEIRO} · {LOCAL_VIVEIRO}\n"
            f"Parâmetro: {p['nome']}\n"
            f"Valor atual: {valor_str}\n"
            f"Faixa ideal: {p['faixa_texto']}\n"
            f"⚡ AÇÃO IMEDIATA: {p['acao_vermelho']}\n"
            f"Horário: {_horario_agora()}"
        )

    if nivel == "amarelo":
        return (
            f"⚠️ ATENÇÃO — EdenSense\n"
            f"Viveiro: {NOME_VIVEIRO} · {LOCAL_VIVEIRO}\n"
            f"Parâmetro: {p['nome']}\n"
            f"Valor atual: {valor_str}\n"
            f"Faixa ideal: {p['faixa_texto']}\n"
            f"Recomendação: {p['rec_amarelo']}\n"
            f"Horário: {_horario_agora()}"
        )

    # nivel == 'normal' → mensagem de normalização
    return (
        f"✅ NORMALIZADO — EdenSense\n"
        f"Viveiro: {NOME_VIVEIRO} · {LOCAL_VIVEIRO}\n"
        f"Parâmetro: {p['nome']}\n"
        f"Valor atual: {valor_str}\n"
        f"Status: Dentro da faixa ideal.\n"
        f"Horário: {_horario_agora()}"
    )


# ═══════════════════════════════════════════════════
#  LÓGICA DE ENVIO COM COOLDOWN
#  Regras:
#   • Mesmo sensor, mesmo nível → cooldown 15 min
#   • Escalonamento (amarelo → vermelho) → imediato
#   • Normalização → envia uma vez
#   • Silenciamento respeita /silenciar (exceto vermelho)
# ═══════════════════════════════════════════════════

async def verificar_e_alertar(bot: Bot, sensor_key: str, valor: float) -> None:
    """
    Avalia o valor do sensor e decide se envia (ou não) mensagem ao Telegram.
    Chamada a partir do handler MQTT via run_coroutine_threadsafe.
    """
    p = PARAMETROS[sensor_key]
    novo_nivel = p["avaliar"](valor)

    with estado_lock:
        nivel_anterior = ultimo_nivel_enviado.get(sensor_key)
        ts_anterior    = ultimo_envio_ts.get(sensor_key)
        agora          = datetime.now()
        deve_enviar    = False

        if novo_nivel == "normal":
            # Envia normalização apenas se estava em alerta anteriormente
            if nivel_anterior in ("amarelo", "vermelho"):
                deve_enviar = True

        elif novo_nivel == "vermelho":
            if nivel_anterior != "vermelho":
                # Escalou de qualquer nível → imediato
                deve_enviar = True
            elif ts_anterior is None or (agora - ts_anterior) >= timedelta(minutes=COOLDOWN_MINUTOS):
                # Manteve vermelho mas passou o cooldown
                deve_enviar = True

        elif novo_nivel == "amarelo":
            if nivel_anterior not in ("amarelo", "vermelho"):
                # Entrou no amarelo vindo de normal → imediato
                deve_enviar = True
            elif nivel_anterior == "amarelo" and (
                ts_anterior is None or (agora - ts_anterior) >= timedelta(minutes=COOLDOWN_MINUTOS)
            ):
                # Manteve amarelo mas passou o cooldown
                deve_enviar = True

        if not deve_enviar:
            return

        # Verifica silenciamento (alertas críticos vermelho sempre passam)
        if silenciado_ate and agora < silenciado_ate and novo_nivel != "vermelho":
            logger.info(
                f"Alerta silenciado: {sensor_key} — {novo_nivel}. "
                f"Silêncio até {silenciado_ate.strftime('%H:%M')}"
            )
            return

        mensagem = formatar_alerta(sensor_key, novo_nivel, valor)

        # Atualiza estado antes de enviar para evitar duplicatas em falha parcial
        ultimo_nivel_enviado[sensor_key] = novo_nivel if novo_nivel != "normal" else None
        ultimo_envio_ts[sensor_key]      = agora

    # Envia fora do lock para não bloquear outras threads
    try:
        await bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=mensagem)
        registrar_log(sensor_key, novo_nivel, valor, mensagem)
        logger.info(f"Telegram OK  {sensor_key} [{novo_nivel}] = {valor}")
    except Exception as e:
        logger.error(f"Erro ao enviar Telegram: {e}")


# ═══════════════════════════════════════════════════
#  PROCESSAMENTO DE MENSAGENS MQTT
# ═══════════════════════════════════════════════════

async def processar_mensagem_mqtt(bot: Bot, topico: str, payload: str) -> None:
    """Processa uma mensagem MQTT e dispara alertas se necessário."""
    if topico == TOPICO_STATUS:
        try:
            dados = json.loads(payload)
        except json.JSONDecodeError:
            logger.warning(f"JSON inválido recebido no tópico {topico}: {payload[:80]}")
            return

        # Atualiza leituras e avalia cada sensor presente no JSON
        for chave_mqtt, chave_interna in [
            ("temperatura", "temperatura"),
            ("ph",          "ph"),
            ("turbidez",    "turbidez"),
            ("salinidade",  "salinidade"),
        ]:
            if chave_mqtt in dados:
                try:
                    valor = float(dados[chave_mqtt])
                except (ValueError, TypeError):
                    continue

                with estado_lock:
                    sensores_atuais[chave_interna] = valor

                await verificar_e_alertar(bot, chave_interna, valor)

    elif topico == TOPICO_ALERTA:
        # Alerta em texto livre vindo do ESP32 — apenas loga, sem duplicar avaliação
        logger.info(f"Alerta ESP32 recebido: {payload[:120]}")


# ═══════════════════════════════════════════════════
#  CALLBACKS MQTT (síncronos — paho roda em thread)
#  Usa run_coroutine_threadsafe para passar mensagens
#  ao loop asyncio sem bloquear nenhum dos dois lados
# ═══════════════════════════════════════════════════

def ao_conectar_mqtt(client, userdata, flags, rc):
    """Chamado quando o cliente MQTT estabelece conexão."""
    codigos = {
        0: "Conectado com sucesso",
        1: "Versão de protocolo incorreta",
        2: "Identificador de cliente inválido",
        3: "Servidor indisponível",
        4: "Usuário ou senha incorretos",
        5: "Não autorizado",
    }
    if rc == 0:
        logger.info(f"MQTT: {codigos.get(rc, 'OK')}")
        client.subscribe(TOPICO_STATUS, qos=1)
        client.subscribe(TOPICO_ALERTA, qos=1)
        logger.info(f"MQTT: assinando {TOPICO_STATUS}")
        logger.info(f"MQTT: assinando {TOPICO_ALERTA}")
    else:
        logger.error(f"MQTT: falha na conexão — {codigos.get(rc, f'código {rc}')}")


def ao_desconectar_mqtt(client, userdata, rc):
    """Chamado quando o cliente MQTT se desconecta."""
    if rc != 0:
        logger.warning(f"MQTT: desconectado inesperadamente (rc={rc}). Tentando reconectar...")


def ao_receber_mensagem(client, userdata, message):
    """
    Chamado a cada mensagem MQTT.
    Roda na thread do paho — agenda a coroutine no loop asyncio.
    """
    bot: Bot = userdata["bot"]
    topico   = message.topic
    # SEGURANÇA: limita tamanho do payload a 4KB para prevenir DoS
    payload = message.payload.decode("utf-8", errors="replace")
    if len(payload) > 4096:
        logger.warning("Payload MQTT rejeitado: tamanho excede 4096 bytes.")
        return

    if loop_asyncio and not loop_asyncio.is_closed():
        asyncio.run_coroutine_threadsafe(
            processar_mensagem_mqtt(bot, topico, payload),
            loop_asyncio,
        )


# ═══════════════════════════════════════════════════
#  CONEXÃO MQTT
# ═══════════════════════════════════════════════════

def iniciar_mqtt(bot: Bot) -> None:
    """Cria o cliente MQTT e inicia em thread separada."""
    cliente = mqtt.Client(client_id="edensense-telegram-" + datetime.now().strftime("%H%M%S"))
    cliente.username_pw_set(MQTT_USUARIO, MQTT_SENHA)

    # TLS obrigatório no HiveMQ Cloud (porta 8883)
    cliente.tls_set()

    # Passa o objeto Bot como userdata para o callback de mensagem
    cliente.user_data_set({"bot": bot})

    cliente.on_connect    = ao_conectar_mqtt
    cliente.on_disconnect = ao_desconectar_mqtt
    cliente.on_message    = ao_receber_mensagem

    try:
        cliente.connect(MQTT_HOST, MQTT_PORTA, keepalive=60)
    except Exception as e:
        logger.error(f"MQTT: não foi possível conectar — {e}")
        return

    # loop_forever() bloqueia a thread atual — por isso roda em daemon thread
    thread = threading.Thread(target=cliente.loop_forever, daemon=True, name="mqtt-thread")
    thread.start()
    logger.info(f"MQTT: thread iniciada — broker {MQTT_HOST}:{MQTT_PORTA}")


# ═══════════════════════════════════════════════════
#  COMANDOS DO TELEGRAM
#  Funções async chamadas pelo Application do
#  python-telegram-bot ao receber mensagens
# ═══════════════════════════════════════════════════

def _linha_sensor(nome: str, valor, unidade: str) -> str:
    """Formata uma linha de status para /status."""
    if valor is None:
        return f"• {nome}: aguardando leitura..."
    return f"• {nome}: {valor:.1f}{unidade}"


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/status — Envia a leitura atual de todos os sensores."""
    if not _autorizado(update):
        return  # silenciosamente ignora
    chat_str = str(update.effective_chat.id)
    if not _dentro_do_limite(chat_str):
        return  # silenciosamente ignora (não avisa para não confirmar que existe limite)
    with estado_lock:
        leituras = dict(sensores_atuais)  # cópia segura

    linhas = [
        _linha_sensor("Temperatura", leituras["temperatura"], "°C"),
        _linha_sensor("pH",          leituras["ph"],          ""),
        _linha_sensor("Turbidez",    leituras["turbidez"],    " NTU"),
        _linha_sensor("Salinidade",  leituras["salinidade"],  " ppt"),
    ]

    mensagem = (
        f"📊 STATUS ATUAL — EdenSense\n"
        f"Viveiro: {NOME_VIVEIRO} · {LOCAL_VIVEIRO}\n"
        f"────────────────────\n"
        + "\n".join(linhas) +
        f"\n────────────────────\n"
        f"Horário: {_horario_agora()}"
    )
    await update.message.reply_text(mensagem)


async def cmd_historico(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/historico — Envia os últimos 10 alertas registrados."""
    if not _autorizado(update):
        return
    chat_str = str(update.effective_chat.id)
    if not _dentro_do_limite(chat_str):
        return
    if not alertas_log:
        await update.message.reply_text(
            "Nenhum alerta registrado nesta sessão ainda.\n"
            "Os alertas aparecem aqui assim que forem disparados."
        )
        return

    emojis = {"vermelho": "🚨", "amarelo": "⚠️", "normal": "✅"}
    linhas = []
    for entrada in alertas_log[:10]:
        ts   = datetime.fromisoformat(entrada["timestamp"]).strftime("%d/%m %H:%M")
        emoji = emojis.get(entrada["nivel"], "ℹ️")
        nome  = PARAMETROS.get(entrada["sensor"], {}).get("nome", entrada["sensor"])
        valor = entrada.get("valor", "?")
        unidade = PARAMETROS.get(entrada["sensor"], {}).get("unidade", "")
        linhas.append(f"{emoji} {ts} — {nome}: {valor}{unidade}")

    mensagem = "📋 ÚLTIMOS 10 ALERTAS — EdenSense\n\n" + "\n".join(linhas)
    await update.message.reply_text(mensagem)


async def cmd_silenciar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/silenciar <minutos> — Silencia alertas por N minutos (padrão: 30)."""
    if not _autorizado(update):
        return
    chat_str = str(update.effective_chat.id)
    if not _dentro_do_limite(chat_str):
        return
    global silenciado_ate

    # Tenta ler o argumento numérico; padrão = 30
    try:
        minutos = int(context.args[0]) if context.args else 30
        # Limita entre 5 e 480 minutos (8 horas)
        minutos = max(5, min(480, minutos))
    except ValueError:
        await update.message.reply_text(
            "Uso: /silenciar <minutos>\nExemplo: /silenciar 30\nFaixa: 5 a 480 minutos."
        )
        return

    silenciado_ate = datetime.now() + timedelta(minutes=minutos)

    await update.message.reply_text(
        f"🔕 Alertas silenciados por {minutos} minutos.\n"
        f"Retomam às {silenciado_ate.strftime('%H:%M')}.\n"
        f"⚠️ Alertas CRÍTICOS (vermelho) continuam sendo enviados."
    )
    logger.info(f"Alertas silenciados até {silenciado_ate.strftime('%H:%M')} por /silenciar {minutos}")


async def cmd_ativar(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/ativar — Reativa os alertas imediatamente."""
    if not _autorizado(update):
        return
    chat_str = str(update.effective_chat.id)
    if not _dentro_do_limite(chat_str):
        return
    global silenciado_ate
    silenciado_ate = None

    await update.message.reply_text(
        "🔔 Alertas reativados com sucesso!\n"
        "O sistema voltará a notificar normalmente."
    )
    logger.info("Alertas reativados via /ativar")


async def cmd_ajuda(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/ajuda — Lista todos os comandos disponíveis."""
    if not _autorizado(update):
        return
    chat_str = str(update.effective_chat.id)
    if not _dentro_do_limite(chat_str):
        return
    texto = (
        f"🌿 EdenSense — Comandos disponíveis\n"
        f"Viveiro: {NOME_VIVEIRO} · {LOCAL_VIVEIRO}\n\n"
        f"/status       → Leitura atual dos 4 sensores\n"
        f"/historico    → Últimos 10 alertas registrados\n"
        f"/silenciar 30 → Silencia alertas por 30 min\n"
        f"/silenciar 60 → Silencia alertas por 60 min\n"
        f"/ativar       → Reativa os alertas\n"
        f"/ajuda        → Esta mensagem\n\n"
        f"ℹ️ Alertas CRÍTICOS (🚨) nunca são silenciados.\n"
        f"O bot envia o mesmo alerta no máximo 1x a cada {COOLDOWN_MINUTOS} min."
    )
    await update.message.reply_text(texto)


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/start — Mensagem de boas-vindas (gerada pelo BotFather)."""
    if not _autorizado(update):
        return
    chat_str = str(update.effective_chat.id)
    if not _dentro_do_limite(chat_str):
        return
    await update.message.reply_text(
        f"🌿 Bem-vindo ao EdenSense!\n\n"
        f"Este bot monitora o {NOME_VIVEIRO} em {LOCAL_VIVEIRO} "
        f"e envia alertas automáticos quando os parâmetros da água saírem da faixa ideal.\n\n"
        f"Use /ajuda para ver todos os comandos disponíveis."
    )


# ═══════════════════════════════════════════════════
#  PONTO DE ENTRADA PRINCIPAL
# ═══════════════════════════════════════════════════

async def main() -> None:
    """
    Inicializa o bot Telegram e o cliente MQTT.
    Roda indefinidamente até Ctrl+C.
    """
    global loop_asyncio
    loop_asyncio = asyncio.get_running_loop()

    # Carrega log persistido em disco
    alertas_log.extend(carregar_log())
    logger.info(f"Log carregado: {len(alertas_log)} registros anteriores")

    # Cria a aplicação Telegram
    app = (
        Application.builder()
        .token(TELEGRAM_BOT_TOKEN)
        .build()
    )

    # Registra os handlers de comandos
    app.add_handler(CommandHandler("start",     cmd_start))
    app.add_handler(CommandHandler("status",    cmd_status))
    app.add_handler(CommandHandler("historico", cmd_historico))
    app.add_handler(CommandHandler("silenciar", cmd_silenciar))
    app.add_handler(CommandHandler("ativar",    cmd_ativar))
    app.add_handler(CommandHandler("ajuda",     cmd_ajuda))

    # Inicializa e inicia o Application (necessário antes de usar app.bot)
    await app.initialize()
    await app.start()

    # Inicia o cliente MQTT em thread daemon
    iniciar_mqtt(app.bot)

    logger.info("EdenSense: sistema de notificações iniciado. Aguardando dados do MQTT...")
    # SEGURANÇA: chat_id não é logado para não expor em logs de servidor
    logger.info("EdenSense: Telegram ativo — bot autorizado e pronto.")

    # Inicia o polling do Telegram (não bloqueante — usa asyncio interno)
    await app.updater.start_polling(
        poll_interval=1.0,
        timeout=20,
        allowed_updates=Update.ALL_TYPES,
    )

    # Mantém o processo vivo indefinidamente
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, SystemExit):
        logger.info("EdenSense: encerrando...")
    finally:
        await app.updater.stop()
        await app.stop()
        await app.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("EdenSense: encerrado pelo usuário.")
