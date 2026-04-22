// backend/routes/consultationsRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/consultations – Liste toutes les consultations
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.id,
        c.patientId,
        p.name as patient_name,
        c.agentId,
        c.agentId as agent_id,   -- ✅ Alias pour le frontend
        u.full_name as agent_name,
        c.date,
        c.symptoms,
        c.diagnosis,
        c.treatment,
        c.weight,
        c.temperature,
        c.bloodPressure,
        c.notes,
        c.created_at
      FROM consultations c
      LEFT JOIN patients p ON c.patientId = p.id
      LEFT JOIN users u ON c.agentId = u.id
      ORDER BY c.date DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Erreur récupération consultations:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

// GET /api/consultations/:id – Détail d'une consultation
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT 
        c.*,
        c.agentId as agent_id,
        p.name as patient_name,
        u.full_name as agent_name
      FROM consultations c
      LEFT JOIN patients p ON c.patientId = p.id
      LEFT JOIN users u ON c.agentId = u.id
      WHERE c.id = ?
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Consultation non trouvée' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Erreur récupération consultation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/consultations – Créer une nouvelle consultation
router.post('/', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const {
      patientId, agentId, date, symptoms, diagnosis, treatment,
      weight, temperature, bloodPressure, notes
    } = req.body;
    
    if (!patientId || !agentId || !date || !diagnosis) {
      return res.status(400).json({ error: 'Champs requis manquants (patientId, agentId, date, diagnosis)' });
    }
    
    const [result] = await connection.query(
      `INSERT INTO consultations (
        patientId, agentId, date, symptoms, diagnosis, treatment,
        weight, temperature, bloodPressure, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patientId, agentId, date, JSON.stringify(symptoms || []), diagnosis, treatment || null,
       weight || null, temperature || null, bloodPressure || null, notes || null]
    );
    
    await connection.commit();
    
    const [newConsultation] = await connection.query(
      'SELECT *, agentId as agent_id FROM consultations WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json(newConsultation[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Erreur création consultation:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  } finally {
    connection.release();
  }
});

// PUT /api/consultations/:id – Mettre à jour une consultation
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date, symptoms, diagnosis, treatment,
      weight, temperature, bloodPressure, notes
    } = req.body;
    
    await pool.query(
      `UPDATE consultations 
       SET date = ?, symptoms = ?, diagnosis = ?, treatment = ?,
           weight = ?, temperature = ?, bloodPressure = ?, notes = ?
       WHERE id = ?`,
      [date, JSON.stringify(symptoms || []), diagnosis, treatment || null,
       weight || null, temperature || null, bloodPressure || null, notes || null, id]
    );
    
    const [updated] = await pool.query(
      'SELECT *, agentId as agent_id FROM consultations WHERE id = ?',
      [id]
    );
    res.json(updated[0]);
  } catch (error) {
    console.error('Erreur mise à jour consultation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/consultations/:id – Supprimer une consultation
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM consultations WHERE id = ?', [id]);
    res.json({ success: true, message: 'Consultation supprimée' });
  } catch (error) {
    console.error('Erreur suppression consultation:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;