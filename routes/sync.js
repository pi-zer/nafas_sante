// backend/routes/sync.js
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

const normalizePatient = (patient) => ({
  localId: patient.localId || patient.id,
  name: patient.name || patient.nom,
  sex: patient.sex || patient.sexe,
  birth_date: patient.birthDate || patient.birth_date,
  phone: patient.phone,
  locality: patient.locality,
  created_by: patient.createdBy || patient.created_by,
  created_at: patient.createdAt || patient.created_at,
  updated_at: patient.updatedAt || patient.updated_at,
});

const normalizeAgentId = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = Number.isNaN(Number(value)) ? null : Number(value);
  return normalized;
};

const normalizePatientId = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

// Fonction modifiée pour créer le patient si nécessaire
const resolvePatientId = async (rawId, connection, cache, patientData = null) => {
  if (rawId === undefined || rawId === null) return null;

  const directId = normalizePatientId(rawId);
  if (directId !== null) return directId;

  if (typeof rawId !== 'string') return null;

  if (cache[rawId]) return cache[rawId];

  const [rows] = await connection.query(
    'SELECT id FROM patients WHERE local_id = ?',
    [rawId]
  );

  if (rows.length > 0) {
    const resolvedId = rows[0].id;
    cache[rawId] = resolvedId;
    return resolvedId;
  }

  // Si le patient n'existe pas mais qu'on a des données, on le crée
  if (patientData && (patientData.name || patientData.patientName)) {
    const name = patientData.name || patientData.patientName || 'Patient inconnu';
    const sex = patientData.sex || patientData.sexe || null;
    const birthDate = patientData.birth_date || patientData.birthDate || null;
    const region = patientData.region || null;
    const phone = patientData.phone || null;
    const locality = patientData.locality || null;

    const [result] = await connection.query(
      `INSERT INTO patients (local_id, name, sex, birth_date, phone, locality, region, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [rawId, name, sex, birthDate, phone, locality, region]
    );
    console.log(`✅ Patient créé automatiquement (local_id=${rawId}) -> id=${result.insertId}`);
    const newId = result.insertId;
    cache[rawId] = newId;
    return newId;
  }

  console.warn(`⚠️ Patient introuvable et pas de données pour créer: ${rawId}`);
  return null;
};

router.post('/', async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const patients = Array.isArray(req.body.patients)
    ? req.body.patients
    : items.filter((item) => item.type === 'patient').map((item) => item.data);
  const consultations = Array.isArray(req.body.consultations)
    ? req.body.consultations
    : items.filter((item) => item.type === 'consultation').map((item) => item.data);
  const pregnancies = Array.isArray(req.body.pregnancies)
    ? req.body.pregnancies
    : items.filter((item) => item.type === 'pregnancy').map((item) => item.data);
  const vaccinations = Array.isArray(req.body.vaccinations)
    ? req.body.vaccinations
    : items.filter((item) => item.type === 'vaccination').map((item) => item.data);
  const rawAgentId = req.body.agentId ||
    (items.find((item) => item.data?.agentId)?.data?.agentId) ||
    (patients[0]?.agentId || patients[0]?.createdBy);
  const agentId = normalizeAgentId(rawAgentId);
  const connection = await pool.getConnection();
  
  const results = [];
  const errors = [];
  
  try {
    await connection.beginTransaction();
    const patientIdByLocalId = {};

    // Sync patients (inchangé)
    for (let i = 0; i < patients.length; i++) {
      const rawPatient = patients[i];
      const item = items.find(item => item.type === 'patient' && item.data === rawPatient);
      const patient = normalizePatient(rawPatient);
      const localId = patient.localId;

      try {
        if (!localId || !patient.name || !patient.sex || !patient.birth_date) {
          errors.push({
            id: item?.id || `patient_${i}`,
            error: 'Données patient incomplètes',
            type: 'patient'
          });
          continue;
        }

        const [existingRows] = await connection.query(
          'SELECT id FROM patients WHERE local_id = ?',
          [localId]
        );

        const patientCreatedBy = normalizeAgentId(patient.created_by) ?? agentId;
        let patientId = existingRows.length > 0 ? existingRows[0].id : null;

        if (existingRows.length > 0) {
          await connection.query(
            `UPDATE patients
             SET name = ?, sex = ?, birth_date = ?, phone = ?, locality = ?, created_by = ?, updated_at = ?
             WHERE local_id = ?`,
            [patient.name, patient.sex, patient.birth_date, patient.phone, patient.locality, patientCreatedBy, patient.updated_at || new Date(), localId]
          );
        } else {
          const [result] = await connection.query(
            `INSERT INTO patients (
              local_id, name, sex, birth_date, phone, locality,
              created_by, created_at, updated_at, synced
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
            [localId, patient.name, patient.sex, patient.birth_date, patient.phone, patient.locality, patientCreatedBy, patient.created_at || new Date(), patient.updated_at || new Date()]
          );
          patientId = result.insertId;
        }

        if (localId && patientId) {
          patientIdByLocalId[localId] = patientId;
        }
        
        results.push({
          id: item?.id || `patient_${i}`,
          success: true,
          serverId: patientId,
          type: 'patient'
        });
      } catch (error) {
        console.error('Erreur sync patient:', error);
        errors.push({
          id: item?.id || `patient_${i}`,
          error: error.message || 'Erreur lors de la synchronisation du patient',
          type: 'patient'
        });
      }
    }

    // Sync consultations (avec création automatique du patient)
    for (let i = 0; i < consultations.length; i++) {
      const c = consultations[i];
      const item = items.find(item => item.type === 'consultation' && item.data === c);
      
      try {
        // Préparer les données patient pour création éventuelle
        const patientDataForCreation = {
          name: c.patientName,
          sex: c.patientSex,
          birth_date: c.patientBirthDate,
          phone: c.patientPhone,
          locality: c.patientLocality,
          region: c.patientRegion,
        };
        const resolvedPatientId = await resolvePatientId(c.patientId, connection, patientIdByLocalId, patientDataForCreation);
        const consultationAgentId = normalizeAgentId(c.agentId || c.agent_id) ?? agentId ?? null;

        if (!resolvedPatientId) {
          errors.push({
            id: item?.id || `consultation_${i}`,
            error: `Patient introuvable et création impossible: ${c.patientId}`,
            type: 'consultation'
          });
          continue;
        }

        const [result] = await connection.query(
          `INSERT INTO consultations (
             patientId, agentId, date, symptoms, diagnosis, treatment,
             weight, temperature, bloodPressure, notes, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [resolvedPatientId, consultationAgentId, c.date, JSON.stringify(c.symptoms || []), c.diagnosis, c.treatment,
           c.weight || null, c.temperature || null, c.bloodPressure || null, c.notes || null, c.createdAt || new Date()]
        );
        
        results.push({
          id: item?.id || `consultation_${i}`,
          success: true,
          serverId: result.insertId,
          type: 'consultation'
        });
      } catch (error) {
        console.error('Erreur sync consultation:', error);
        errors.push({
          id: item?.id || `consultation_${i}`,
          error: error.message || 'Erreur lors de la synchronisation de la consultation',
          type: 'consultation'
        });
      }
    }

    // Sync pregnancies (avec création automatique du patient)
    for (let i = 0; i < pregnancies.length; i++) {
      const p = pregnancies[i];
      const item = items.find(item => item.type === 'pregnancy' && item.data === p);
      
      try {
        const patientDataForCreation = {
          name: p.patientName,
          sex: p.patientSex,
          birth_date: p.patientBirthDate,
          phone: p.patientPhone,
          locality: p.patientLocality,
          region: p.patientRegion,
        };
        const resolvedPatientId = await resolvePatientId(p.patientId, connection, patientIdByLocalId, patientDataForCreation);
        const pregnancyAgentId = normalizeAgentId(p.agentId || p.agent_id) ?? agentId ?? null;

        if (!resolvedPatientId) {
          errors.push({
            id: item?.id || `pregnancy_${i}`,
            error: `Patient introuvable et création impossible: ${p.patientId}`,
            type: 'pregnancy'
          });
          continue;
        }

        const [result] = await connection.query(
          `INSERT INTO pregnancies (
             patientId, agentId, startDate, lastMenstrualPeriod, expectedDeliveryDate,
             status, complications, deliveryDate, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [resolvedPatientId, pregnancyAgentId, p.startDate, p.lastMenstrualPeriod || null, p.expectedDeliveryDate || null,
           p.status || 'active', p.complications ? JSON.stringify(p.complications) : null, p.deliveryDate || null, p.createdAt || new Date()]
        );
        
        results.push({
          id: item?.id || `pregnancy_${i}`,
          success: true,
          serverId: result.insertId,
          type: 'pregnancy'
        });
      } catch (error) {
        console.error('Erreur sync pregnancy:', error);
        errors.push({
          id: item?.id || `pregnancy_${i}`,
          error: error.message || 'Erreur lors de la synchronisation de la grossesse',
          type: 'pregnancy'
        });
      }
    }

    // Sync vaccinations (avec création automatique du patient)
    for (let i = 0; i < vaccinations.length; i++) {
      const v = vaccinations[i];
      const item = items.find(item => item.type === 'vaccination' && item.data === v);
      
      try {
        const patientDataForCreation = {
          name: v.patientName,
          sex: v.patientSex,
          birth_date: v.patientBirthDate,
          phone: v.patientPhone,
          locality: v.patientLocality,
          region: v.patientRegion,
        };
        const resolvedPatientId = await resolvePatientId(v.patientId, connection, patientIdByLocalId, patientDataForCreation);
        const vaccinationAgentId = normalizeAgentId(v.agentId || v.agent_id) ?? agentId ?? null;

        if (!resolvedPatientId) {
          errors.push({
            id: item?.id || `vaccination_${i}`,
            error: `Patient introuvable et création impossible: ${v.patientId}`,
            type: 'vaccination'
          });
          continue;
        }

        const [result] = await connection.query(
          `INSERT INTO vaccinations (
             patientId, agentId, vaccineName, doseNumber, dateAdministered,
             nextDoseDate, batchNumber, location, observations
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [resolvedPatientId, vaccinationAgentId, v.vaccineName, v.doseNumber || 1, v.dateAdministered,
           v.nextDoseDate || null, v.batchNumber || null, v.location || null, v.observations || null]
        );
        
        results.push({
          id: item?.id || `vaccination_${i}`,
          success: true,
          serverId: result.insertId,
          type: 'vaccination'
        });
      } catch (error) {
        console.error('Erreur sync vaccination:', error);
        errors.push({
          id: item?.id || `vaccination_${i}`,
          error: error.message || 'Erreur lors de la synchronisation de la vaccination',
          type: 'vaccination'
        });
      }
    }

    await connection.commit();
    
    const response = {
      success: true,
      message: `${results.length} élément(s) synchronisé(s)`,
      results,
      count: results.length
    };
    
    if (errors.length > 0) {
      response.errors = errors;
      response.message += `, ${errors.length} erreur(s)`;
    }
    
    res.json(response);
  } catch (error) {
    await connection.rollback();
    console.error('Erreur sync:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la synchronisation',
      message: error.message 
    });
  } finally {
    connection.release();
  }
});

module.exports = router;