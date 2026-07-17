# EdenSense — Guia do Firmware ESP32

> Sistema IoT de monitoramento de qualidade da água para carcinicultura  
> Vale do Jaguaribe, Ceará

---

## Índice

1. [Pré-requisitos](#1-pré-requisitos)
2. [Instalação das Bibliotecas](#2-instalação-das-bibliotecas)
3. [Configuração das Credenciais](#3-configuração-das-credenciais)
4. [Configuração do Firebase](#4-configuração-do-firebase)
5. [Upload para o ESP32](#5-upload-para-o-esp32)
6. [Calibração dos Sensores](#6-calibração-dos-sensores)
7. [Significado dos LEDs e Buzzer](#7-significado-dos-leds-e-buzzer)
8. [Monitor Serial](#8-monitor-serial)
9. [Solução de Problemas](#9-solução-de-problemas)

---

## 1. Pré-requisitos

| Item | Versão mínima |
|------|---------------|
| Arduino IDE | 2.x (recomendado) ou 1.8.19 |
| Pacote ESP32 (Espressif) | 2.0.x ou superior |

### Instalar o pacote ESP32 na Arduino IDE

1. Abra **Arquivo → Preferências**.
2. Em *URLs adicionais para Gerenciadores de Placas*, adicione:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Vá em **Ferramentas → Placa → Gerenciador de Placas**.
4. Pesquise **esp32** e instale o pacote da **Espressif Systems**.
5. Selecione a placa: **Ferramentas → Placa → ESP32 Arduino → ESP32 Dev Module**.

---

## 2. Instalação das Bibliotecas

Todas as bibliotecas abaixo são instaladas pelo **Gerenciador de Bibliotecas**  
(`Ferramentas → Gerenciar Bibliotecas...` ou `Ctrl+Shift+I`).

| Biblioteca | Autor | Como pesquisar |
|---|---|---|
| **OneWire** | Paul Stoffregen | `OneWire` |
| **DallasTemperature** | Miles Burton | `DallasTemperature` |
| **PubSubClient** | Nick O'Leary | `PubSubClient` |
| **ArduinoJson** | Benoit Blanchon | `ArduinoJson` |
| **WiFi / WiFiClientSecure** | Espressif | já incluídas no pacote ESP32 |

> **Atenção — ArduinoJson:** instale a versão **6.x** (não a 5.x).  
> O código usa `StaticJsonDocument`, que não existe na v5.

---

## 3. Configuração das Credenciais

Abra o arquivo `firmware.ino` e edite o bloco de configurações no topo:

```cpp
// Rede Wi-Fi
const char* WIFI_SSID      = "NomeDaSuaRede";
const char* WIFI_PASSWORD  = "SenhaDaRede";

// HiveMQ Cloud
const char* MQTT_HOST      = "abc123.s1.eu.hivemq.cloud"; // copie do painel HiveMQ
const int   MQTT_PORT      = 8883;
const char* MQTT_USER      = "seu_usuario";
const char* MQTT_PASSWORD  = "sua_senha";
```

### Onde encontrar o host HiveMQ

1. Acesse [console.hivemq.cloud](https://console.hivemq.cloud).
2. Entre no seu cluster → botão **Manage Cluster**.
3. Copie o valor do campo **Host** (ex.: `abc123.s1.eu.hivemq.cloud`).

---

## 4. Configuração do Firebase

### 4.1 Criar o projeto Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e clique em **Criar um projeto**.
2. Dê um nome (ex.: `edensense`) e siga os passos.
3. No menu lateral, clique em **Criação → Realtime Database**.
4. Clique em **Criar banco de dados**.
5. Escolha a região mais próxima (ex.: `us-central1`).
6. Na tela de regras, selecione **Iniciar no modo de teste** (acesso aberto por 30 dias — suficiente para MVP).
7. Clique em **Ativar**.

### 4.2 Configurar o firmware (ESP32)

Abra `firmware.ino` e edite:

```cpp
const char* FIREBASE_DB_URL = "https://edensense-XXXXX-default-rtdb.firebaseio.com";
// Cole a URL exibida no painel do Realtime Database (campo "URL do banco de dados")
```

Deixe `FIREBASE_SECRET = ""` enquanto estiver usando o modo de teste.

### 4.3 Configurar o dashboard (firebase.js)

1. No Firebase Console, vá em **Configurações do projeto** (ícone de engrenagem).
2. Role até **Seus apps** → clique em **`</>`** para adicionar um app Web.
3. Dê um apelido, clique em **Registrar**.
4. Copie o bloco `firebaseConfig` exibido e cole em `firebase.js`:

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "edensense.firebaseapp.com",
  databaseURL:       "https://edensense-default-rtdb.firebaseio.com",
  projectId:         "edensense",
  storageBucket:     "edensense.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

### 4.4 Como os dados são salvos

| Caminho no Firebase | O que contém |
|---|---|
| `viveiros/viveiro1/ultimaLeitura` | Última leitura do ESP32 (sobrescrita a cada 60s) |
| `viveiros/viveiro1/historico/-Kabc...` | Cada leitura salva com chave automática |

O ESP32 salva no Firebase a cada **60 segundos** (12 ciclos de 5s).  
O MQTT continua atualizando o dashboard em **tempo real** (a cada 5s).

### 4.5 Regras de segurança para produção

Quando for publicar o sistema, substitua as regras abertas por estas:

```json
{
  "rules": {
    "viveiros": {
      "$viveiro": {
        ".read":  true,
        ".write": false
      }
    }
  }
}
```

E no firmware, use um **Database Secret** ou **Service Account** para autenticar as escritas do ESP32.

---

## 5. Upload para o ESP32

1. Conecte o ESP32 ao computador via cabo USB.

2. Em **Ferramentas**, configure:
   - **Placa:** `ESP32 Dev Module`
   - **Upload Speed:** `115200`
   - **Flash Size:** `4MB (32Mb)`
   - **Porta:** a porta COM que aparecer (ex.: `COM3` no Windows)
3. Clique em **Upload** (seta →) ou pressione `Ctrl+U`.
4. Aguarde a mensagem `Done uploading.`
5. Abra o **Monitor Serial** (`Ctrl+Shift+M`) com baud rate **115200**.

> Se aparecer o erro `A fatal error occurred: Failed to connect`, pressione e mantenha o botão **BOOT** (ou IO0) do ESP32 enquanto o upload começa, e solte após ver `Connecting...`.

---

## 6. Calibração dos Sensores

### 5.1 Temperatura — DS18B20

O DS18B20 é um sensor digital e raramente precisa de calibração.  
Se notar diferença, compare com um termômetro de referência e corrija por software:

```cpp
float temperatura = mediaTemperatura(NUM_AMOSTRAS) + OFFSET_TEMP;
// Exemplo: se lê 27.2 °C mas o termômetro marca 27.6 °C → OFFSET_TEMP = 0.4
```

### 5.2 pH — PH-4502C

A calibração de 2 pontos garante maior precisão:

**Materiais:** solução tampão pH 7,00 e pH 4,01 (ou pH 10,01).

**Procedimento:**

1. Mergulhe o eletrodo na solução pH 7 e aguarde 2 minutos.
2. Meça a tensão no pino `GPIO34` com um multímetro → anote como `V_pH7`.
3. Mergulhe na solução pH 4 e aguarde 2 minutos.
4. Meça novamente → anote como `V_pH4`.
5. Calcule o fator:

```
PH_FATOR = (V_pH7 - V_pH4) / (7 - 4)   →  exemplo: (2.50 - 2.95) / 3 = 0.15
```

6. Atualize no firmware:

```cpp
#define PH_V_NEUTRO   2.50f   // tensão medida no pH 7
#define PH_FATOR      0.15f   // calculado acima
```

### 5.3 Turbidez

**Materiais:** água destilada limpa e soluções NTU padrão (opcional).

1. Mergulhe o sensor em água destilada.
2. Meça a tensão no `GPIO35` → anote como `TURB_V_LIMPO`.
3. Atualize no firmware:

```cpp
#define TURB_V_LIMPO  4.20f   // substitua pelo valor medido
```

Para calibrar a escala NTU, use uma solução de referência conhecida e ajuste `TURB_NTU_MAX` até o valor exibido no monitor serial bater com o valor da solução.

### 5.4 Salinidade / TDS

**Materiais:** água com salinidade conhecida (ex.: 20 ppt) medida com refratômetro.

1. Mergulhe o sensor na água de referência.
2. Leia a tensão no `GPIO32` e o valor exibido no serial.
3. Calcule:

```
SAL_FATOR = salinidade_real / tensao_medida
```

4. Atualize no firmware:

```cpp
#define SAL_FATOR  10.0f   // substitua pelo valor calculado
```

---

## 7. Significado dos LEDs e Buzzer

| LED | Cor | Significado |
|-----|-----|-------------|
| GPIO25 | Verde | Todos os parâmetros dentro da faixa ideal |
| GPIO26 | Amarelo | Um ou mais parâmetros nos 15% das bordas da faixa (atenção) |
| GPIO27 | Vermelho | Um ou mais parâmetros fora da faixa ideal (crítico) |

| Buzzer | Padrão | Significado |
|--------|--------|-------------|
| GPIO14 | Silencioso | Status verde ou amarelo |
| GPIO14 | Bip de 200 ms a cada 1 s | Status vermelho — ação imediata necessária |

### Faixas de referência

| Parâmetro | Faixa ideal | Zona amarela inferior | Zona amarela superior |
|---|---|---|---|
| Temperatura | 23 – 30 °C | 23 – 24,05 °C | 28,95 – 30 °C |
| pH | 7,5 – 8,5 | 7,5 – 7,65 | 8,35 – 8,5 |
| Turbidez | 0 – 30 NTU | 0 – 4,5 NTU | 25,5 – 30 NTU |
| Salinidade | 10 – 35 ppt | 10 – 13,75 ppt | 31,25 – 35 ppt |

---

## 8. Monitor Serial

Após o upload, abra o Monitor Serial (115200 baud) para acompanhar as leituras em tempo real:

```
============================================
   EdenSense — Sistema IoT de Aquicultura
   Vale do Jaguaribe, Ceará
============================================

[BOOT] Testando LEDs e buzzer...
[BOOT] Auto-teste OK.
[BOOT] Iniciando DS18B20...
[BOOT] Sensores DS18B20 encontrados: 1
[WiFi] Conectando a 'MinhaRede'...........
[WiFi] Conectado!
[WiFi] IP    : 192.168.1.42
[MQTT] Conectando a abc123.hivemq.cloud:8883 ... OK!
[BOOT] Sistema pronto — monitorando a cada 5 s...

╔════════════════════════════════════════╗
║     EdenSense — Leitura dos Sensores   ║
╠════════════════════════════════════════╣
║  Temperatura :   27.4 °C               ║
║  pH          :    7.82                 ║
║  Turbidez    :   14.0 NTU              ║
║  Salinidade  :   22.0 ppt              ║
╠════════════════════════════════════════╣
║  Status : verde                        ║
╚════════════════════════════════════════╝
[MQTT] Publicado → {"temperatura":27.4,"ph":7.82,...}
```

---

## 9. Solução de Problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| `DS18B20 desconectado!` | Fio solto ou sem resistor pull-up | Verifique cabeamento; use resistor 4,7 kΩ entre VCC e DATA |
| pH lendo 0 ou 14 | Sensor sem alimentação / pino errado | Confirme GPIO34 e tensão 5 V no módulo |
| Wi-Fi em loop infinito | SSID/senha errados | Verifique credenciais; tente com 2,4 GHz (ESP32 não suporta 5 GHz) |
| MQTT estado `-2` | Host HiveMQ errado | Copie o host exato do painel HiveMQ |
| MQTT estado `-4` | Timeout TLS | Verifique `clienteTLS.setInsecure()` ou instale certificado CA |
| MQTT estado `5` | Usuário/senha incorretos | Reconfira credenciais na HiveMQ Cloud |
| Leituras analógicas ruidosas | ADC sem filtro | Aumente `NUM_AMOSTRAS` ou adicione capacitor 100 nF no pino |
| Upload falha com `Failed to connect` | GPIO0 não está em modo boot | Segure o botão BOOT ao iniciar o upload |

---

*EdenSense © 2025 — Vale do Jaguaribe, Ceará*
