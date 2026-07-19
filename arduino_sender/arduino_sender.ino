// ============================================================
//  EdenSense — Arduino UNO → envia leituras em JSON pela serial
//  para o ESP32 (Serial2), em 9600 baud.
//
//  TEMPORÁRIO PARA TESTES DE BANCADA: envio a cada 5s.
//  Produção: trocar INTERVALO_MS para 1800000UL (30 min).
//
//  Sensores:
//    Temperatura simulada : A4
//    pH (offset +0.26)    : A5
//    Salinidade / TDS     : A0
//    Turbidez              : A2
// ============================================================

#define PINO_TEMP_SIM A4
#define PINO_TDS      A0
#define PINO_TURB     A2
#define PINO_PH       A5

const unsigned long INTERVALO_MS = 5000UL;  // bancada: 5s — produção: 1800000UL (30min)
unsigned long ultimoEnvio = 0;

void setup() {
  Serial.begin(9600);
  // Força o primeiro envio a acontecer logo no boot, em vez de esperar
  // 30 min "às cegas" toda vez que o Arduino liga/reseta. Os envios
  // seguintes respeitam o intervalo normal de 30 min.
  ultimoEnvio = millis() - INTERVALO_MS;
}

void loop() {
  unsigned long agora = millis();
  if (agora - ultimoEnvio < INTERVALO_MS) return;
  ultimoEnvio = agora;

  // Temperatura simulada 0–100 °C
  int valorTemp = analogRead(PINO_TEMP_SIM);
  float temp = map(valorTemp, 0, 1023, 0, 100);

  // pH — com offset +0.26, mas mesmo assim o sensor sem calibração real
  // (soluções-tampão pH4/pH7) ficava preso perto do teto (~12). Até
  // calibrar com as soluções de verdade, mapeamos a tensão inteira
  // (0–5V) para uma janela realista de viveiro (4–11), que ainda deixa
  // sobra pra cima/baixo pra acusar um alerta real de pH fora da faixa.
  int valorPH = analogRead(PINO_PH);
  float tensaoPH = valorPH * (5.0 / 1023.0);
  float ph = 4.0 + (tensaoPH / 5.0) * (11.0 - 4.0);
  ph = ph + 0.26;  // offset de calibração
  if (ph < 0)  ph = 0;
  if (ph > 14) ph = 14;

  // Salinidade / TDS — sem calibração real em água de salinidade
  // conhecida, a fórmula do DFRobot (ppm) não bate com a faixa de
  // viveiro (10–35 ppt). Mapeamos a tensão inteira (0–5V) direto para
  // essa faixa até termos pontos de calibração de verdade.
  int valorTDS = analogRead(PINO_TDS);
  float tensaoTDS = valorTDS * (5.0 / 1023.0);
  float salinidadePPT = 10.0 + (tensaoTDS / 5.0) * (35.0 - 10.0);
  if (salinidadePPT < 10.0) salinidadePPT = 10.0;
  if (salinidadePPT > 35.0) salinidadePPT = 35.0;

  // Turbidez — a curva do sensor (polinômio de fábrica) ainda é usada
  // para dar o formato da resposta, mas reescalada de 0–3000 NTU
  // (faixa genérica de sensor) para 0–70 NTU (faixa realista de
  // viveiro de camarão).
  int valorTurb = analogRead(PINO_TURB);
  float tensaoTurb = valorTurb * (5.0 / 1023.0);
  float ntuBruto = -1120.4 * tensaoTurb * tensaoTurb
                 + 5742.3 * tensaoTurb - 4352.9;
  if (ntuBruto < 0) ntuBruto = 0;
  if (ntuBruto > 3000) ntuBruto = 3000;
  float ntu = (ntuBruto / 3000.0) * 70.0;

  enviarJSON(temp, ph, salinidadePPT, ntu);
}

// Monta e envia o JSON pela serial (sem usar String/ArduinoJson,
// para economizar RAM no Uno)
void enviarJSON(float temp, float ph, float sal, float turb) {
  char sTemp[10], sPH[10], sSal[12], sTurb[12];
  char buffer[100];

  dtostrf(temp, 0, 1, sTemp);
  dtostrf(ph,   0, 1, sPH);
  dtostrf(sal,  0, 2, sSal);
  dtostrf(turb, 0, 2, sTurb);

  snprintf(buffer, sizeof(buffer),
    "{\"temperatura\":%s,\"ph\":%s,\"salinidade\":%s,\"turbidez\":%s}",
    sTemp, sPH, sSal, sTurb);

  Serial.println(buffer);
}
