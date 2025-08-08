const express = require("express");
const router = express.Router();
const { getClient } = require("../whatsapp");

router.post("/send", async (req, res) => {
  const client = getClient();
  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).json({ error: "Numéro et message requis." });
  }

  try {
    const formattedNumber = number.includes("@c.us")
      ? number
      : `${number}@c.us`;

    await client.sendMessage(formattedNumber, message);
    res.json({ success: true, to: number });
  } catch (err) {
    console.error("❌ Erreur d’envoi :", err);
    res.status(500).json({ error: "Échec de l'envoi du message." });
  }
});

module.exports = router;
