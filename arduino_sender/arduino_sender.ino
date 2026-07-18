// ============================================================
//  EdenSense — Arduino UNO → envia leituras em JSON pela serial
//  para o ESP32 (Serial2), a cada 5 s, em 9600 baud.
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

const unsigned long INTERVALO_MS = 5000UL;
unsigned long ultimoEnvio = 0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  unsigned long agora = millis();
  if (agora - ultimoEnvio < INTERVALO_MS) return;
  ultimoEnvio = agora;

  // Temperatura simulada 0–100 °C
  int valorTemp = analogRead(PINO_TEMP_SIM);
  float temp = map(valorTemp, 0, 1023, 0, 100);

  // pH — com offset de calibração +0.26
  int valorPH = analogRead(PINO_PH);
  float tensaoPH = valorPH * (5.0 / 1023.0);
  float ph = 7 + ((2.5 - tensaoPH) / 0.18);
  ph = ph + 0.26;
  if (ph < 0)  ph = 0;
  if (ph > 14) ph = 14;

  // Salinidade / TDS
  int valorTDS = analogRead(PINO_TDS);
  float tensaoTDS = valorTDS * (5.0 / 1023.0);
  float tds = (133.42 * tensaoTDS * tensaoTDS * tensaoTDS
             - 255.86 * tensaoTDS * tensaoTDS
             + 857.39 * tensaoTDS) * 0.5;

  // Turbidez
  int valorTurb = analogRead(PINO_TURB);
  float tensaoTurb = valorTurb * (5.0 / 1023.0);
  float ntu = -1120.4 * tensaoTurb * tensaoTurb
              + 5742.3 * tensaoTurb - 4352.9;
  if (ntu < 0) ntu = 0;

  enviarJSON(temp, ph, tds, ntu);
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
