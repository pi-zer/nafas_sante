// backend/routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const authenticateToken = require('../middleware/auth');
const authorizeAdmin = require('../middleware/admin');
const { pool } = require('../config/database');

router.use(authenticateToken, authorizeAdmin);

// ==================== STATISTIQUES GLOBALES DÉTAILLÉES ====================
router.get('/stats', async (req, res) => {
  try {
    const [agents] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'agent'");
    const [patients] = await pool.query("SELECT COUNT(*) as count FROM patients");
    const [consultations] = await pool.query("SELECT COUNT(*) as count FROM consultations");
    const [pregnancies] = await pool.query("SELECT COUNT(*) as count FROM pregnancies");
    const [vaccinations] = await pool.query("SELECT COUNT(*) as count FROM vaccinations");

    let byRegion = [];
    try {
      const [regions] = await pool.query(`
        SELECT locality, COUNT(*) as count 
        FROM patients 
        WHERE locality IS NOT NULL
        GROUP BY locality 
        ORDER BY count DESC
      `);
      byRegion = regions;
    } catch (err) {
      const [regions] = await pool.query(`
        SELECT region, COUNT(*) as count 
        FROM patients 
        WHERE region IS NOT NULL
        GROUP BY region 
        ORDER BY count DESC
      `);
      byRegion = regions.map(r => ({ locality: r.region, count: r.count }));
    }

    const [bySex] = await pool.query(`
      SELECT sex, COUNT(*) as count 
      FROM patients 
      GROUP BY sex
    `);

    const regionStats = {};
    byRegion.forEach(r => regionStats[r.locality] = r.count);

    const sexStats = { M: 0, F: 0 };
    bySex.forEach(s => sexStats[s.sex] = s.count);

    res.json({
      totalPatients: patients[0]?.count || 0,
      totalAgents: agents[0]?.count || 0,
      totalConsultations: consultations[0]?.count || 0,
      totalPregnancies: pregnancies[0]?.count || 0,
      totalVaccinations: vaccinations[0]?.count || 0,
      byRegion: regionStats,
      bySex: sexStats
    });
  } catch (error) {
    console.error('❌ Erreur stats:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// ==================== STATISTIQUES GLOBALES RAPIDES (pour le tableau de bord) ====================
router.get('/summary', async (req, res) => {
  try {
    const [patients] = await pool.query("SELECT COUNT(*) as total FROM patients");
    const [consultations] = await pool.query("SELECT COUNT(*) as total FROM consultations");
    const [pregnancies] = await pool.query("SELECT COUNT(*) as total FROM pregnancies");
    const [vaccinations] = await pool.query("SELECT COUNT(*) as total FROM vaccinations");
    const [agents] = await pool.query(`
      SELECT 
        COUNT(*) as total, 
        SUM(active = 1) as active 
      FROM users 
      WHERE role = 'agent'
    `);

    const totalAgents = agents[0]?.total || 0;
    const activeAgents = agents[0]?.active || 0;

    res.json({
      patients: patients[0]?.total || 0,
      consultations: consultations[0]?.total || 0,
      pregnancies: pregnancies[0]?.total || 0,
      vaccinations: vaccinations[0]?.total || 0,
      agents: totalAgents,
      activeAgents: activeAgents,
      inactiveAgents: totalAgents - activeAgents
    });
  } catch (error) {
    console.error('❌ Erreur stats globales:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// ==================== LISTE DES PATIENTS (avec created_by) ====================
router.get('/patients', async (req, res) => {
  try {
    const [patients] = await pool.query(`
      SELECT 
        p.id, 
        p.name, 
        p.sex,
        p.birth_date,
        TIMESTAMPDIFF(YEAR, p.birth_date, CURDATE()) as age,
        p.phone,
        p.locality,
        p.created_at as createdAt,
        p.updated_at as updatedAt,
        p.created_by as createdBy,
        u.full_name as agentName
      FROM patients p
      LEFT JOIN users u ON p.created_by = u.id
      ORDER BY p.created_at DESC
    `);

    console.log('📊 Patients chargés:', patients.length);
    res.json(patients);
  } catch (error) {
    console.error('❌ Erreur chargement patients:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// ==================== LISTE DES CONSULTATIONS (avec agent_id) ====================
router.get('/consultations', async (req, res) => {
  try {
    const [consultations] = await pool.query(`
      SELECT 
        c.id,
        c.patientId,
        p.name as patientName,
        c.agentId,
        u.full_name as agentName,
        c.date,
        c.symptoms,
        c.diagnosis,
        c.treatment,
        c.weight,
        c.temperature,
        c.bloodPressure,
        c.notes,
        c.created_at as createdAt
      FROM consultations c
      LEFT JOIN patients p ON c.patientId = p.id
      LEFT JOIN users u ON c.agentId = u.id
      ORDER BY c.date DESC
    `);

    console.log('📊 Consultations chargées:', consultations.length);
    res.json(consultations);
  } catch (error) {
    console.error('❌ Erreur chargement consultations:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// ==================== LISTE DES GROSSESSES (avec agent_id) ====================
router.get('/pregnancies', async (req, res) => {
  try {
    const [pregnancies] = await pool.query(`
      SELECT 
        p.id,
        p.patientId,
        pat.name as patientName,
        p.agentId,
        u.full_name as agentName,
        p.startDate,
        p.lastMenstrualPeriod,
        p.expectedDeliveryDate,
        p.status,
        p.complications,
        p.deliveryDate,
        p.created_at as createdAt
      FROM pregnancies p
      LEFT JOIN patients pat ON p.patientId = pat.id
      LEFT JOIN users u ON p.agentId = u.id
      ORDER BY p.created_at DESC
    `);

    console.log('📊 Grossesses chargées:', pregnancies.length);
    res.json(pregnancies);
  } catch (error) {
    console.error('❌ Erreur chargement grossesses:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// ==================== LISTE DES VACCINATIONS (avec agent_id) ====================
router.get('/vaccinations', async (req, res) => {
  try {
    const [vaccinations] = await pool.query(`
      SELECT 
        v.id,
        v.patientId,
        p.name as patientName,
        v.agentId,
        u.full_name as agentName,
        v.vaccineName,
        v.doseNumber,
        v.dateAdministered,
        v.nextDoseDate,
        v.batchNumber,
        v.location,
        v.observations,
        v.created_at as createdAt
      FROM vaccinations v
      LEFT JOIN patients p ON v.patientId = p.id
      LEFT JOIN users u ON v.agentId = u.id
      ORDER BY v.dateAdministered DESC
    `);

    console.log('📊 Vaccinations chargées:', vaccinations.length);
    res.json(vaccinations);
  } catch (error) {
    console.error('❌ Erreur chargement vaccinations:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// ==================== LISTE DES AGENTS AVEC STATISTIQUES DÉTAILLÉES ====================
router.get('/agents', async (req, res) => {
  try {
    const [agents] = await pool.query(`
      SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.full_name, 
        u.region, 
        u.active, 
        u.created_at,
        (SELECT COUNT(*) FROM patients WHERE created_by = u.id) as patientsCount,
        (SELECT COUNT(*) FROM vaccinations WHERE agentId = u.id) as vaccinationsCount,
        (SELECT COUNT(*) FROM consultations WHERE agentId = u.id) as consultationsCount,
        (SELECT COUNT(*) FROM pregnancies WHERE agentId = u.id) as pregnanciesCount
      FROM users u
      WHERE u.role = 'agent'
      ORDER BY u.created_at DESC
    `);

    res.json(agents);
  } catch (error) {
    console.error('❌ Erreur liste agents:', error);
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
});

// ==================== CRÉER UN AGENT ====================
router.post('/agents', async (req, res) => {
  const { full_name, email, region, password } = req.body;

  try {
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé' });
    }

    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const username = email.split('@')[0] + Math.floor(Math.random() * 1000);

    const [result] = await pool.query(
      `INSERT INTO users (username, password, email, full_name, role, region, active) 
       VALUES (?, ?, ?, ?, 'agent', ?, 1)`,
      [username, hashedPassword, email, full_name, region]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Agent créé avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur création agent:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== MODIFIER UN AGENT ====================
router.put('/agents/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, email, region } = req.body;

  try {
    await pool.query(
      `UPDATE users 
       SET full_name = ?, email = ?, region = ?
       WHERE id = ? AND role = 'agent'`,
      [full_name, email, region, id]
    );

    res.json({ success: true, message: 'Agent modifié avec succès' });
  } catch (error) {
    console.error('❌ Erreur modification agent:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== ACTIVER/DÉSACTIVER UN AGENT ====================
router.put('/agents/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;

  try {
    await pool.query(
      'UPDATE users SET active = ? WHERE id = ? AND role = ?',
      [active ? 1 : 0, id, 'agent']
    );

    res.json({
      success: true,
      message: active ? 'Agent activé' : 'Agent désactivé'
    });
  } catch (error) {
    console.error('❌ Erreur toggle agent:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== STATISTIQUES DÉTAILLÉES PAR AGENT ====================
router.get('/agents/:id/stats', async (req, res) => {
  const { id } = req.params;

  try {
    const [patients] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as recent
      FROM patients
      WHERE created_by = ?
    `, [id]);

    const [consultations] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as recent
      FROM consultations
      WHERE agentId = ?
    `, [id]);

    const [pregnancies] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'miscarriage' THEN 1 ELSE 0 END) as miscarriage
      FROM pregnancies
      WHERE agentId = ?
    `, [id]);

    const [vaccinations] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN dateAdministered >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as recent,
        SUM(CASE WHEN nextDoseDate > CURDATE() THEN 1 ELSE 0 END) as upcoming
      FROM vaccinations
      WHERE agentId = ?
    `, [id]);

    const [vaccinesByType] = await pool.query(`
      SELECT vaccineName, COUNT(*) as count
      FROM vaccinations
      WHERE agentId = ?
      GROUP BY vaccineName
      ORDER BY count DESC
    `, [id]);

    const vaccinesDetail = {};
    vaccinesByType.forEach(v => vaccinesDetail[v.vaccineName] = v.count);

    res.json({
      patients: {
        total: patients[0]?.total || 0,
        recent: patients[0]?.recent || 0
      },
      consultations: {
        total: consultations[0]?.total || 0,
        recent: consultations[0]?.recent || 0
      },
      pregnancies: {
        total: pregnancies[0]?.total || 0,
        active: pregnancies[0]?.active || 0,
        delivered: pregnancies[0]?.delivered || 0,
        miscarriage: pregnancies[0]?.miscarriage || 0
      },
      vaccinations: {
        total: vaccinations[0]?.total || 0,
        recent: vaccinations[0]?.recent || 0,
        upcoming: vaccinations[0]?.upcoming || 0,
        byType: vaccinesDetail
      }
    });
  } catch (error) {
    console.error('❌ Erreur stats agent:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ==================== STATISTIQUES MENSUELLES ====================
router.get('/monthly-stats', async (req, res) => {
  try {
    const { year, month } = req.query;
    const currentYear = year || new Date().getFullYear();
    const currentMonth = month || new Date().getMonth() + 1;

    const [vaccinations] = await pool.query(`
      SELECT 
        DATE_FORMAT(dateAdministered, '%Y-%m') as period,
        COUNT(*) as total,
        COUNT(DISTINCT patientId) as patients
      FROM vaccinations
      WHERE YEAR(dateAdministered) = ? AND MONTH(dateAdministered) = ?
      GROUP BY DATE_FORMAT(dateAdministered, '%Y-%m')
    `, [currentYear, currentMonth]);

    const [consultations] = await pool.query(`
      SELECT 
        DATE_FORMAT(date, '%Y-%m') as period,
        COUNT(*) as total
      FROM consultations
      WHERE YEAR(date) = ? AND MONTH(date) = ?
      GROUP BY DATE_FORMAT(date, '%Y-%m')
    `, [currentYear, currentMonth]);

    res.json({
      year: currentYear,
      month: currentMonth,
      vaccinations: vaccinations[0] || { total: 0, patients: 0 },
      consultations: consultations[0] || { total: 0 }
    });
  } catch (error) {
    console.error('❌ Erreur stats mensuelles:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;