// -------------- DEPENDANCES & SETUP ---------------
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const fs = require('fs').promises;

dotenv.config();
const app = express();
app.use(express.json());

const WHATSAPP_PORT = process.env.PORT || 3001;
const SESSION_PATH = "./session"; // Dossier pour les sessions WhatsApp

// ------------- CONFIGURATION N8N ------------------
const CONFIG = {
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || "https://wildcat-aware-tick.ngrok-free.app/webhook-test/incoming",
  N8N_BOT_RESPONSE_URL: process.env.N8N_BOT_RESPONSE_URL || "https://wildcat-aware-tick.ngrok-free.app/webhook-test/bot-response",
  OPERATOR_TIMEOUT: 2 * 60 * 1000, // 2min par défaut
  BOT_TAKEOVER_DELAY: 2000, // 2s
  CLEANUP_THRESHOLD: 24 * 60 * 60 * 1000 // 24h
};

// ------------- ETAT DES CONVERSATIONS -------------
const conversationState = new Map();

class ConversationSession {
  constructor(number) {
    this.number = number;
    this.operatorActive = false;
    this.lastOperatorActivity = null;
    this.lastMessageTime = Date.now();
    this.timeoutId = null;
    this.pendingBotResponse = false;
  }
  updateOperatorActivity() {
    this.operatorActive = true;
    this.lastOperatorActivity = Date.now();
    this.clearBotTimeout();
  }
  activateBotMode() {
    this.operatorActive = false;
    this.lastOperatorActivity = null;
    this.clearBotTimeout();
  }
  scheduleBotTakeover() {
    this.clearBotTimeout();
    this.timeoutId = setTimeout(() => {
      log('INFO', 'BOT', `Prend la main pour ${this.number} (timeout opérateur)`);
      this.activateBotMode();
      this.requestBotResponse("OPERATOR_TIMEOUT");
    }, CONFIG.OPERATOR_TIMEOUT);
  }
  clearBotTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
  isOperatorInactive() {
    if (!this.operatorActive || !this.lastOperatorActivity) return true;
    return (Date.now() - this.lastOperatorActivity) > CONFIG.OPERATOR_TIMEOUT;
  }
  async requestBotResponse(trigger = "AUTO_RESPONSE") {
    if (this.pendingBotResponse) return;
    this.pendingBotResponse = true;
    const botPayload = {
      number: this.number,
      trigger,
      timestamp: Date.now(),
      context: "BOT_TAKEOVER"
    };
    try {
      await axios.post(CONFIG.N8N_BOT_RESPONSE_URL, botPayload);
      log('INFO', 'BOT', `Prise en charge demandée à n8n pour ${this.number}`);
    } catch (error) {
      log('ERROR', 'BOT', `Erreur n8n pour ${this.number}: ${error.message}`);
    }
    setTimeout(() => {
      this.pendingBotResponse = false;
    }, 3000);
  }
}

function getConversationSession(number) {
  if (!conversationState.has(number)) {
    conversationState.set(number, new ConversationSession(number));
  }
  return conversationState.get(number);
}

// ------------- METRIQUES & LOGGING -----------------
const metrics = {
  messagesReceived: 0,
  messagesSent: 0,
  botResponses: 0,
  operatorResponses: 0,
  sessionSwitches: 0
};

const logLevels = {
  ERROR: '❌',
  WARN: '⚠️',
  INFO: 'ℹ️',
  DEBUG: '🔍'
};

function log(level, category, message, data = null) {
  const timestamp = new Date().toISOString();
  const emoji = logLevels[level] || 'ℹ️';
  console.log(`${emoji} [${timestamp}] [${category}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// -------------- WHATSAPP CLIENT INIT --------------
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", qr => {
  console.log("📱 [QR] Scanne ce QR Code avec WhatsApp :");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("🟢 [WHATSAPP] Bot WhatsApp connecté et prêt !");
});

// ------------ GESTION DES MESSAGES ENTRANTS -----------
client.on("message", async (message) => {
  // Ignore les status et groupes
  if (message.from === "status@broadcast") return;
  if (message.from.includes('@g.us')) return;

  const session = getConversationSession(message.from);
  session.lastMessageTime = Date.now();

  // Prépare le payload pour n8n
  const payload = {
    number: message.from,
    timestamp: Date.now(),
    operatorActive: session.operatorActive,
    conversationState: {
      operatorActive: session.operatorActive,
      lastOperatorActivity: session.lastOperatorActivity,
      isOperatorInactive: session.isOperatorInactive()
    },
    msgType: "text",
    message: message.body,
  };

  // === Gestion des médias ===
  if (message.hasMedia) {
    try {
      const media = await message.downloadMedia();
      payload.msgType = media.mimetype?.split("/")[0] || "media"; // "image", "video", "audio"...
      payload.mediaInfo = {
        hasMedia: true,
        mimetype: media.mimetype,
        filename: media.filename,
        // data: media.data, // Retire si trop lourd !
      };
      // Ajoute la légende si elle existe
      if (message.body && message.body.length > 0) {
        payload.caption = message.body;
      }
    } catch (error) {
      payload.msgType = "media";
      payload.mediaInfo = { error: error.message };
    }
  }

  // === Envoi à n8n ===
  try {
    await axios.post(CONFIG.N8N_WEBHOOK_URL, payload);
    log('INFO', 'IN', `Message reçu de ${message.from} envoyé à n8n`);
  } catch (err) {
    log('ERROR', 'N8N', `Erreur lors de l'envoi à n8n : ${err.message}`);
  }

  // ... ta logique hybride éventuelle (timeout, bot, etc.) ...
});

// ---------- TRACKER DES MESSAGES SORTANTS (OPÉRATEUR) -----------
client.on("message_create", (msg) => {
  if (msg.fromMe) {
    const session = getConversationSession(msg.to);
    session.updateOperatorActivity();
    log('INFO', 'OP', `Réponse manuelle détectée pour ${msg.to} (reset timer)`);
  }
});

// --------------- EXPRESS API (CONTROL INTERFACE) ---------------
app.post('/operator-active', (req, res) => {
  const { number, operatorId, action } = req.body;
  if (!number) return res.status(400).json({ error: "Numéro requis" });

  const session = getConversationSession(number);
  switch (action) {
    case 'CONNECT':
    case 'TYPING':
    case 'MESSAGE_SENT':
      session.updateOperatorActivity();
      log('INFO', 'OP', `Opérateur ${operatorId || "?"} actif pour ${number}`);
      break;
    case 'DISCONNECT':
      session.activateBotMode();
      log('INFO', 'OP', `Opérateur ${operatorId || "?"} déconnecté pour ${number}`);
      setTimeout(() => session.requestBotResponse("OPERATOR_DISCONNECT"), CONFIG.BOT_TAKEOVER_DELAY);
      break;
    default:
      session.updateOperatorActivity();
  }

  res.json({ success: true, operatorActive: session.operatorActive, timestamp: Date.now() });
});

// Forcer le mode bot manuellement
app.post('/force-bot-mode', (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: "Numéro requis" });

  const session = getConversationSession(number);
  session.activateBotMode();
  setTimeout(() => session.requestBotResponse("FORCED_BOT_MODE"), 500);

  log('INFO', 'FORCE', `Mode bot forcé pour ${number}`);
  res.json({ success: true, botActive: true });
});

// Etat d'une conversation
app.get('/conversation-state/:number', (req, res) => {
  const number = req.params.number;
  const session = getConversationSession(number);
  res.json({
    number,
    operatorActive: session.operatorActive,
    lastOperatorActivity: session.lastOperatorActivity,
    lastMessageTime: session.lastMessageTime,
    isOperatorInactive: session.isOperatorInactive(),
    timestamp: Date.now()
  });
});

// Confirmer message bot envoyé (optionnel)
app.post('/bot-message-sent', (req, res) => {
  const { number } = req.body;
  if (number && conversationState.has(number)) {
    const session = conversationState.get(number);
    session.pendingBotResponse = false;
    log('INFO', 'BOT', `Message bot confirmé envoyé pour ${number}`);
  }
  res.json({ success: true });
});

// Nettoyage mémoire toutes les heures
setInterval(() => {
  const now = Date.now();
  for (const [number, session] of conversationState) {
    if (now - session.lastMessageTime > CONFIG.CLEANUP_THRESHOLD) {
      session.clearBotTimeout();
      conversationState.delete(number);
      log('INFO', 'CLEAN', `Session nettoyée pour ${number}`);
    }
  }
}, 60 * 60 * 1000);

// ----------- SAUVEGARDE PERIODIQUE DE L'ETAT --------
const BACKUP_FILE = './conversation_backup.json';
async function saveConversationState() {
  try {
    const backup = {};
    for (const [number, session] of conversationState) {
      backup[number] = {
        operatorActive: session.operatorActive,
        lastOperatorActivity: session.lastOperatorActivity,
        lastMessageTime: session.lastMessageTime
      };
    }
    await fs.writeFile(BACKUP_FILE, JSON.stringify(backup, null, 2));
    log('INFO', 'BACKUP', 'État des conversations sauvegardé');
  } catch (error) {
    log('ERROR', 'BACKUP', 'Erreur sauvegarde:', error.message);
  }
}
setInterval(saveConversationState, 10 * 60 * 1000);

async function loadConversationState() {
  try {
    const data = await fs.readFile(BACKUP_FILE, 'utf8');
    const backup = JSON.parse(data);
    for (const [number, state] of Object.entries(backup)) {
      const session = getConversationSession(number);
      session.operatorActive = state.operatorActive;
      session.lastOperatorActivity = state.lastOperatorActivity;
      session.lastMessageTime = state.lastMessageTime;
    }
    log('INFO', 'BACKUP', `${Object.keys(backup).length} conversations restaurées`);
  } catch (error) {
    log('WARN', 'BACKUP', 'Aucune sauvegarde trouvée ou erreur lecture');
  }
}
loadConversationState();

// --------------- AUTRES ENDPOINTS / SAAS ---------------
// Endpoint pour envoyer un message depuis n8n
app.post('/send-message', async (req, res) => {
  const { to, message, type = 'text', mediaUrl } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "Paramètres 'to' et 'message' requis" });
  }
  try {
    let sentMessage;
    if (type === 'media' && mediaUrl) {
      const media = await MessageMedia.fromUrl(mediaUrl);
      sentMessage = await client.sendMessage(to, media, { caption: message });
    } else {
      sentMessage = await client.sendMessage(to, message);
    }
    if (req.body.fromBot) {
      const session = getConversationSession(to);
      session.pendingBotResponse = false;
    }
    metrics.messagesSent++;
    log('INFO', 'OUT', `Message envoyé à ${to}`);
    res.json({ success: true, messageId: sentMessage.id._serialized, timestamp: Date.now() });
  } catch (error) {
    log('ERROR', 'SEND', `Erreur envoi vers ${to}: ${error.message}`);
    res.status(500).json({ error: "Erreur envoi message", details: error.message });
  }
});

// Endpoint health
app.get('/health', async (req, res) => {
  try {
    const isReady = await client.getState();
    res.json({
      status: 'healthy',
      whatsapp: isReady,
      activeConversations: conversationState.size,
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: Date.now()
    });
  }
});

// Metrics
app.get('/metrics', (req, res) => {
  res.json({
    ...metrics,
    activeConversations: conversationState.size,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: Date.now()
  });
});

// Dynamique config
app.post('/config', (req, res) => {
  const { operatorTimeout, botDelay } = req.body;
  if (operatorTimeout) {
    CONFIG.OPERATOR_TIMEOUT = operatorTimeout * 60 * 1000; // min -> ms
    log('INFO', 'CONFIG', `Timeout opérateur mis à jour: ${operatorTimeout}min`);
  }
  if (botDelay) {
    CONFIG.BOT_TAKEOVER_DELAY = botDelay * 1000;
    log('INFO', 'CONFIG', `Délai bot mis à jour: ${botDelay}s`);
  }
  res.json({ success: true, config: CONFIG });
});
app.get('/config', (req, res) => {
  res.json(CONFIG);
});

// ------------- EVENTS WHATSAPP DIVERS ---------------
client.on("disconnected", (reason) => {
  log('ERROR', 'WHATSAPP', `Déconnecté: ${reason}`);
  for (const [number, session] of conversationState) {
    session.activateBotMode();
    log('INFO', 'FALLBACK', `Session ${number} basculée en mode bot (déconnexion)`);
  }
});
client.on("auth_failure", msg => {
  log('ERROR', 'AUTH', `Échec authentification: ${msg}`);
});

// ----------- LANCEMENT DU BOT + API EXPRESS ---------
process.on('SIGINT', () => {
  log('INFO', 'STOP', 'Arrêt système hybride...');
  for (const [number, session] of conversationState) {
    session.clearBotTimeout();
  }
  process.exit(0);
});
client.initialize();
app.listen(WHATSAPP_PORT, () => {
  log('INFO', 'API', `API Hybride WhatsApp sur le port ${WHATSAPP_PORT}`);
  log('INFO', 'API', `Endpoints: /operator-active, /force-bot-mode, /conversation-state/:number, /bot-message-sent, /send-message, /health, /metrics, /config`);
});
