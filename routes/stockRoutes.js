// backend/routes/stockRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// PUT /api/stock/consume
router.put('/consume', async (req, res) => {
  try {
    const { vaccineId, quantity, month } = req.body;
    if (!vaccineId || !quantity || !month) {
      return res.status(400).json({ error: 'vaccineId, quantity et month sont requis' });
    }

    const [result] = await pool.query(
      `UPDATE vaccine_stock 
       SET used = used + ?, remaining = initialStock + received - (used + ?)
       WHERE vaccineId = ? AND month = ?`,
      [quantity, quantity, vaccineId, month]
    );

    if (result.affectedRows === 0) {
      // Si aucune ligne n'a été mise à jour, on crée une entrée avec used = quantity
      const [year, monthNum] = month.split('-');
      await pool.query(
        `INSERT INTO vaccine_stock (vaccineId, vaccineName, month, year, monthNumber, used, remaining)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vaccineId, vaccineId, month, parseInt(year), parseInt(monthNum), quantity, -quantity]
      );
    }

    res.json({ success: true, message: 'Stock consommé' });
  } catch (error) {
    console.error('Erreur consommation stock:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// (Gardez vos autres routes : GET /, POST /, etc.)

module.exports = router;