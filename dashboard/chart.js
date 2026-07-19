/* ═══════════════════════════════════════════
   EdenSense Dashboard — chart.js
   Módulo do gráfico histórico de leituras

   Usa Chart.js 4.4.4 (CDN com SRI verificado)
   Armazena as últimas 20 leituras por sensor
   e exibe linhas de limite ideal tracejadas
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Configuração ── */
  const MAX_PONTOS = 20; // número máximo de pontos no gráfico

  /* ── Histórico de leituras por sensor ── */
  const historico = {
    temp: [],
    ph:   [],
    turb: [],
    sal:  []
  };

  /* ── Labels de tempo compartilhados ── */
  const labelsGlobais = [];

  /* ── Referência ao objeto Chart ── */
  let grafico = null;

  /* ── Sensor atualmente exibido ── */
  let sensorAtivo = 'temp';

  /* ── Configurações por sensor: limites, cor e nome ── */
  const LIMITES = {
    temp: { min: 23,  max: 30,  cor: '#00e87a', nome: 'Temperatura (°C)',   decimais: 1 },
    ph:   { min: 7.5, max: 8.5, cor: '#3dd9ff', nome: 'pH',                 decimais: 1 },
    turb: { min: 0,   max: 70,  cor: '#f5a623', nome: 'Turbidez (NTU)',      decimais: 0 },
    sal:  { min: 10,  max: 35,  cor: '#c084fc', nome: 'Salinidade (ppt)',    decimais: 1 }
  };

  /* ── Gera um label de hora atual formatado ── */
  function _horaAtual() {
    const t = new Date();
    return t.getHours().toString().padStart(2, '0') + ':' +
           t.getMinutes().toString().padStart(2, '0') + ':' +
           t.getSeconds().toString().padStart(2, '0');
  }

  /* ────────────────────────────────────────────
     adicionarLeitura — registra novo valor e
     atualiza o gráfico se o sensor estiver ativo
  ─────────────────────────────────────────────── */
  function adicionarLeitura(sensor, valor) {
    if (!historico[sensor]) return;

    const num = parseFloat(valor);
    if (isNaN(num)) return; // SEGURANÇA: rejeita não-numérico

    historico[sensor].push(num);
    if (historico[sensor].length > MAX_PONTOS) {
      historico[sensor].shift();
    }

    /* Atualiza labels apenas quando for o sensor ativo */
    if (sensor === sensorAtivo) {
      labelsGlobais.push(_horaAtual());
      if (labelsGlobais.length > MAX_PONTOS) labelsGlobais.shift();
      _atualizarGrafico();
    }
  }

  /* ────────────────────────────────────────────
     _atualizarGrafico — repassa os dados atuais
     para o objeto Chart sem recriar o canvas
  ─────────────────────────────────────────────── */
  function _atualizarGrafico() {
    if (!grafico) return;

    const cfg   = LIMITES[sensorAtivo];
    const dados = historico[sensorAtivo];
    const n     = dados.length;

    grafico.data.labels             = labelsGlobais.slice();
    grafico.data.datasets[0].data   = dados.slice();
    grafico.data.datasets[0].label  = cfg.nome;
    grafico.data.datasets[0].borderColor     = cfg.cor;
    grafico.data.datasets[0].backgroundColor = cfg.cor + '18';
    grafico.data.datasets[0].pointBackgroundColor = cfg.cor;

    /* Linhas de limite ideal (tamanho idêntico ao dos dados reais) */
    grafico.data.datasets[1].data = Array(n).fill(cfg.min);
    grafico.data.datasets[2].data = Array(n).fill(cfg.max);

    /* Atualiza sem animação para melhor performance em tempo real */
    grafico.update('none');
  }

  /* ────────────────────────────────────────────
     inicializarGrafico — cria o objeto Chart.js
     Aguarda o SDK estar disponível (CDN async)
  ─────────────────────────────────────────────── */
  function inicializarGrafico() {
    const canvas = document.getElementById('graficoHistorico');
    if (!canvas) return;

    /* Aguarda Chart.js carregar via CDN */
    if (typeof Chart === 'undefined') {
      setTimeout(inicializarGrafico, 300);
      return;
    }

    const ctx = canvas.getContext('2d');
    const cfg = LIMITES[sensorAtivo];

    grafico = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          /* Dataset 0 — dados reais do sensor */
          {
            label: cfg.nome,
            data: [],
            borderColor: cfg.cor,
            backgroundColor: cfg.cor + '18',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: cfg.cor,
            pointBorderColor: '#080e0c',
            pointBorderWidth: 1,
            tension: 0.4,
            fill: true,
          },
          /* Dataset 1 — linha de mínimo ideal (tracejada) */
          {
            label: 'Mín ideal',
            data: [],
            borderColor: 'rgba(255,255,255,0.2)',
            borderWidth: 1,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
          },
          /* Dataset 2 — linha de máximo ideal (tracejada) */
          {
            label: 'Máx ideal',
            data: [],
            borderColor: 'rgba(255,255,255,0.2)',
            borderWidth: 1,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          /* Legenda padrão do Chart.js oculta — temos nossa própria */
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d1a14',
            borderColor: '#1e3028',
            borderWidth: 1,
            titleColor: '#7aab8a',
            bodyColor: '#e8f5ee',
            padding: 10,
            titleFont:  { family: "'Space Mono', monospace", size: 10 },
            bodyFont:   { family: "'Space Mono', monospace", size: 11 },
            callbacks: {
              label: function (ctx) {
                const cfgAtual = LIMITES[sensorAtivo];
                if (ctx.datasetIndex === 0) {
                  const dec = cfgAtual ? cfgAtual.decimais : 1;
                  return '  ' + ctx.parsed.y.toFixed(dec);
                }
                if (ctx.datasetIndex === 1) return '  Mín ideal: ' + (cfgAtual ? cfgAtual.min : '—');
                if (ctx.datasetIndex === 2) return '  Máx ideal: ' + (cfgAtual ? cfgAtual.max : '—');
                return '';
              }
            }
          }
        },
        scales: {
          x: {
            grid:  { color: 'rgba(30,48,40,0.5)', drawBorder: false },
            ticks: {
              color: '#4a7a5a',
              font:  { family: "'Space Mono', monospace", size: 9 },
              maxTicksLimit: 8,
              maxRotation: 0
            }
          },
          y: {
            grid:  { color: 'rgba(30,48,40,0.5)', drawBorder: false },
            ticks: {
              color: '#4a7a5a',
              font:  { family: "'Space Mono', monospace", size: 9 }
            },
            border: { dash: [2, 4] }
          }
        }
      }
    });
  }

  /* ────────────────────────────────────────────
     trocarSensor — muda qual sensor está visível
     no gráfico e reconstrói os labels de tempo
  ─────────────────────────────────────────────── */
  function trocarSensor(novoSensor) {
    if (!LIMITES[novoSensor]) return;
    sensorAtivo = novoSensor;

    /* Reconstrói labels baseados no tamanho do histórico */
    const dados = historico[novoSensor];
    labelsGlobais.length = 0;
    const agora = Date.now();
    for (let i = dados.length - 1; i >= 0; i--) {
      const t = new Date(agora - i * 3000); // assume intervalo de ~3s entre leituras
      labelsGlobais.push(
        t.getHours().toString().padStart(2, '0') + ':' +
        t.getMinutes().toString().padStart(2, '0') + ':' +
        t.getSeconds().toString().padStart(2, '0')
      );
    }

    /* Atualiza aparência dos botões */
    document.querySelectorAll('.grafico-btn').forEach(btn => {
      const ativo = btn.dataset.sensor === novoSensor;
      btn.classList.toggle('ativo', ativo);
      btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });

    _atualizarGrafico();
  }

  /* ── Inicialização via IntersectionObserver (lazy load) ── */
  document.addEventListener('DOMContentLoaded', function () {
    const secao = document.getElementById('graficoSection');
    if (!secao) return;

    /* Só inicializa o gráfico quando a seção entrar na viewport */
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            inicializarGrafico();
            obs.disconnect(); // inicializa apenas uma vez
          }
        });
      }, { threshold: 0.1 });
      obs.observe(secao);
    } else {
      /* Fallback: inicializa imediatamente */
      inicializarGrafico();
    }
  });

  /* ── Expõe API global para app.js e buttons inline ── */
  window.EdenSenseChart = {
    adicionarLeitura: adicionarLeitura,
    trocarSensor:     trocarSensor,
    inicializarGrafico: inicializarGrafico
  };

})();
