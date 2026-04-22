// backend/routes/vaccinationRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/vaccinations
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        v.id,
        v.patientId,
        v.agentId,
        v.vaccineName,
        v.doseNumber,
        v.dateAdministered,
        v.nextDoseDate,
        v.batchNumber,
        v.location,
        v.observations,
        v.created_at as createdAt,
        p.name as patientName, 
        p.sex as patientSex, 
        TIMESTAMPDIFF(YEAR, p.birth_date, CURDATE()) as age, 
        p.locality
      FROM vaccinations v
      LEFT JOIN patients p ON v.patientId = p.id
      ORDER BY v.dateAdministered DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Erreur récupération vaccinations:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

// GET /api/vaccinations/registry
router.get('/registry', async (req, res) => {
  try {
    const { month, region } = req.query;
    
    let query = `
      SELECT 
        v.id,
        v.patientId,
        v.agentId,
        v.vaccineName,
        v.doseNumber,
        v.dateAdministered,
        v.nextDoseDate,
        v.batchNumber,
        v.location,
        v.observations,
        v.created_at as createdAt,
        p.name as patientName, 
        p.sex as patientSex,
        TIMESTAMPDIFF(YEAR, p.birth_date, CURDATE()) as age,
        p.locality as region
      FROM vaccinations v
      LEFT JOIN patients p ON v.patientId = p.id
      WHERE 1=1
    `;
    const params = [];
    
    if (month) {
      query += ` AND DATE_FORMAT(v.dateAdministered, '%Y-%m') = ?`;
      params.push(month);
    }
    
    if (region && region !== 'all') {
      query += ` AND p.locality = ?`;
      params.push(region);
    }
    
    query += ` ORDER BY v.dateAdministered DESC`;
    
    const [rows] = await pool.query(query, params);
    console.log(`📋 Registre vaccinations: ${rows.length} enregistrements (month=${month}, region=${region})`);
    
    res.json(rows || []);
  } catch (error) {
    console.error('Erreur récupération registre:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

// POST /api/vaccinations
router.post('/', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const {
      patientId, agentId, vaccineName, doseNumber, dateAdministered,
      nextDoseDate, batchNumber, location, observations
    } = req.body;
    
    if (!patientId || !agentId || !vaccineName || !dateAdministered) {
      return res.status(400).json({ error: 'Champs requis manquants' });
    }
    
    const [result] = await connection.query(
      `INSERT INTO vaccinations (
        patientId, agentId, vaccineName, doseNumber, dateAdministered,
        nextDoseDate, batchNumber, location, observations
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patientId, agentId, vaccineName, doseNumber || 1, dateAdministered,
       nextDoseDate || null, batchNumber || null, location || null, observations || null]
    );
    
    // Mettre à jour le stock
    try {
      const month = dateAdministered.slice(0, 7);
      const year = parseInt(month.split('-')[0]);
      const monthNumber = parseInt(month.split('-')[1]);
      
      await connection.query(
        `INSERT INTO vaccine_stock (vaccineId, vaccineName, month, year, monthNumber, used, remaining)
         VALUES (?, ?, ?, ?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE 
           used = used + 1,
           remaining = initialStock + received - used`,
        [vaccineName, vaccineName, month, year, monthNumber]
      );
    } catch (stockError) {
      console.log('⚠️ Erreur mise à jour stock:', stockError.message);
    }
    
    await connection.commit();
    
    const [newVaccination] = await connection.query(
      'SELECT * FROM vaccinations WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json(newVaccination[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Erreur création vaccination:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  } finally {
    connection.release();
  }
});

// GET /api/vaccinations/stats/monthly/:month
router.get('/stats/monthly/:month', async (req, res) => {
  try {
    const { month } = req.params;
    
    const [rows] = await pool.query(
      `SELECT 
        v.id,
        v.patientId,
        v.agentId,
        v.vaccineName,
        v.doseNumber,
        v.dateAdministered,
        p.sex as patientSex,
        TIMESTAMPDIFF(YEAR, p.birth_date, CURDATE()) as age
       FROM vaccinations v
       LEFT JOIN patients p ON v.patientId = p.id
       WHERE DATE_FORMAT(v.dateAdministered, '%Y-%m') = ?`,
      [month]
    );
    
    const childrenSet = new Set();
    const womenSet = new Set();
    const maleSet = new Set();
    const femaleSet = new Set();
    const byVaccine = {};
    
    const childVaccines = ['BCG', 'Polio 0', 'Pentavalent 1', 'Pentavalent 2', 'Pentavalent 3', 'Pneumo 1', 'Pneumo 2', 'Pneumo 3', 'Rotavirus 1', 'Rotavirus 2', 'Rougeole', 'Fièvre jaune'];
    
    for (const v of rows) {
      byVaccine[v.vaccineName] = (byVaccine[v.vaccineName] || 0) + 1;
      
      if (v.patientSex === 'M') maleSet.add(v.patientId);
      if (v.patientSex === 'F') femaleSet.add(v.patientId);
      
      const isChildVaccine = childVaccines.includes(v.vaccineName);
      if (isChildVaccine || (v.age && v.age < 60)) {
        childrenSet.add(v.patientId);
      }
      
      if (v.vaccineName && v.vaccineName.includes('VAT')) {
        womenSet.add(v.patientId);
      }
    }
    
    res.json({
      month,
      childrenVaccinated: childrenSet.size,
      womenVaccinated: womenSet.size,
      totalVaccines: rows.length,
      byVaccine,
      bySex: {
        male: maleSet.size,
        female: femaleSet.size
      }
    });
  } catch (error) {
    console.error('Erreur stats mensuelles:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;