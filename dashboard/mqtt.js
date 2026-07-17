/* ═══════════════════════════════════════════
   EdenSense Dashboard — mqtt.js
   Conexão com o broker MQTT via WebSocket

   COMO FUNCIONA:
   O ESP32 publica dados via Wi-Fi → broker MQTT
   O dashboard assina os tópicos via WebSocket
   Quando chega dado novo, a tela atualiza sozinha

   CREDENCIAIS:
   Definidas em config.js (não subir ao GitHub).
   Este arquivo lê a variável global MQTT_CONFIG.

   DEPENDÊNCIA:
   Usa a biblioteca mqtt.js (carregada no index.html)
   ═══════════════════════════════════════════ */


// SEGURANÇA: logs de debug desativados em produção
const _DEBUG_MQTT = false;
function _log(...a)  { if (_DEBUG_MQTT) console.log('[MQTT]', ...a); }
function _warn(...a) { if (_DEBUG_MQTT) console.warn('[MQTT]', ...a); }
function _err(...a)  { console.error('[MQTT]', ...a); } // erros sempre visíveis

// SEGURANÇA: valida faixas físicas plausíveis — rejeita payloads fora do realismo
const FAIXAS_VALIDAS = {
  temperatura: { min: -10,  max: 100  },
  ph:          { min: 0,    max: 14   },
  turbidez:    { min: 0,    max: 3000 },
  salinidade:  { min: 0,    max: 60   },
};

function validarFaixa(chave, valor) {
  const f = FAIXAS_VALIDAS[chave];
  if (!f) return true;
  return valor >= f.min && valor <= f.max;
}


/* ════════════════════════════
   TÓPICOS MQTT
   ════════════════════════════ */
const TOPICOS = {
  temperatura: 'edensense/viveiro1/temperatura',
  ph:          'edensense/viveiro1/ph',
  turbidez:    'edensense/viveiro1/turbidez',
  salinidade:  'edensense/viveiro1/salinidade',
  status:      'edensense/viveiro1/status',
  alerta:      'edensense/viveiro1/alerta'
};

/* cliente MQTT (criado na conexão) */
let clienteMQTT   = null;
let mqttConectado = false;

/* controle do indicador "sem conexão" */
let ultimoDadoRecebido  = Date.now();
let intervaloSemConexao = null;


/* ════════════════════════════
   RATE LIMITING
   Protege contra flood de mensagens
   Max: 10 msgs/s por tópico; globalmente
   máx 50 msgs/s para todos os tópicos
   ════════════════════════════ */
const RATE_LIMIT_POR_TOPICO = 10;    // máximo de 10 msgs/s por tópico
const RATE_WINDOW_MS        = 1000;  // janela de 1 segundo

const contadoresTopico = {}; // { topico: { count: 0, windowStart: Date.now() } }

function verificarRateLimit(topico) {
  const agora = Date.now();
  if (!contadoresTopico[topico]) {
    contadoresTopico[topico] = { count: 0, windowStart: agora };
  }

  const estado = contadoresTopico[topico];

  /* Reinicia a janela se passou 1 segundo */
  if (agora - estado.windowStart >= RATE_WINDOW_MS) {
    estado.count = 0;
    estado.windowStart = agora;
  }

  estado.count++;

  if (estado.count > RATE_LIMIT_POR_TOPICO) {
    _warn('Rate limit excedido para tópico:', topico, '(' + estado.count + ' msgs/s)');
    return false; /* mensagem rejeitada */
  }

  return true; /* mensagem aceita */
}


/* ════════════════════════════
   BACKOFF EXPONENCIAL
   Aumenta o intervalo de reconexão
   progressivamente ao falhar:
   5s → 10s → 20s → 40s → máx 120s
   ════════════════════════════ */
let tentativaReconexao = 0;
const BACKOFF_BASE_MS  = 5000;
const BACKOFF_MAX_MS   = 120000;

function calcularBackoff() {
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, tentativaReconexao), BACKOFF_MAX_MS);
  tentativaReconexao++;
  return delay;
}

function resetarBackoff() {
  tentativaReconexao = 0;
}


/* ════════════════════════════
   SANITIZAÇÃO ANTI-XSS
   Todo texto vindo do broker MQTT
   é sanitizado antes de ir à tela
   ════════════════════════════ */
function sanitizarTexto(valor) {
  const div = document.createElement('div');
  /* createTextNode trata qualquer string como texto puro, nunca como HTML */
  div.appendChild(document.createTextNode(String(valor)));
  return div.innerHTML;
}

function sanitizarNumero(valor) {
  const n = parseFloat(valor);
  return isNaN(n) ? null : n;
}


/* ════════════════════════════
   INDICADOR DE STATUS MQTT
   ════════════════════════════ */
function atualizarIndicadorMQTT(status) {
  const badge = document.querySelector('.status-badge');
  const pulse = badge ? badge.querySelector('.pulse') : null;

  if (!badge) return;

  if (status === 'conectado') {
    badge.style.color       = 'var(--green)';
    badge.style.borderColor = 'rgba(0,232,122,0.2)';
    badge.style.background  = 'rgba(0,232,122,0.08)';
    if (pulse) pulse.style.background = 'var(--green)';
    badge.innerHTML = '<div class="pulse"></div> AO VIVO · MQTT';
    const tgBadge = document.getElementById('telegramBadge');
    if (tgBadge) tgBadge.style.opacity = '1';
    pararContadorSemConexao();
    resetarBackoff();
  } else if (status === 'conectando') {
    badge.style.color       = 'var(--amber)';
    badge.style.borderColor = 'rgba(245,166,35,0.2)';
    badge.style.background  = 'rgba(245,166,35,0.08)';
    badge.innerHTML = '<div class="pulse"></div> CONECTANDO...';
  } else {
    /* desconectado */
    badge.style.color       = 'var(--text2)';
    badge.style.borderColor = 'var(--border)';
    badge.style.background  = 'var(--bg3)';
    badge.innerHTML = 'SIMULAÇÃO';
    iniciarContadorSemConexao();
  }
}


/* ════════════════════════════
   CONTADOR "SEM DADOS"
   Exibe há quantos segundos o
   dashboard está sem receber dados.
   Após 30s exibe banner de aviso.
   ════════════════════════════ */
const SEM_CONEXAO_AVISO_S = 30; // segundos até mostrar aviso mais visível

function iniciarContadorSemConexao() {
  const el      = document.getElementById('semConexao');
  const timerEl = document.getElementById('semConexaoTimer');
  if (!el) return;

  ultimoDadoRecebido = Date.now();
  el.style.display = 'flex';

  if (intervaloSemConexao) clearInterval(intervaloSemConexao);
  intervaloSemConexao = setInterval(() => {
    const seg = Math.floor((Date.now() - ultimoDadoRecebido) / 1000);
    if (timerEl) timerEl.textContent = seg;

    /* Após 30s sem dados, destaca o indicador */
    if (seg >= SEM_CONEXAO_AVISO_S) {
      el.style.borderColor = 'rgba(255,68,68,0.6)';
      el.style.background  = 'rgba(255,68,68,0.18)';
    }
  }, 1000);
}

function pararContadorSemConexao() {
  const el = document.getElementById('semConexao');
  if (el) {
    el.style.display = 'none';
    el.style.borderColor = '';
    el.style.background  = '';
  }
  if (intervaloSemConexao) {
    clearInterval(intervaloSemConexao);
    intervaloSemConexao = null;
  }
  ultimoDadoRecebido = Date.now();
}

function registrarDadoRecebido() {
  ultimoDadoRecebido = Date.now();
}


/* ════════════════════════════
   TOAST TELEGRAM
   Exibido por 5s ao detectar alerta
   ════════════════════════════ */
let _toastTimer = null;

function mostrarToastTelegram() {
  const toast = document.getElementById('telegramToast');
  if (!toast) return;

  if (_toastTimer) clearTimeout(_toastTimer);

  toast.style.display = 'flex';
  void toast.offsetWidth;
  toast.classList.add('visivel');

  _toastTimer = setTimeout(() => {
    toast.classList.remove('visivel');
    setTimeout(() => { toast.style.display = 'none'; }, 400);
    _toastTimer = null;
  }, 5000);
}


/* ════════════════════════════
   PROCESSA MENSAGEM RECEBIDA
   Sanitiza e valida antes de
   encaminhar ao app.js
   ════════════════════════════ */
function processarMensagem(topico, payload) {
  const msg = payload.toString();

  // SEGURANÇA: rejeita payloads maiores que 4KB
  if (msg.length > 4096) {
    _warn('Payload MQTT rejeitado: tamanho excede 4096 bytes.');
    return;
  }

  // SEGURANÇA: rate limiting por tópico
  if (!verificarRateLimit(topico)) return;

  registrarDadoRecebido();

  /* Tópico de status completo (JSON) */
  if (topico === TOPICOS.status) {
    try {
      const dados = JSON.parse(msg);

      if (dados.temperatura !== undefined) {
        const v = sanitizarNumero(dados.temperatura);
        if (v !== null && validarFaixa('temperatura', v)) aplicarValor('temp', v);
        else if (v !== null) _warn('Temperatura fora da faixa física:', v);
      }
      if (dados.ph !== undefined) {
        const v = sanitizarNumero(dados.ph);
        if (v !== null && validarFaixa('ph', v)) aplicarValor('ph', v);
        else if (v !== null) _warn('pH fora da faixa física:', v);
      }
      if (dados.turbidez !== undefined) {
        const v = sanitizarNumero(dados.turbidez);
        if (v !== null && validarFaixa('turbidez', v)) aplicarValor('turb', v);
        else if (v !== null) _warn('Turbidez fora da faixa física:', v);
      }
      if (dados.salinidade !== undefined) {
        const v = sanitizarNumero(dados.salinidade);
        if (v !== null && validarFaixa('salinidade', v)) aplicarValor('sal', v);
        else if (v !== null) _warn('Salinidade fora da faixa física:', v);
      }

      /* Envia ao gráfico histórico */
      if (window.EdenSenseChart) {
        if (dados.temperatura !== undefined) EdenSenseChart.adicionarLeitura('temp', dados.temperatura);
        if (dados.ph          !== undefined) EdenSenseChart.adicionarLeitura('ph',   dados.ph);
        if (dados.turbidez    !== undefined) EdenSenseChart.adicionarLeitura('turb', dados.turbidez);
        if (dados.salinidade  !== undefined) EdenSenseChart.adicionarLeitura('sal',  dados.salinidade);
      }

      debouncedAtualizarSensores();
      removerSkeleton();
      atualizarFooter();

      if (dados.status && (dados.status !== 'verde' || dados.alerta)) {
        const agora = new Date();
        const hora  = String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');

        const msgAlerta = dados.alerta && dados.alerta.trim() !== ''
          ? sanitizarTexto(dados.alerta.trim().replace(/;\s*$/, ''))
          : 'Status: ' + sanitizarTexto(dados.status);

        historicoAlertas.unshift({ tipo: dados.status || 'verde', msg: msgAlerta, time: hora });
        if (historicoAlertas.length > MAX_HISTORICO) {
          historicoAlertas = historicoAlertas.slice(0, MAX_HISTORICO);
        }
        renderAlertas(historicoAlertas);

        if (dados.status === 'amarelo' || dados.status === 'vermelho') {
          mostrarToastTelegram();
        }
      }

    } catch (e) {
      _err('Erro ao parsear JSON do broker:', e);
    }
    return;
  }

  /* Tópicos individuais */
  const valor = sanitizarNumero(msg);
  if (valor === null) return;

  if (topico === TOPICOS.temperatura) { aplicarValor('temp', valor); if (window.EdenSenseChart) EdenSenseChart.adicionarLeitura('temp', valor); }
  if (topico === TOPICOS.ph)          { aplicarValor('ph',   valor); if (window.EdenSenseChart) EdenSenseChart.adicionarLeitura('ph',   valor); }
  if (topico === TOPICOS.turbidez)    { aplicarValor('turb', valor); if (window.EdenSenseChart) EdenSenseChart.adicionarLeitura('turb', valor); }
  if (topico === TOPICOS.salinidade)  { aplicarValor('sal',  valor); if (window.EdenSenseChart) EdenSenseChart.adicionarLeitura('sal',  valor); }

  debouncedAtualizarSensores();
  removerSkeleton();
  atualizarFooter();

  /* Tópico de alerta */
  if (topico === TOPICOS.alerta) {
    const agora   = new Date();
    const hora    = String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');
    const msgSafe = sanitizarTexto(msg);
    const tipo    = determinarTipoAlerta(msg);

    historicoAlertas.unshift({ tipo, msg: msgSafe, time: hora });
    if (historicoAlertas.length > MAX_HISTORICO) {
      historicoAlertas = historicoAlertas.slice(0, MAX_HISTORICO);
    }
    renderAlertas(historicoAlertas);

    if (tipo === 'amarelo' || tipo === 'vermelho') mostrarToastTelegram();
  }
}


/* ════════════════════════════
   APLICA VALOR NO SENSOR
   ════════════════════════════ */
function aplicarValor(key, valor) {
  sensores[key].val = valor;
  if (key === 'turb') {
    atualizarValorNaTela(key, Math.round(valor));
  } else {
    atualizarValorNaTela(key, valor.toFixed(1));
  }
}


/* ════════════════════════════
   DETERMINA TIPO DO ALERTA
   ════════════════════════════ */
function determinarTipoAlerta(msg) {
  const lower = msg.toLowerCase();
  if (lower.includes('crítico') || lower.includes('risco') || lower.includes('perigo')) return 'vermelho';
  if (lower.includes('atenção') || lower.includes('atencao') || lower.includes('elevad')) return 'amarelo';
  return 'verde';
}


/* ════════════════════════════
   CONECTA NO BROKER MQTT
   Com backoff exponencial na
   reconexão automática
   ════════════════════════════ */
function conectarMQTT() {
  if (typeof mqtt === 'undefined') {
    _warn('Biblioteca mqtt.js não carregada. Usando simulação.');
    atualizarIndicadorMQTT('desconectado');
    return;
  }

  atualizarIndicadorMQTT('conectando');
  _log('EdenSense: conectando ao broker MQTT...');

  const url = 'wss://' + MQTT_CONFIG.host + ':' + MQTT_CONFIG.porta + '/mqtt';
  const backoffMs = calcularBackoff();

  clienteMQTT = mqtt.connect(url, {
    clientId:        MQTT_CONFIG.clientId,
    username:        MQTT_CONFIG.usuario,
    password:        MQTT_CONFIG.senha,
    clean:           true,
    reconnectPeriod: backoffMs,   /* backoff exponencial */
    connectTimeout:  10000
  });


  /* ── Evento: conexão estabelecida ── */
  clienteMQTT.on('connect', () => {
    mqttConectado = true;
    _log('EdenSense: conectado ao broker MQTT!');
    atualizarIndicadorMQTT('conectado');
    pararSimulacao();

    /* Reseta backoff após conexão bem-sucedida */
    resetarBackoff();

    Object.values(TOPICOS).forEach(topico => {
      clienteMQTT.subscribe(topico, { qos: 1 }, (err) => {
        if (err) _err('Erro ao assinar tópico:', topico, err);
        else     _log('Assinando:', topico);
      });
    });
  });


  /* ── Evento: mensagem recebida ── */
  clienteMQTT.on('message', (topico, payload) => {
    processarMensagem(topico, payload);
  });


  /* ── Evento: erro de conexão ── */
  clienteMQTT.on('error', (err) => {
    _err('Erro MQTT:', err.message);
    atualizarIndicadorMQTT('desconectado');
  });


  /* ── Evento: reconectando ── */
  clienteMQTT.on('reconnect', () => {
    const delay = calcularBackoff();
    _log('EdenSense: reconectando... próxima tentativa em ' + Math.round(delay / 1000) + 's');
    atualizarIndicadorMQTT('conectando');

    /* Aplica novo período de backoff na reconexão automática */
    if (clienteMQTT && clienteMQTT.options) {
      clienteMQTT.options.reconnectPeriod = delay;
    }
  });


  /* ── Evento: desconectado ── */
  clienteMQTT.on('close', () => {
    mqttConectado = false;
    _warn('EdenSense: desconectado do broker MQTT.');
    atualizarIndicadorMQTT('desconectado');
    iniciarSimulacao();
  });
}


/* ════════════════════════════
   CONTROLE DA SIMULAÇÃO
   ════════════════════════════ */
let intervaloSimulacao = null;
let intervaloRelogio   = null;

function iniciarSimulacao() {
  if (!intervaloSimulacao) {
    intervaloSimulacao = setInterval(simularLeitura, 3000);
  }
  if (!intervaloRelogio) {
    intervaloRelogio = setInterval(atualizarHora, 1000);
  }
}

function pararSimulacao() {
  if (intervaloSimulacao) {
    clearInterval(intervaloSimulacao);
    intervaloSimulacao = null;
    _log('EdenSense: simulação pausada — usando dados reais do MQTT.');
  }
  if (!intervaloRelogio) {
    intervaloRelogio = setInterval(atualizarHora, 1000);
  }
}


/* ════════════════════════════
   INICIALIZA MQTT
   Chamada no final do app.js
   ════════════════════════════ */
function inicializarMQTT() {
  conectarMQTT();

  /* Se não conectar em 8 segundos, mantém a simulação */
  setTimeout(() => {
    if (!mqttConectado) {
      _warn('EdenSense: broker não alcançado. Continuando simulação.');
      iniciarSimulacao();
    }
  }, 8000);
}
