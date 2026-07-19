/* ═══════════════════════════════════════════
   EdenSense Dashboard — app.js
   Lógica principal do painel de monitoramento
   ═══════════════════════════════════════════ */

// SEGURANÇA: sanitiza qualquer string antes de inserir no DOM via innerHTML
function sanitizar(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

// SEGURANÇA: logs de debug desativados em produção
const DEBUG = false;
function log(...args)  { if (DEBUG) console.log('[EdenSense]', ...args); }
function warn(...args) { if (DEBUG) console.warn('[EdenSense]', ...args); }


/* ════════════════════════════
   CONFIGURAÇÃO DOS SENSORES
   ════════════════════════════ */
const sensores = {
  temp: {
    val: 27.4, min: 23,  max: 30,
    cardId: 'card-temp', valId: 'val-temp', barId: 'bar-temp', alertaId: 'alerta-temp'
  },
  ph: {
    val: 7.8, min: 7.5, max: 8.5,
    cardId: 'card-ph', valId: 'val-ph', barId: 'bar-ph', alertaId: 'alerta-ph'
  },
  turb: {
    val: 18, min: 0, max: 70,
    cardId: 'card-turb', valId: 'val-turb', barId: 'bar-turb', alertaId: 'alerta-turb'
  },
  sal: {
    val: 22, min: 10, max: 35,
    cardId: 'card-sal', valId: 'val-sal', barId: 'bar-sal', alertaId: 'alerta-sal'
  }
};

/* ── Cor de destaque por sensor (usada nas sparklines) ── */
const SPARK_CORES = {
  temp: '#00e87a',
  ph:   '#3dd9ff',
  turb: '#f5a623',
  sal:  '#c084fc'
};


/* ════════════════════════════
   MENSAGENS DE ALERTA
   ════════════════════════════ */
const alertasMsgs = {
  temp: {
    amarelo: '⚠ Atenção: próximo do limite. Verificar aeração.',
    vermelho: '✖ CRÍTICO: temperatura fora do limite! Renovar água.'
  },
  ph: {
    amarelo: '⚠ Atenção: pH desviando. Monitorar de perto.',
    vermelho: '✖ CRÍTICO: pH inadequado! Aplicar calagem.'
  },
  turb: {
    amarelo: '⚠ Atenção: turbidez elevada. Verificar biota.',
    vermelho: '✖ CRÍTICO: turbidez excessiva! Checar viveiro.'
  },
  sal: {
    amarelo: '⚠ Atenção: salinidade limite. Monitorar.',
    vermelho: '✖ CRÍTICO: salinidade fora do padrão!'
  }
};


/* ════════════════════════════
   HISTÓRICO DE ALERTAS
   ════════════════════════════ */
const MAX_HISTORICO = 100;

/* Vazio até o Firebase/MQTT confirmar leituras reais — nunca mostrar
   dados de exemplo como se fossem histórico real do viveiro. */
let historicoAlertas = [];

/* Filtro ativo no painel de histórico */
let filtroAtivo = 'todos';


/* ════════════════════════════
   MIN / MAX / MÉDIA DA SESSÃO
   ════════════════════════════ */
const sessaoMin = { temp: Infinity,  ph: Infinity,  turb: Infinity,  sal: Infinity  };
const sessaoMax = { temp: -Infinity, ph: -Infinity, turb: -Infinity, sal: -Infinity };
const sessaoSoma   = { temp: 0, ph: 0, turb: 0, sal: 0 };
const sessaoContador = { temp: 0, ph: 0, turb: 0, sal: 0 };


/* ════════════════════════════
   SPARKLINES — HISTÓRICO VISUAL
   Mantém os últimos 10 valores
   por sensor para desenhar no canvas
   ════════════════════════════ */
const MAX_SPARK = 10;
const sparkDados = { temp: [], ph: [], turb: [], sal: [] };

/* ── Adiciona valor ao histórico da sparkline ── */
function registrarSparkline(key, valor) {
  sparkDados[key].push(parseFloat(valor));
  if (sparkDados[key].length > MAX_SPARK) sparkDados[key].shift();
}

/* ── Desenha sparkline no canvas com requestAnimationFrame ── */
function desenharSparkline(key) {
  const canvas = document.getElementById('spark-' + key);
  if (!canvas) return;

  const dados = sparkDados[key];
  if (dados.length < 2) return;

  requestAnimationFrame(() => {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const min = Math.min(...dados);
    const max = Math.max(...dados);
    const range = max - min || 1;
    const cor   = SPARK_CORES[key] || '#00e87a';

    /* Gradiente de preenchimento */
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, cor + '40');
    grad.addColorStop(1, cor + '00');

    const pontos = dados.map((v, i) => ({
      x: (i / (dados.length - 1)) * W,
      y: H - ((v - min) / range) * (H - 4) - 2
    }));

    /* Área preenchida */
    ctx.beginPath();
    ctx.moveTo(pontos[0].x, H);
    pontos.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pontos[pontos.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    /* Linha suavizada */
    ctx.beginPath();
    ctx.moveTo(pontos[0].x, pontos[0].y);
    for (let i = 1; i < pontos.length; i++) {
      const prev = pontos[i - 1];
      const cur  = pontos[i];
      const cpX  = (prev.x + cur.x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, cur.y, cur.x, cur.y);
    }
    ctx.strokeStyle = cor;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    /* Ponto atual (último) */
    const last = pontos[pontos.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = cor;
    ctx.fill();
  });
}


/* ════════════════════════════
   INDICADOR DE TENDÊNCIA
   Seta ↑ ↓ → nos cards
   ════════════════════════════ */
const tendenciaAnterior = { temp: null, ph: null, turb: null, sal: null };

function atualizarTendencia(key, novoValor) {
  const prev = tendenciaAnterior[key];
  const el   = document.getElementById('tend-' + key);
  if (!el) return;

  if (prev === null) {
    tendenciaAnterior[key] = novoValor;
    el.textContent = '';
    return;
  }

  const diff = novoValor - prev;
  tendenciaAnterior[key] = novoValor;

  if (Math.abs(diff) < 0.05) {
    el.textContent = '→';
    el.className = 'sensor-tendencia tend-ok';
  } else if (diff > 0) {
    el.textContent = '↑';
    el.className = 'sensor-tendencia tend-up';
  } else {
    el.textContent = '↓';
    el.className = 'sensor-tendencia tend-down';
  }
}


/* ════════════════════════════
   SILENCIAR ALERTAS
   ════════════════════════════ */
let silenciadoAte = null;
let intervaloSilenciar = null;

function estaSilenciado() {
  return silenciadoAte && Date.now() < silenciadoAte;
}


/* ════════════════════════════
   DEBOUNCE
   Evita re-renderização a cada
   mensagem MQTT (500ms)
   ════════════════════════════ */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const debouncedAtualizarSensores = debounce(atualizarSensores, 300);


/* ════════════════════════════
   STATUS DO SENSOR
   ════════════════════════════ */
function getStatus(sensor) {
  const range  = sensor.max - sensor.min;
  const margem = range * 0.15;
  if (sensor.val < sensor.min || sensor.val > sensor.max) return 'vermelho';
  if (sensor.val < sensor.min + margem || sensor.val > sensor.max - margem) return 'amarelo';
  return 'verde';
}

function getBarPct(sensor) {
  const pct = ((sensor.val - sensor.min) / (sensor.max - sensor.min)) * 100;
  return Math.min(100, Math.max(0, pct));
}


/* ════════════════════════════
   ATUALIZA TOOLTIP MIN/MAX/MÉDIA
   ════════════════════════════ */
function atualizarMinMax(key, valor) {
  if (valor < sessaoMin[key]) sessaoMin[key] = valor;
  if (valor > sessaoMax[key]) sessaoMax[key] = valor;
  sessaoSoma[key]    += valor;
  sessaoContador[key] += 1;

  const minEl = document.getElementById('tmin-' + key);
  const maxEl = document.getElementById('tmax-' + key);
  const avgEl = document.getElementById('tavg-' + key);
  if (!minEl || !maxEl) return;

  const dec = key === 'turb' ? 0 : 1;
  minEl.textContent = sessaoMin[key] === Infinity  ? '—' : sessaoMin[key].toFixed(dec);
  maxEl.textContent = sessaoMax[key] === -Infinity ? '—' : sessaoMax[key].toFixed(dec);
  if (avgEl && sessaoContador[key] > 0) {
    avgEl.textContent = (sessaoSoma[key] / sessaoContador[key]).toFixed(dec);
  }
}


/* ════════════════════════════
   ANIMAÇÃO DE VALOR
   ════════════════════════════ */
function animarValor(el) {
  el.classList.remove('valor-mudando');
  void el.offsetWidth;
  el.classList.add('valor-mudando');
}


/* ════════════════════════════
   SKELETON LOADING
   ════════════════════════════ */
let primeiraLeituraRecebida = false;

function removerSkeleton() {
  if (primeiraLeituraRecebida) return;
  primeiraLeituraRecebida = true;
  document.querySelectorAll('.sensor-card.skeleton').forEach(c => {
    c.classList.remove('skeleton');
    const nome = c.querySelector('.sensor-nome');
    if (nome) c.setAttribute('aria-label', 'Sensor de ' + nome.textContent.toLowerCase());
  });
}


/* ════════════════════════════
   FILTROS DE ALERTA
   ════════════════════════════ */
function aplicarFiltro(filtro) {
  filtroAtivo = filtro;
  document.querySelectorAll('.filtro-btn').forEach(btn => {
    const ativo = btn.dataset.filtro === filtro;
    btn.classList.toggle('ativo', ativo);
    btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
  renderAlertas(historicoAlertas);
}

function atualizarContadoresFiltro() {
  const cnts = { todos: 0, verde: 0, amarelo: 0, vermelho: 0 };
  historicoAlertas.forEach(a => {
    cnts.todos++;
    if (cnts[a.tipo] !== undefined) cnts[a.tipo]++;
  });
  ['todos', 'verde', 'amarelo', 'vermelho'].forEach(k => {
    const el = document.getElementById('cnt-' + k);
    if (el) el.textContent = cnts[k];
  });
}


/* ════════════════════════════
   RENDERIZA HISTÓRICO (Lazy)
   ════════════════════════════ */
let painelHistoricoVisivel = true;
let historicoPendente = false;

function renderAlertas(lista) {
  atualizarContadoresFiltro();

  if (!painelHistoricoVisivel) {
    historicoPendente = true;
    return;
  }

  historicoPendente = false;
  const el = document.getElementById('alertList');
  if (!el) return;

  /* aplica filtro */
  const filtrada = filtroAtivo === 'todos'
    ? lista
    : lista.filter(a => a.tipo === filtroAtivo);

  if (filtrada.length === 0) {
    el.innerHTML = '<div class="alert-vazio">Nenhum alerta registrado nas últimas 24h.</div>';
    return;
  }

  el.innerHTML = filtrada.slice(0, 20).map(a => {
    const labels    = { verde: 'OK', amarelo: 'ATENÇÃO', vermelho: 'CRÍTICO' };
    const tipoSeg   = ['verde', 'amarelo', 'vermelho'].includes(a.tipo) ? a.tipo : 'verde';
    const label     = labels[tipoSeg] || 'INFO';
    return '<div class="alert-item">' +
      '<div class="alert-dot dot-' + tipoSeg + '" aria-hidden="true"></div>' +
      '<div class="alert-badge badge-' + tipoSeg + '" aria-hidden="true">' + label + '</div>' +
      '<div class="alert-content">' +
        '<div class="alert-msg">' + sanitizar(a.msg) + '</div>' +
        '<div class="alert-time">' + sanitizar(a.time) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* Observer: pausa renderização quando painel não está visível */
document.addEventListener('DOMContentLoaded', () => {
  const painel = document.getElementById('panelHistorico');
  if (painel && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        painelHistoricoVisivel = entry.isIntersecting;
        if (entry.isIntersecting && historicoPendente) renderAlertas(historicoAlertas);
      });
    }, { threshold: 0.1 });
    obs.observe(painel);
  }
});


/* ════════════════════════════
   ÍCONE SVG DO STATUS GERAL
   ════════════════════════════ */
function atualizarIconeStatus(status) {
  const wrap = document.getElementById('statusIconWrap');
  if (!wrap) return;

  if (status === 'verde') {
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" width="40" height="40">' +
        '<circle cx="12" cy="12" r="10" fill="rgba(0,232,122,0.12)" stroke="#00e87a" stroke-width="1.5"/>' +
        '<path d="M7 12l3.5 3.5L17 8" stroke="#00e87a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  } else if (status === 'amarelo') {
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" width="40" height="40">' +
        '<circle cx="12" cy="12" r="10" fill="rgba(245,166,35,0.12)" stroke="#f5a623" stroke-width="1.5"/>' +
        '<line x1="12" y1="7" x2="12" y2="13" stroke="#f5a623" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="12" cy="16.5" r="1.2" fill="#f5a623"/>' +
      '</svg>';
  } else {
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" width="40" height="40">' +
        '<circle cx="12" cy="12" r="10" fill="rgba(255,68,68,0.12)" stroke="#ff4444" stroke-width="1.5"/>' +
        '<line x1="12" y1="7" x2="12" y2="13" stroke="#ff4444" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="12" cy="16.5" r="1.2" fill="#ff4444"/>' +
      '</svg>';
  }
}


/* ════════════════════════════
   TEMPO DESDE ÚLTIMO ALERTA
   ════════════════════════════ */
let tsUltimoAlerta = null;
let intervaloAlertaTempo = null;

function registrarAlerta() {
  tsUltimoAlerta = Date.now();
}

function iniciarContadorAlertaTempo() {
  const el = document.getElementById('statusAlertaTempo');
  if (!el || !tsUltimoAlerta) return;

  el.style.display = '';
  if (intervaloAlertaTempo) clearInterval(intervaloAlertaTempo);

  function atualizar() {
    const seg = Math.floor((Date.now() - tsUltimoAlerta) / 1000);
    if (seg < 60) {
      el.textContent = 'Alerta há ' + seg + 's';
    } else if (seg < 3600) {
      el.textContent = 'Alerta há ' + Math.floor(seg / 60) + 'min';
    } else {
      el.textContent = 'Alerta há ' + Math.floor(seg / 3600) + 'h';
    }
  }

  atualizar();
  intervaloAlertaTempo = setInterval(atualizar, 10000);
}

function pararContadorAlertaTempo() {
  if (intervaloAlertaTempo) { clearInterval(intervaloAlertaTempo); intervaloAlertaTempo = null; }
  const el = document.getElementById('statusAlertaTempo');
  if (el) el.style.display = 'none';
}


/* ════════════════════════════
   RECOMENDAÇÕES AUTOMÁTICAS
   Motor de regras simples baseado
   nos valores atuais dos sensores
   ════════════════════════════ */
function gerarRecomendacoes() {
  const recs = [];
  const s = sensores;

  /* Temperatura */
  if (s.temp.val > s.temp.max) {
    recs.push({ tipo: 'vermelho', texto: '🌡 Temperatura crítica (' + s.temp.val.toFixed(1) + '°C). Aumentar aeração e renovar 20–30% da água urgentemente.' });
  } else if (s.temp.val > s.temp.max - (s.temp.max - s.temp.min) * 0.15) {
    recs.push({ tipo: 'amarelo', texto: '🌡 Temperatura elevada (' + s.temp.val.toFixed(1) + '°C). Verificar aeradores e sombreamento do viveiro.' });
  } else if (s.temp.val < s.temp.min) {
    recs.push({ tipo: 'vermelho', texto: '🌡 Temperatura baixa (' + s.temp.val.toFixed(1) + '°C). Reduzir renovação de água durante a noite.' });
  }

  /* pH */
  if (s.ph.val < s.ph.min) {
    recs.push({ tipo: 'vermelho', texto: '💧 pH ácido (' + s.ph.val.toFixed(1) + '). Aplicar calagem — calcário agrícola 20–30 kg/ha.' });
  } else if (s.ph.val > s.ph.max) {
    recs.push({ tipo: 'vermelho', texto: '💧 pH alcalino (' + s.ph.val.toFixed(1) + '). Aumentar aeração e reduzir adubação orgânica.' });
  } else if (s.ph.val < s.ph.min + (s.ph.max - s.ph.min) * 0.15) {
    recs.push({ tipo: 'amarelo', texto: '💧 pH próximo do mínimo (' + s.ph.val.toFixed(1) + '). Monitorar a cada 2h e preparar calcário.' });
  }

  /* Turbidez */
  if (s.turb.val > s.turb.max) {
    recs.push({ tipo: 'vermelho', texto: '🌊 Turbidez excessiva (' + s.turb.val + ' NTU). Verificar entrada de sedimentos e reduzir adubação.' });
  } else if (s.turb.val > s.turb.max * 0.8) {
    recs.push({ tipo: 'amarelo', texto: '🌊 Turbidez elevada (' + s.turb.val + ' NTU). Verificar bloom de algas e vento.' });
  }

  /* Salinidade */
  if (s.sal.val < s.sal.min) {
    recs.push({ tipo: 'vermelho', texto: '🧂 Salinidade baixa (' + s.sal.val.toFixed(1) + ' ppt). Reduzir entrada de água doce e checar chuvas.' });
  } else if (s.sal.val > s.sal.max) {
    recs.push({ tipo: 'vermelho', texto: '🧂 Salinidade alta (' + s.sal.val.toFixed(1) + ' ppt). Renovar água com fonte de menor salinidade.' });
  }

  /* Tudo OK */
  if (recs.length === 0) {
    recs.push({ tipo: 'ok', texto: 'Todos os parâmetros dentro da faixa ideal. Continue monitorando regularmente.' });
  }

  renderRecomendacoes(recs);
}

function renderRecomendacoes(recs) {
  const lista = document.getElementById('recLista');
  const badge = document.getElementById('recBadge');
  if (!lista) return;

  const alertas = recs.filter(r => r.tipo !== 'ok');

  if (badge) {
    if (alertas.length > 0) {
      badge.textContent = alertas.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  lista.innerHTML = recs.map(r => {
    const cls = r.tipo === 'ok' ? 'rec-ok' : (r.tipo === 'vermelho' ? 'rec-vermelho' : 'rec-amarelo');
    const icone = r.tipo === 'ok' ? '✅' : (r.tipo === 'vermelho' ? '🚨' : '⚠️');
    return '<div class="rec-item ' + cls + '">' +
      '<span class="rec-icone">' + icone + '</span>' +
      '<span class="rec-texto">' + sanitizar(r.texto) + '</span>' +
    '</div>';
  }).join('');
}


/* ════════════════════════════
   ATUALIZA CARDS DOS SENSORES
   ════════════════════════════ */
function atualizarSensores() {
  let piorStatus = 'verde';

  Object.entries(sensores).forEach(([key, s]) => {
    const status = getStatus(s);

    if (status === 'vermelho') piorStatus = 'vermelho';
    else if (status === 'amarelo' && piorStatus !== 'vermelho') piorStatus = 'amarelo';

    /* classe do card */
    const card = document.getElementById(s.cardId);
    if (card) {
      card.className = 'sensor-card fade-in' + (status !== 'verde' ? ' alerta-' + status : '');
    }

    /* barra de progresso */
    const bar = document.getElementById(s.barId);
    if (bar) bar.style.width = getBarPct(s) + '%';

    /* texto de alerta */
    const alertEl = document.getElementById(s.alertaId);
    if (alertEl) alertEl.textContent = status !== 'verde' ? alertasMsgs[key][status] : '';
  });

  atualizarStatusGeral(piorStatus);
  gerarRecomendacoes();
}


/* ════════════════════════════
   ATUALIZA PAINEL STATUS GERAL
   ════════════════════════════ */
function atualizarStatusGeral(status) {
  const geral  = document.getElementById('statusGeral');
  const valor  = document.getElementById('statusValor');
  const rec    = document.getElementById('statusRec');
  const bgAnim = document.getElementById('statusBgAnim');
  const qualid = document.getElementById('headerQualidade');
  const qualTxt= document.getElementById('qualidadeTexto');
  const qualDot= document.getElementById('qualidadeDot');

  /* Remove classes de estado anterior */
  if (geral) {
    geral.className = 'status-geral verde-anim';
    if (status !== 'verde') {
      geral.classList.remove('verde-anim');
      geral.classList.add(status);
    }
  }

  /* Ícone SVG */
  atualizarIconeStatus(status);

  /* Header qualidade */
  if (qualid) {
    qualid.className = 'header-qualidade' + (status !== 'verde' ? ' ' + status : '');
  }

  if (status === 'verde') {
    if (valor)  valor.textContent  = 'NORMAL';
    if (qualTxt) qualTxt.textContent = 'NORMAL';
    if (rec) rec.innerHTML = '<strong>Todos os parâmetros estão dentro dos limites ideais.</strong><br>Continue monitorando regularmente.';
    pararContadorAlertaTempo();
  } else if (status === 'amarelo') {
    if (valor)  valor.textContent  = 'ATENÇÃO';
    if (qualTxt) qualTxt.textContent = 'ATENÇÃO';
    if (rec) rec.innerHTML = '<strong>Um ou mais parâmetros precisam de atenção.</strong><br>Verifique os sensores destacados e monitore nas próximas horas.';
    registrarAlerta();
    iniciarContadorAlertaTempo();
  } else {
    if (valor)  valor.textContent  = 'RISCO';
    if (qualTxt) qualTxt.textContent = 'RISCO';
    if (rec) rec.innerHTML = '<strong>Parâmetro crítico detectado!</strong><br>Ação imediata necessária. Verifique o sensor em vermelho e tome as medidas recomendadas.';
    registrarAlerta();
    iniciarContadorAlertaTempo();
  }

  /* Barra de silenciar */
  const barraSilenciar = document.getElementById('barraSilenciar');
  if (barraSilenciar) {
    if (status === 'vermelho' && !estaSilenciado()) {
      barraSilenciar.style.display = 'flex';
    } else if (status !== 'vermelho') {
      barraSilenciar.style.display = 'none';
      silenciadoAte = null;
      if (intervaloSilenciar) { clearInterval(intervaloSilenciar); intervaloSilenciar = null; }
      const timerEl = document.getElementById('silenciarTimer');
      const btnEl   = document.getElementById('btnSilenciar');
      if (timerEl) timerEl.style.display = 'none';
      if (btnEl)   btnEl.style.display   = '';
    }
  }
}


/* ════════════════════════════
   SILENCIAR ALERTAS POR 30MIN
   ════════════════════════════ */
function silenciarAlertas() {
  silenciadoAte = Date.now() + 30 * 60 * 1000;

  const barraSilenciar = document.getElementById('barraSilenciar');
  const btnEl          = document.getElementById('btnSilenciar');
  const timerEl        = document.getElementById('silenciarTimer');

  if (btnEl)   btnEl.style.display   = 'none';
  if (timerEl) { timerEl.style.display = ''; timerEl.textContent = 'Silenciado por 30min'; }
  if (barraSilenciar) barraSilenciar.style.display = 'none';

  if (intervaloSilenciar) clearInterval(intervaloSilenciar);
  intervaloSilenciar = setInterval(() => {
    const restanteMs = silenciadoAte - Date.now();
    if (restanteMs <= 0) {
      clearInterval(intervaloSilenciar);
      intervaloSilenciar = null;
      silenciadoAte = null;
      if (timerEl) timerEl.style.display = 'none';
      if (btnEl)   btnEl.style.display   = '';
    } else {
      const min = Math.ceil(restanteMs / 60000);
      if (timerEl) timerEl.textContent = 'Silenciado por mais ' + min + 'min';
    }
  }, 30000);
}


/* ════════════════════════════
   SIMULAÇÃO EM TEMPO REAL
   ════════════════════════════ */
function simularLeitura() {
  sensores.temp.val = +(sensores.temp.val + (Math.random() - 0.5) * 0.4).toFixed(1);
  sensores.ph.val   = +(sensores.ph.val   + (Math.random() - 0.5) * 0.1).toFixed(1);
  sensores.turb.val = +(sensores.turb.val + (Math.random() - 0.5) * 1.5).toFixed(0);
  sensores.sal.val  = +(sensores.sal.val  + (Math.random() - 0.5) * 0.3).toFixed(1);

  /* limites físicos realistas */
  sensores.temp.val = Math.max(20, Math.min(34, sensores.temp.val));
  sensores.ph.val   = Math.max(6.5, Math.min(9.0, sensores.ph.val));
  sensores.turb.val = Math.max(0, Math.min(70, sensores.turb.val));
  sensores.sal.val  = Math.max(5, Math.min(40, sensores.sal.val));

  atualizarValorNaTela('temp', sensores.temp.val.toFixed(1));
  atualizarValorNaTela('ph',   sensores.ph.val.toFixed(1));
  atualizarValorNaTela('turb', sensores.turb.val);
  atualizarValorNaTela('sal',  sensores.sal.val.toFixed(1));

  /* envia ao gráfico histórico */
  if (window.EdenSenseChart) {
    EdenSenseChart.adicionarLeitura('temp', sensores.temp.val);
    EdenSenseChart.adicionarLeitura('ph',   sensores.ph.val);
    EdenSenseChart.adicionarLeitura('turb', sensores.turb.val);
    EdenSenseChart.adicionarLeitura('sal',  sensores.sal.val);
  }

  debouncedAtualizarSensores();
  removerSkeleton();
  atualizarFooter();
}


/* ════════════════════════════
   ATUALIZA VALOR NA TELA
   ════════════════════════════ */
function atualizarValorNaTela(key, novoTexto) {
  const el = document.getElementById('val-' + key);
  if (!el) return;

  const novoValorNum = parseFloat(novoTexto);

  if (el.textContent !== String(novoTexto)) {
    el.textContent = novoTexto;
    animarValor(el);
  }

  atualizarMinMax(key, novoValorNum);
  registrarSparkline(key, novoValorNum);
  desenharSparkline(key);
  atualizarTendencia(key, novoValorNum);
}


/* ════════════════════════════
   RELÓGIO EM TEMPO REAL
   (Header center + status-time)
   ════════════════════════════ */
function atualizarHora() {
  const agora = new Date();
  const h = String(agora.getHours()).padStart(2, '0');
  const m = String(agora.getMinutes()).padStart(2, '0');
  const s = String(agora.getSeconds()).padStart(2, '0');
  const d = String(agora.getDate()).padStart(2, '0');
  const mo = String(agora.getMonth() + 1).padStart(2, '0');
  const y  = agora.getFullYear();

  /* Relógio no header */
  const clockTime = document.getElementById('clockTime');
  const clockDate = document.getElementById('clockDate');
  if (clockTime) clockTime.textContent = h + ':' + m + ':' + s;
  if (clockDate) clockDate.textContent = d + '/' + mo + '/' + y;

  /* Hora no painel de status */
  const el = document.getElementById('statusTime');
  if (el) el.textContent = 'Última leitura\n' + h + ':' + m + ':' + s;
}


/* ════════════════════════════
   UPTIME E FOOTER
   ════════════════════════════ */
const tsInicio = Date.now();

function atualizarFooter() {
  const agora = new Date();
  const dataHora = agora.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const elFirmware    = document.getElementById('footerFirmware');
  const elUptime      = document.getElementById('footerUptime');
  const elAtualizacao = document.getElementById('footerAtualizacao');

  if (elFirmware && elFirmware.textContent === 'Firmware: —') {
    elFirmware.textContent = 'Firmware: v1.0.0';
  }
  if (elAtualizacao) elAtualizacao.textContent = 'Última atualização: ' + dataHora;

  /* Uptime desde que a página abriu */
  if (elUptime) {
    const seg = Math.floor((Date.now() - tsInicio) / 1000);
    if (seg < 60) {
      elUptime.textContent = 'Online: ' + seg + 's';
    } else if (seg < 3600) {
      elUptime.textContent = 'Online: ' + Math.floor(seg / 60) + 'min';
    } else {
      elUptime.textContent = 'Online: ' + Math.floor(seg / 3600) + 'h ' + Math.floor((seg % 3600) / 60) + 'min';
    }
  }
}


/* ════════════════════════════
   BOTÃO TELA CHEIA
   ════════════════════════════ */
function alternarFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}


/* ════════════════════════════
   BANNER "ADICIONE À TELA INICIAL"
   ════════════════════════════ */
function mostrarBannerHomescreen() {
  const jaFechado    = sessionStorage.getItem('edensense-banner-fechado');
  const ehStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const ehMobile     = window.innerWidth <= 767;

  if (ehMobile && !jaFechado && !ehStandalone) {
    const banner = document.getElementById('bannerHomescreen');
    if (banner) banner.classList.add('visivel');
  }
}

function fecharBanner() {
  const banner = document.getElementById('bannerHomescreen');
  if (banner) banner.classList.remove('visivel');
  sessionStorage.setItem('edensense-banner-fechado', '1');
}


/* ════════════════════════════
   EDITOR DO VIVEIRO
   ════════════════════════════ */
let modoEdicaoViveiro = false;

function alternarEdicaoViveiro() {
  modoEdicaoViveiro = !modoEdicaoViveiro;

  const editaveis = document.querySelectorAll('.viveiro-editavel');
  const btn = document.getElementById('btnEditarViveiro');

  editaveis.forEach(el => {
    el.contentEditable = modoEdicaoViveiro ? 'true' : 'false';
  });

  if (btn) {
    btn.innerHTML = modoEdicaoViveiro
      ? '<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Salvar'
      : '<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Editar';
  }
}


/* ════════════════════════════
   BIOMETRIA SEMANAL
   Registros de tamanho/peso do camarão,
   salvos localmente no navegador (localStorage)
   ════════════════════════════ */
const BIOMETRIA_STORAGE_KEY = 'edensense_biometria';

function carregarBiometria() {
  try {
    const bruto = localStorage.getItem(BIOMETRIA_STORAGE_KEY);
    if (!bruto) return [];
    const dados = JSON.parse(bruto);
    return Array.isArray(dados) ? dados : [];
  } catch (e) {
    warn('Erro ao carregar biometria do localStorage:', e);
    return [];
  }
}

function salvarBiometriaStorage(lista) {
  try {
    localStorage.setItem(BIOMETRIA_STORAGE_KEY, JSON.stringify(lista));
  } catch (e) {
    warn('Erro ao salvar biometria no localStorage:', e);
  }
}

let biometriaRegistros = carregarBiometria();

function formatarDataBR(isoData) {
  const partes = String(isoData).split('-');
  if (partes.length !== 3) return String(isoData);
  const [ano, mes, dia] = partes;
  return dia + '/' + mes + '/' + ano;
}

function renderBiometria() {
  const tbody = document.getElementById('biometriaTbody');
  const vazio = document.getElementById('biometriaVazio');
  if (!tbody) return;

  if (biometriaRegistros.length === 0) {
    tbody.innerHTML = '';
    if (vazio) vazio.style.display = 'block';
    return;
  }
  if (vazio) vazio.style.display = 'none';

  /* Ordena por data crescente — o número da semana é a posição nessa ordem */
  const ordenado = [...biometriaRegistros].sort((a, b) => String(a.data).localeCompare(String(b.data)));

  tbody.innerHTML = ordenado.map((r, i) => {
    const tamanho = Number(r.tamanho);
    const peso    = Number(r.peso);
    return '<tr>' +
      '<td>' + sanitizar('Semana ' + (i + 1)) + '</td>' +
      '<td>' + sanitizar(isNaN(tamanho) ? '—' : tamanho.toFixed(1)) + '</td>' +
      '<td>' + sanitizar(isNaN(peso) ? '—' : peso.toFixed(1)) + '</td>' +
      '<td>' + sanitizar(formatarDataBR(r.data)) + '</td>' +
    '</tr>';
  }).join('');
}

function registrarBiometria(tamanho, peso, data) {
  biometriaRegistros.push({ tamanho, peso, data });
  salvarBiometriaStorage(biometriaRegistros);
  renderBiometria();
}

function inicializarBiometria() {
  renderBiometria();

  const form = document.getElementById('biometriaForm');
  if (!form) return;

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();

    const tamanhoInput = document.getElementById('biometriaTamanho');
    const pesoInput     = document.getElementById('biometriaPeso');
    const dataInput     = document.getElementById('biometriaData');

    const tamanho = parseFloat(tamanhoInput.value);
    const peso    = parseFloat(pesoInput.value);
    const data    = dataInput.value;

    if (isNaN(tamanho) || tamanho < 0 || isNaN(peso) || peso < 0 || !data) return;

    registrarBiometria(tamanho, peso, data);
    form.reset();
  });
}


/* ════════════════════════════
   TESTE DE PENETRAÇÃO (FASE 6)
   Valida resistência a XSS via
   injeção direta nos dados simulados
   Só executa com DEBUG = true
   ════════════════════════════ */
function executarTestesPen() {
  if (!DEBUG) return;

  const vetores = [
    '<script>alert(1)<\/script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '"><svg onload=alert(1)>',
    '{${7*7}}',
    '{{constructor.constructor("alert(1)")()}}'
  ];

  vetores.forEach(v => {
    /* Testa sanitizar() */
    const resultado = sanitizar(v);
    const passou = !resultado.includes('<script') && !resultado.includes('onerror') && !resultado.includes('onload');
    log('Teste XSS sanitizar():', passou ? 'PASSOU' : 'FALHOU', '|', v.slice(0, 30));
  });

  /* Testa injeção via campo de valor */
  const vetor = '<img src=x onerror=alert(\'XSS\')>';
  atualizarValorNaTela('temp', vetor);
  const el = document.getElementById('val-temp');
  const passou = el && el.textContent === vetor && !el.innerHTML.includes('onerror');
  log('Teste XSS via textContent:', passou ? 'PASSOU' : 'FALHOU');
}


/* ════════════════════════════
   INICIALIZAÇÃO
   ════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  /* Dados placeholder enquanto carrega */
  renderAlertas(historicoAlertas);
  atualizarSensores();
  atualizarHora();
  inicializarBiometria();

  /* Banner mobile */
  mostrarBannerHomescreen();

  /* Eventos de UI */
  const btnFecharBanner = document.getElementById('btnFecharBanner');
  if (btnFecharBanner) btnFecharBanner.addEventListener('click', fecharBanner);

  const btnFullscreen = document.getElementById('btnFullscreen');
  if (btnFullscreen) btnFullscreen.addEventListener('click', alternarFullscreen);

  const btnSilenciar = document.getElementById('btnSilenciar');
  if (btnSilenciar) btnSilenciar.addEventListener('click', silenciarAlertas);

  const btnEditarViveiro = document.getElementById('btnEditarViveiro');
  if (btnEditarViveiro) btnEditarViveiro.addEventListener('click', alternarEdicaoViveiro);

  /* Filtros do histórico */
  document.querySelectorAll('.filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => aplicarFiltro(btn.dataset.filtro || 'todos'));
  });

  /* Firebase: carrega histórico real */
  inicializarFirebase();
  const leituras = await carregarHistoricoFirebase(15);
  if (leituras.length > 0) {
    historicoAlertas = formatarHistoricoParaLista(leituras).slice(0, MAX_HISTORICO);
    renderAlertas(historicoAlertas);
  }

  /* MQTT para dados em tempo real */
  inicializarMQTT();

  /* Testes de penetração (apenas com DEBUG) */
  executarTestesPen();
});
