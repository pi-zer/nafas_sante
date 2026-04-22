// backend/server.js
const express = require('express');
const cors = require('cors');
const os = require('os');
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

// ==================== IP LOCALE (DYNAMIQUE) ====================
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const priority = ['Wi-Fi', 'en0', 'eth0', 'wlan0']; // préférer WiFi

  // 1. Chercher en priorité les interfaces WiFi connues
  for (const name of priority) {
    if (interfaces[name]) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }

  // 2. Fallback : première IPv4 non-interne trouvée
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return 'localhost';
}

// ✅ CORRECTION PRINCIPALE : appel de la fonction au lieu de l'IP hardcodée
const LOCAL_IP = getLocalIP();
console.log(`🌐 IP locale détectée automatiquement: ${LOCAL_IP}`);

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

// Logging simple
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// ==================== ROUTES TEST ====================
app.get('/', (req, res) => {
  res.send('🚀 Serveur NafasSante OK');
});

app.get('/api/ping', (req, res) => {
  res.json({ success: true, message: 'pong', ip: LOCAL_IP });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    ip: LOCAL_IP,
    port: PORT
  });
});

app.put('/api/users/photo', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier reçu' });
    }

    const photoUrl = `http://${LOCAL_IP}:${PORT}/uploads/${req.file.filename}`;
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

const startServer = async () => {
  try {
    await initializeDatabase();
    await applyMigrations();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
🚀 Serveur NafasSante lancé !
👉 Local:   http://localhost:${PORT}
👉 Réseau:  http://${LOCAL_IP}:${PORT}
👉 Ping:    http://${LOCAL_IP}:${PORT}/api/ping
👉 Registre: http://${LOCAL_IP}:${PORT}/api/vaccinations/registry?month=2026-04&region=all

📱 Dans ton app React Native, utilise :
   API_URL = "http://${LOCAL_IP}:${PORT}/api"
      `);
    });
  } catch (err) {
    console.error('❌ Impossible de démarrer le serveur:', err.message || err);
    process.exit(1);
  }
};

startServer();