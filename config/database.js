// backend/config/database.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Charger dotenv uniquement en développement
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Utiliser les variables d'environnement compatibles avec Aiven (ou Render)
const DB_HOST     = process.env.DB_HOST || process.env.MYSQL_HOST;
const DB_USER     = process.env.DB_USER || process.env.MYSQL_USER;
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD;
const DB_NAME     = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'defaultdb';
const DB_PORT     = parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || '3306', 10);
const DB_SSL_CA   = process.env.DB_SSL_CA; // chemin optionnel vers le certificat CA

// Vérifier les variables essentielles
if (!DB_HOST || !DB_USER) {
  console.error('❌ Erreur : variables DB_HOST et DB_USER doivent être définies.');
  process.exit(1);
}

// Construction des options de pool
const poolConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
};

// Gestion SSL (obligatoire pour Aiven)
if (DB_SSL_CA && fs.existsSync(DB_SSL_CA)) {
  poolConfig.ssl = { ca: fs.readFileSync(DB_SSL_CA) };
  console.log('🔒 SSL avec certificat CA');
} else if (DB_HOST !== 'localhost' && DB_HOST !== '127.0.0.1') {
  // Pour Aiven, on active SSL même sans certificat local (mais moins sécurisé)
  poolConfig.ssl = { rejectUnauthorized: false };
  console.warn('⚠️ SSL activé sans vérification du certificat');
}

const pool = mysql.createPool(poolConfig);

// Lecture du script init.sql
const readInitSql = () => {
  const initPath = path.join(__dirname, '..', 'database', 'init.sql');
  return fs.readFileSync(initPath, 'utf8');
};

const executeSqlStatements = async (connection, sql) => {
  const statements = sql
    .split(/;\s*$/gm)
    .map(stmt => stmt.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await connection.query(stmt);
  }
};

// Initialisation (création de la base si elle n'existe pas)
const initializeDatabase = async () => {
  try {
    const conn = await pool.getConnection();
    conn.release();
    console.log('✅ Base de données MySQL déjà accessible');
    return;
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') {
      console.error('❌ Erreur de connexion MySQL:', err.message);
      throw err;
    }
    console.log('⚠️ Base manquante, initialisation...');
    const initSql = readInitSql();
    const tempConn = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      port: DB_PORT,
      multipleStatements: true,
      ssl: poolConfig.ssl || undefined,
    });
    try {
      await executeSqlStatements(tempConn, initSql);
      console.log('✅ Base initialisée avec succès');
    } finally {
      await tempConn.end();
    }
  }
};

const testConnection = async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Connecté à MySQL');
    conn.release();
    return true;
  } catch (err) {
    console.error('❌ Erreur MySQL:', err.message);
    return false;
  }
};

const applyMigrations = async () => {
  try {
    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    if (files.length === 0) {
      console.log('ℹ️ Aucune migration');
      return;
    }
    const conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const file of files) {
      const [rows] = await conn.query('SELECT * FROM migrations WHERE name = ?', [file]);
      if (rows.length) {
        console.log(`⏭️ Migration déjà appliquée: ${file}`);
        continue;
      }
      console.log(`📝 Application: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const statements = sql
        .split(/;\s*$/gm)
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      await conn.query('INSERT INTO migrations (name) VALUES (?)', [file]);
      console.log(`✅ Migration ${file} appliquée`);
    }
    conn.release();
  } catch (err) {
    console.error('❌ Erreur migrations:', err.message);
  }
};

module.exports = { pool, testConnection, initializeDatabase, applyMigrations };