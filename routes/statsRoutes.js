// backend/routes/statsRoutes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/stats/vaccinations - Récupérer les statistiques de vaccination
router.get('/vaccinations', async (req, res) => {
  try {
    // Récupérer les statistiques mensuelles des vaccinations
    const [stats] = await pool.query(`
      SELECT 
        DATE_FORMAT(v.dateAdministered, '%Y-%m') as month,
        COUNT(*) as totalVaccines,
        COUNT(DISTINCT v.patientId) as childrenVaccinated,
        COUNT(DISTINCT CASE WHEN v.vaccineName LIKE 'VAT%' THEN v.patientId END) as womenVaccinated,
        SUM(CASE WHEN v.vaccineName = 'BCG' THEN 1 ELSE 0 END) as bcg,
        SUM(CASE WHEN v.vaccineName = 'Polio 0' THEN 1 ELSE 0 END) as polio0,
        SUM(CASE WHEN v.vaccineName = 'Pentavalent 1' THEN 1 ELSE 0 END) as penta1,
        SUM(CASE WHEN v.vaccineName = 'Pentavalent 2' THEN 1 ELSE 0 END) as penta2,
        SUM(CASE WHEN v.vaccineName = 'Pentavalent 3' THEN 1 ELSE 0 END) as penta3,
        SUM(CASE WHEN v.vaccineName = 'Rougeole' THEN 1 ELSE 0 END) as rougeole,
        SUM(CASE WHEN v.vaccineName = 'Fièvre jaune' THEN 1 ELSE 0 END) as fievre_jaune,
        SUM(CASE WHEN v.vaccineName LIKE 'VAT%' THEN 1 ELSE 0 END) as vat
      FROM vaccinations v
      GROUP BY DATE_FORMAT(v.dateAdministered, '%Y-%m')
      ORDER BY month DESC
    `);
    
    res.json(stats);
  } catch (error) {
    console.error('Erreur récupération stats vaccinations:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

// GET /api/stats - Récupérer toutes les statistiques
router.get('/', async (req, res) => {
  try {
    // Statistiques globales
    const [global] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM patients) as totalPatients,
        (SELECT COUNT(*) FROM users WHERE role = 'agent') as totalAgents,
        (SELECT COUNT(*) FROM consultations) as totalConsultations,
        (SELECT COUNT(*) FROM pregnancies) as totalPregnancies,
        (SELECT COUNT(*) FROM vaccinations) as totalVaccinations
    `);
    
    // Statistiques par mois
    const [monthly] = await pool.query(`
      SELECT 
        DATE_FORMAT(v.dateAdministered, '%Y-%m') as month,
        COUNT(*) as totalVaccines,
        COUNT(DISTINCT v.patientId) as patientsVaccinated
      FROM vaccinations v
      GROUP BY DATE_FORMAT(v.dateAdministered, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
    `);
    
    res.json({
      global: global[0],
      monthly: monthly
    });
  } catch (error) {
    console.error('Erreur récupération stats:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

// GET /api/stats/monthly/:month - Statistiques mensuelles détaillées
router.get('/monthly/:month', async (req, res) => {
  try {
    const { month } = req.params;
    
    const [rows] = await pool.query(
      `SELECT 
        v.*,
        p.sex as patient_sex,
        TIMESTAMPDIFF(YEAR, p.birth_date, CURDATE()) as patient_age
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
      
      if (v.patient_sex === 'M') maleSet.add(v.patientId);
      if (v.patient_sex === 'F') femaleSet.add(v.patientId);
      
      const isChildVaccine = childVaccines.includes(v.vaccineName);
      if (isChildVaccine || (v.patient_age && v.patient_age < 60)) {
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

// POST /api/stats/vaccinations - Sauvegarder des statistiques
router.post('/vaccinations', async (req, res) => {
  try {
    const stats = req.body;
    
    const [result] = await pool.query(
      `INSERT INTO vaccination_stats 
       (month, year, monthNumber, childrenVaccinated, womenVaccinated, totalVaccines, byVaccine, bySex, byAgeGroup, coverage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         childrenVaccinated = VALUES(childrenVaccinated),
         womenVaccinated = VALUES(womenVaccinated),
         totalVaccines = VALUES(totalVaccines),
         byVaccine = VALUES(byVaccine),
         bySex = VALUES(bySex),
         byAgeGroup = VALUES(byAgeGroup),
         coverage = VALUES(coverage),
         updated_at = NOW()`,
      [
        stats.month, stats.year, stats.monthNumber,
        stats.childrenVaccinated, stats.womenVaccinated, stats.totalVaccines,
        JSON.stringify(stats.byVaccine), JSON.stringify(stats.bySex),
        JSON.stringify(stats.byAgeGroup), JSON.stringify(stats.coverage)
      ]
    );
    
    res.status(201).json(stats);
  } catch (error) {
    console.error('Erreur sauvegarde stats:', error);
    res.status(500).json({ error: 'Erreur serveur: ' + error.message });
  }
});

module.exports = router;