# 🤖 WhatsApp Hybrid Bot

Ce projet permet de connecter un bot WhatsApp hybride :  
- Tu peux répondre toi-même aux messages reçus via WhatsApp Web OU
- Laisser le bot répondre automatiquement après un délai (ex : 10 min)
- Les messages reçus peuvent être envoyés à un webhook n8n pour automatisations avancées

---

## 🚀 Installation et démarrage

1. **Clone le projet**
    ```bash
    git clone https://github.com/kingsad27/whatsapp_api.git
    cd whatsapp_api
    ```

2. **Installe les dépendances**
    ```bash
    npm install
    ```

3. **Configure le fichier `.env`**
    Crée un fichier `.env` à la racine avec ce contenu :
    ```
    PORT=3001
    API_KEY=ta_cle_api_ici
    SESSION_NAME=whatsapp_session
    ```
    *(Modifie si besoin le port ou la clé API)*

4. **Lance le bot**
    ```bash
    node src/server.js
    ```
    - Un QR code s’affichera au premier lancement : scanne-le avec WhatsApp sur ton téléphone.
    - Au prochain lancement, plus besoin de QR code (le bot restera connecté).

---

## 🔄 Relier un nouveau compte WhatsApp

- **Supprime le dossier `session/`** à la racine du projet (ou supprime-le via l’explorateur de fichiers).
- Relance le bot (`node src/server.js`) : un nouveau QR code apparaîtra pour connecter un autre compte WhatsApp.

---

## 🔗 Utiliser avec n8n (webhook)

- Dans `src/server.js`, configure l’URL de ton webhook n8n (variable `N8N_WEBHOOK_URL`).
- Dans n8n, crée un nœud webhook (POST) à cette URL.
- Tous les messages WhatsApp reçus seront transmis à n8n automatiquement.

---

## 🛠️ Endpoints Express API

- `GET /conversation-state/:number` : récupère l’état de la conversation (pour monitoring/debug)
- `POST /send-message` : envoie un message WhatsApp via l’API (voir la documentation dans le code pour les paramètres)
- `POST /operator-active` : signale l’activité de l’opérateur
- `POST /force-bot-mode` : force le bot à reprendre la main

---

## 🧹 Bonnes pratiques

- **NE PAS partager** le dossier `/session/` ni le fichier `.env` (contient tes accès privés)
- Vérifie que le fichier `.gitignore` contient :
    ```
    node_modules/
    session/
    .env
    .wwebjs_cache/
    conversation_backup.json
    ```
- Pour connecter le bot à un nouveau WhatsApp, supprime `/session/` puis relance.

---

## ✨ Exemples d’utilisation (copie/colle)

- **Recevoir un message WhatsApp → webhook n8n → automatisation**
- **Répondre à la main ou laisser le bot répondre automatiquement après X minutes**

---

## 📧 Support

Besoin d’aide ou envie d’une démo ?  
Contact : kingsadvertising27@gmail.com

---

## 🏷️ Licence

MIT

---

