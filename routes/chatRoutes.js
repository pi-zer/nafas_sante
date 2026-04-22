// backend/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Route de chat (simple analyse d'intention)
router.post('/chat', async (req, res) => {
  const { message, userId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis' });

  const lowerMsg = message.toLowerCase();
  let response = '';

  // 1. Demande de prédiction pour le mois suivant
  if (lowerMsg.includes('prévision') || lowerMsg.includes('besoin') || lowerMsg.includes('commande')) {
    // Calculer la prédiction (même code que /predict-stock)
    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth() + 2; // mois suivant
    if (targetMonth > 12) { targetMonth = 1; targetYear++; }
    const [vaccines] = await pool.query(`SELECT DISTINCT vaccineName FROM vaccinations WHERE vaccineName IS NOT NULL`);
    let predictions = [];
    for (const v of vaccines) {
      const vaccineName = v.vaccineName;
      let consumptions = [];
      for (let i = 1; i <= 3; i++) {
        let pastMonth = targetMonth - i;
        let pastYear = targetYear;
        if (pastMonth <= 0) { pastMonth += 12; pastYear--; }
        const pastMonthStr = `${pastYear}-${String(pastMonth).padStart(2, '0')}`;
        const [rows] = await pool.query(
          `SELECT COUNT(*) as count FROM vaccinations WHERE vaccineName = ? AND DATE_FORMAT(dateAdministered, '%Y-%m') = ?`,
          [vaccineName, pastMonthStr]
        );
        consumptions.push(rows[0]?.count || 0);
      }
      const avg = consumptions.reduce((a,b)=>a+b,0)/3;
      const recommended = Math.ceil(avg * 1.2);
      predictions.push({ vaccineName, average: avg.toFixed(1), recommended });
    }
    response = `📊 **Prévisions pour ${targetYear}-${targetMonth}**\n\n`;
    predictions.forEach(p => {
      response += `• ${p.vaccineName} : moyenne ${p.average} doses/mois → commander **${p.recommended}** doses\n`;
    });
    response += `\n_Marge de sécurité : 20%_`;
  }
  // 2. Demande de stock actuel
  else if (lowerMsg.includes('stock') || lowerMsg.includes('reste')) {
    const currentMonth = new Date().toISOString().slice(0,7);
    const [stocks] = await pool.query(
      `SELECT vaccineName, remaining FROM vaccine_stock WHERE month = ? AND remaining > 0 ORDER BY vaccineName`,
      [currentMonth]
    );
    if (stocks.length === 0) response = `Aucun stock enregistré pour ce mois.`;
    else {
      response = `💊 **Stock disponible (${currentMonth})** :\n`;
      stocks.forEach(s => response += `• ${s.vaccineName} : ${s.remaining} doses\n`);
    }
  }
  // 3. Autre (aide)
  else {
    response = `🤖 Je peux te donner les prévisions de commandes ou l'état du stock. Essaie :\n- "Prévision pour le mois prochain"\n- "Stock actuel"`;
  }

  res.json({ response });
});

module.exports = router;