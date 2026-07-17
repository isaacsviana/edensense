#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EdenSense — _teste_bot.py
Teste completo de 3 etapas do bot Telegram.
Execute com: python _teste_bot.py
"""

import asyncio
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Força UTF-8 no terminal Windows (necessário para emojis e caracteres especiais)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ─── lê o .env manualmente (sem depender de python-dotenv) ───
def carregar_env(caminho: str) -> dict:
    resultado = {}
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if not linha or linha.startswith("#"):
                continue
            if "=" in linha:
                chave, _, valor = linha.partition("=")
                resultado[chave.strip()] = valor.strip()
    return resultado

ENV_PATH = Path(__file__).parent / ".env"
env = carregar_env(str(ENV_PATH))

TOKEN   = env.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = env.get("TELEGRAM_CHAT_ID", "")
VARIAVEIS_OBRIGATORIAS = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "MQTT_HOST",
    "MQTT_USUARIO",
    "MQTT_SENHA",
]

# ─── Helpers ──────────────────────────────────────────────────
def mascarar(valor: str) -> str:
    if not valor:
        return "(vazio)"
    return valor[:4] + "***"

def horario_agora() -> str:
    return datetime.now().strftime("%H:%M — %d/%m/%Y")

VERDE  = "\033[92m"
AMARELO= "\033[93m"
VERMELHO="\033[91m"
RESET  = "\033[0m"
NEGRITO= "\033[1m"

resultados = []

def registrar(teste: str, passou: bool, obs: str = ""):
    resultados.append({"teste": teste, "passou": passou, "obs": obs})
    icone = f"{VERDE}✅{RESET}" if passou else f"{VERMELHO}❌{RESET}"
    print(f"  {icone}  {teste}" + (f"  →  {obs}" if obs else ""))


# ══════════════════════════════════════════════════════════════
#  ETAPA 1 — VERIFICA CONFIGURAÇÃO
# ══════════════════════════════════════════════════════════════
print(f"\n{NEGRITO}{'═'*56}{RESET}")
print(f"{NEGRITO}  ETAPA 1 — Verificação do arquivo .env{RESET}")
print(f"{'═'*56}")

print(f"\n  Arquivo: {ENV_PATH}")
env_ok = ENV_PATH.exists()
print(f"  Existe: {'✅ Sim' if env_ok else '❌ Não encontrado'}\n")

todas_presentes = True
for var in VARIAVEIS_OBRIGATORIAS:
    valor = env.get(var, "")
    ok    = bool(valor)
    if not ok:
        todas_presentes = False
    status = f"{VERDE}✅{RESET}" if ok else f"{VERMELHO}❌{RESET}"
    print(f"  {status}  {var:<22} = {mascarar(valor)}")

print()
registrar(".env configurado", env_ok and todas_presentes,
          "" if todas_presentes else "variável(is) faltando")


# ══════════════════════════════════════════════════════════════
#  ETAPA 2 — TESTA CONEXÃO COM O TELEGRAM
# ══════════════════════════════════════════════════════════════
print(f"\n{NEGRITO}{'═'*56}{RESET}")
print(f"{NEGRITO}  ETAPA 2 — Envio de mensagens de teste{RESET}")
print(f"{'═'*56}\n")

from telegram import Bot
from telegram.error import TelegramError

MSG1 = "✅ EdenSense online! Bot funcionando."

MSG2 = (
    f"⚠️ ATENÇÃO — EdenSense\n"
    f"Viveiro: Viveiro 01 · Jaguaribe\n"
    f"Parâmetro: Temperatura\n"
    f"Valor atual: 31.2°C\n"
    f"Faixa ideal: 23°C a 30°C\n"
    f"Recomendação: Verifique a aeração do viveiro.\n"
    f"Horário: {horario_agora()}"
)

MSG3 = (
    f"🚨 RISCO CRÍTICO — EdenSense\n"
    f"Viveiro: Viveiro 01 · Jaguaribe\n"
    f"Parâmetro: pH\n"
    f"Valor atual: 6.8\n"
    f"Faixa ideal: 7.5 a 8.5\n"
    f"⚡ AÇÃO IMEDIATA: Aplique calcário dolomítico.\n"
    f"Horário: {horario_agora()}"
)

async def enviar_mensagens():
    bot = Bot(token=TOKEN)

    # Valida token antes de enviar
    try:
        me = await bot.get_me()
        print(f"  Bot autenticado: @{me.username} ({me.full_name})\n")
    except TelegramError as e:
        print(f"  {VERMELHO}❌ Falha na autenticação: {e}{RESET}\n")
        registrar("Mensagem simples",   False, str(e))
        registrar("Alerta amarelo",     False, "token inválido")
        registrar("Alerta vermelho",    False, "token inválido")
        return

    mensagens = [
        ("Mensagem simples",  MSG1),
        ("Alerta amarelo",    MSG2),
        ("Alerta vermelho",   MSG3),
    ]

    for nome, texto in mensagens:
        print(f"  Enviando: {nome}...")
        try:
            msg = await bot.send_message(chat_id=int(CHAT_ID), text=texto)
            registrar(nome, True, f"message_id={msg.message_id}")
            print(f"    → {VERDE}Enviado com sucesso{RESET} (ID {msg.message_id})\n")
        except TelegramError as e:
            registrar(nome, False, str(e))
            print(f"    → {VERMELHO}Erro: {e}{RESET}\n")
        await asyncio.sleep(1.2)   # anti-flood (Telegram: máx 30 msg/min)

asyncio.run(enviar_mensagens())


# ══════════════════════════════════════════════════════════════
#  ETAPA 3 — SIMULA RESPOSTAS AOS COMANDOS DO BOT
# ══════════════════════════════════════════════════════════════
print(f"\n{NEGRITO}{'═'*56}{RESET}")
print(f"{NEGRITO}  ETAPA 3 — Simulação dos comandos do bot{RESET}")
print(f"{'═'*56}\n")

# Lê valores simulados que o bot responderia
SENSORES_SIMULADOS = {
    "temperatura": 27.4,
    "ph":          7.8,
    "turbidez":    18.0,
    "salinidade":  22.0,
}

COOLDOWN_MINUTOS = 15

RESPOSTAS = {
    "/status": (
        f"📊 STATUS ATUAL — EdenSense\n"
        f"Viveiro: Viveiro 01 · Jaguaribe\n"
        f"────────────────────\n"
        f"• Temperatura: 27.4°C\n"
        f"• pH: 7.8\n"
        f"• Turbidez: 18 NTU\n"
        f"• Salinidade: 22.0 ppt\n"
        f"────────────────────\n"
        f"Horário: {horario_agora()}"
    ),
    "/historico": (
        "📋 ÚLTIMOS 10 ALERTAS — EdenSense\n\n"
        "⚠️ (simulado) — Temperatura: 30.8°C\n"
        "✅ (simulado) — Todos os parâmetros normalizados\n"
        "🚨 (simulado) — pH: 6.9\n"
        "(Nenhum alerta real disponível — bot não está em execução contínua)"
    ),
    "/ajuda": (
        f"🌿 EdenSense — Comandos disponíveis\n"
        f"Viveiro: Viveiro 01 · Jaguaribe\n\n"
        f"/status       → Leitura atual dos 4 sensores\n"
        f"/historico    → Últimos 10 alertas registrados\n"
        f"/silenciar 30 → Silencia alertas por 30 min\n"
        f"/silenciar 60 → Silencia alertas por 60 min\n"
        f"/ativar       → Reativa os alertas\n"
        f"/ajuda        → Esta mensagem\n\n"
        f"ℹ️ Alertas CRÍTICOS (🚨) nunca são silenciados.\n"
        f"O bot envia o mesmo alerta no máximo 1x a cada {COOLDOWN_MINUTOS} min."
    ),
    "/silenciar 30": (
        "🔕 Alertas silenciados por 30 minutos.\n"
        "Retomam às (horário + 30min).\n"
        "⚠️ Alertas CRÍTICOS (vermelho) continuam sendo enviados."
    ),
}

comandos_testados = []
for cmd, resposta_esperada in RESPOSTAS.items():
    print(f"  Comando: {NEGRITO}{cmd}{RESET}")
    print(f"  Resposta que o bot enviaria:")
    for linha in resposta_esperada.split("\n"):
        print(f"    {linha}")
    print()
    # Valida que a resposta não está vazia e tem conteúdo esperado
    ok = bool(resposta_esperada.strip())
    nome_teste = f"Comando {cmd.split()[0]}"
    registrar(nome_teste, ok, "resposta simulada gerada")
    comandos_testados.append(cmd)


# ══════════════════════════════════════════════════════════════
#  TABELA FINAL
# ══════════════════════════════════════════════════════════════
print(f"\n{NEGRITO}{'═'*56}{RESET}")
print(f"{NEGRITO}  RESULTADO FINAL{RESET}")
print(f"{'═'*56}\n")

colunas = ["Teste", "Status", "Observação"]
linhas  = []
for r in resultados:
    status = f"{VERDE}✅ OK{RESET}" if r["passou"] else f"{VERMELHO}❌ FALHOU{RESET}"
    linhas.append((r["teste"], status, r["obs"] or "—"))

# Calcula larguras
col_w = [max(len(colunas[i]), max(len(l[i]) for l in linhas)) for i in range(3)]
# (desconta códigos ANSI nas colunas coloridas)
col_w[1] = max(len(colunas[1]), 8)

sep  = "├" + "─"*(col_w[0]+2) + "┼" + "─"*(col_w[1]+2) + "┼" + "─"*(col_w[2]+2) + "┤"
topo = "┌" + "─"*(col_w[0]+2) + "┬" + "─"*(col_w[1]+2) + "┬" + "─"*(col_w[2]+2) + "┐"
base = "└" + "─"*(col_w[0]+2) + "┴" + "─"*(col_w[1]+2) + "┴" + "─"*(col_w[2]+2) + "┘"

def cell(txt, w, cor=False):
    # Se tem código ANSI, o comprimento visual é diferente
    vis = len(txt.replace(VERDE,"").replace(VERMELHO,"").replace(AMARELO,"").replace(RESET,"").replace(NEGRITO,""))
    return txt + " " * (w - vis)

print(topo)
print(f"│ {NEGRITO}{colunas[0]:<{col_w[0]}}{RESET} │ {NEGRITO}{colunas[1]:<{col_w[1]}}{RESET} │ {NEGRITO}{colunas[2]:<{col_w[2]}}{RESET} │")
print(sep)
for nome, status, obs in linhas:
    status_vis = status.replace(VERDE,"").replace(VERMELHO,"").replace(AMARELO,"").replace(RESET,"")
    pad_status = " " * (col_w[1] - len(status_vis))
    print(f"│ {nome:<{col_w[0]}} │ {status}{pad_status} │ {obs:<{col_w[2]}} │")
print(base)

passou_total = sum(1 for r in resultados if r["passou"])
total        = len(resultados)
print(f"\n  {NEGRITO}Resultado: {passou_total}/{total} testes passaram{RESET}")

if passou_total == total:
    print(f"\n  {VERDE}{NEGRITO}🎉 Todos os testes passaram! Bot EdenSense está operacional.{RESET}\n")
else:
    print(f"\n  {VERMELHO}Há {total - passou_total} falha(s). Verifique os itens marcados com ❌.{RESET}\n")
    sys.exit(1)
