// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const authenticateToken = require('./middleware/auth');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');
const adminRoutes = require('./routes/admin');
const vaccinationRoutes = require('./routes/vaccinationRoutes');
const statsRoutes = require('./routes/statsRoutes');
const stockRoutes = require('./routes/stockRoutes');
const consultationsRoutes = require('./routes/consultationsRoutes');
const pregnanciesRoutes = require('./routes/pregnanciesRoutes');
const { initializeDatabase, applyMigrations, pool } = require('./config/database');

const app = express();

// ==================== CONFIGURATION ====================
// 🚀 URL publique (Railway fournit RAILWAY_PUBLIC_URL, Vercel utilise VERCEL_URL)
const BASE_URL = process.env.RAILWAY_PUBLIC_URL ||
                 (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
                 process.env.PUBLIC_URL ||
                 `http://localhost:${process.env.PORT || 3000}`;

console.log(`🌐 URL publique de l'API : ${BASE_URL}`);

// Configuration multer pour les uploads
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname) || '.jpg';
    cb(null, `profile-${Date.now()}${extension}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging simple (uniquement en développement)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.url}`);
    next();
  });
}

// ==================== ROUTES TEST ====================
app.get('/', (req, res) => {
  res.send('🚀 Serveur NafasSante OK');
});

app.get('/api/ping', (req, res) => {
  res.json({ success: true, message: 'pong', url: BASE_URL });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    port: process.env.PORT || 3000
  });
});

app.put('/api/users/photo', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier reçu' });
    }

    const photoUrl = `${BASE_URL}/uploads/${req.file.filename}`;
    await pool.query('UPDATE users SET photo = ?, updated_at = NOW() WHERE id = ?', [photoUrl, req.user.id]);

    const [users] = await pool.query(
      'SELECT id, username, email, full_name, role, region, phone, photo FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    res.json({ success: true, photo: photoUrl, user: users[0] });
  } catch (error) {
    console.error('❌ Erreur upload photo profil:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur upload photo' });
  }
});

// ==================== ROUTES PRINCIPALES ====================
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/vaccinations', vaccinationRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/consultations', consultationsRoutes);
app.use('/api/pregnancies', pregnanciesRoutes);

// ==================== REGISTRE VACCINATIONS ====================
app.get('/api/vaccinations/registry', async (req, res) => {
  try {
    const { month, region } = req.query;
    console.log(`📊 Registre vaccinations - mois: ${month}, région: ${region}`);

    // À remplacer par une vraie requête SQL quand les tables seront prêtes
    const mockRegistre = [
      { id: 1, patientName: 'Jean Dupont',  vaccineName: 'BCG',   dateAdministered: '2026-04-01', region: 'Mayo-Kebbi Ouest', doseNumber: 1 },
      { id: 2, patientName: 'Marie Claire', vaccineName: 'VAT',   dateAdministered: '2026-04-05', region: 'Mayo-Kebbi Ouest', doseNumber: 2 },
      { id: 3, patientName: 'Paul Martin',  vaccineName: 'Polio', dateAdministered: '2026-04-10', region: 'Mayo-Kebbi Est',   doseNumber: 1 },
    ];

    let result = mockRegistre;
    if (month)                   result = result.filter(r => r.dateAdministered.startsWith(month));
    if (region && region !== 'all') result = result.filter(r => r.region === region);

    res.json(result);
  } catch (error) {
    console.error('❌ Erreur registre vaccinations:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// ==================== 404 ====================
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// ==================== GESTION DES ERREURS ====================
app.use((err, req, res, next) => {
  console.error('❌', err.message);
  res.status(500).json({ error: err.message });
});

// ==================== DÉMARRAGE ====================
const PORT = process.env.PORT || 3000;

// Démarrage classique pour Railway / Render / développement local
// Si on est sur Vercel, on n'écoute pas (Vercel gère l'export)
if (!process.env.VERCEL) {
  const startServer = async () => {
    try {
      await initializeDatabase();
      await applyMigrations();

      app.listen(PORT, '0.0.0.0', () => {
        console.log(`
🚀 Serveur NafasSante lancé !
👉 URL publique : ${BASE_URL}
👉 Port interne : ${PORT}
👉 Endpoint santé : ${BASE_URL}/api/health
        `);
      });
    } catch (err) {
      console.error('❌ Impossible de démarrer le serveur:', err.message || err);
      process.exit(1);
    }
  };
  startServer();
}

// ==================== EXPORT POUR VERCEL ====================
module.exports = app;