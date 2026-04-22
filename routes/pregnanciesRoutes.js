// backend/routes/pregnanciesRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/pregnancies – Liste toutes les grossesses
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        p.id,
        p.patientId,
        pat.name as patient_name,
        p.agentId,
        p.agentId as agent_id,   -- ✅ Alias pour le frontend
        u.full_name as agent_name,
        p.startDate,
        p.lastMenstrualPeriod,
        p.expectedDeliveryDate,
        p.status,
        p.complications,
        p.deliveryDate,
        p.created_at
      FROM pregnancies p
      LEFT JOIN patients pat ON p.patientId = pat.id
      LEFT JOIN users u ON p.agentId = u.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Erreur récupération grossesses:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

// GET /api/pregnancies/:id – Détail d'une grossesse
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT 
        p.*,
        p.agentId as agent_id,
        pat.name as patient_name,
        u.full_name as agent_name
      FROM pregnancies p
      LEFT JOIN patients pat ON p.patientId = pat.id
      LEFT JOIN users u ON p.agentId = u.id
      WHERE p.id = ?
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Grossesse non trouvée' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Erreur récupération grossesse:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/pregnancies – Créer une nouvelle grossesse
router.post('/', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const {
      patientId, agentId, startDate, lastMenstrualPeriod, expectedDeliveryDate,
      status, complications, deliveryDate
    } = req.body;
    
    if (!patientId || !agentId || !startDate) {
      return res.status(400).json({ error: 'Champs requis manquants (patientId, agentId, startDate)' });
    }
    
    const [result] = await connection.query(
      `INSERT INTO pregnancies (
        patientId, agentId, startDate, lastMenstrualPeriod, expectedDeliveryDate,
        status, complications, deliveryDate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [patientId, agentId, startDate, lastMenstrualPeriod || null, expectedDeliveryDate || null,
       status || 'active', complications ? JSON.stringify(complications) : null, deliveryDate || null]
    );
    
    await connection.commit();
    
    const [newPregnancy] = await connection.query(
      'SELECT *, agentId as agent_id FROM pregnancies WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json(newPregnancy[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Erreur création grossesse:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  } finally {
    connection.release();
  }
});

// PUT /api/pregnancies/:id – Mettre à jour une grossesse
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      startDate, lastMenstrualPeriod, expectedDeliveryDate,
      status, complications, deliveryDate
    } = req.body;
    
    await pool.query(
      `UPDATE pregnancies 
       SET startDate = ?, lastMenstrualPeriod = ?, expectedDeliveryDate = ?,
           status = ?, complications = ?, deliveryDate = ?
       WHERE id = ?`,
      [startDate, lastMenstrualPeriod || null, expectedDeliveryDate || null,
       status || 'active', complications ? JSON.stringify(complications) : null, deliveryDate || null, id]
    );
    
    const [updated] = await pool.query(
      'SELECT *, agentId as agent_id FROM pregnancies WHERE id = ?',
      [id]
    );
    res.json(updated[0]);
  } catch (error) {
    console.error('Erreur mise à jour grossesse:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/pregnancies/:id – Supprimer une grossesse
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM pregnancies WHERE id = ?', [id]);
    res.json({ success: true, message: 'Grossesse supprimée' });
  } catch (error) {
    console.error('Erreur suppression grossesse:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;