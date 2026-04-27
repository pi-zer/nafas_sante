// backend/config/database.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

// ⚠️ Pour Railway : on utilise UNIQUEMENT les variables d'environnement fournies
// Ne pas mettre de valeurs par défaut (localhost, root…) qui cassent le déploiement
const DB_HOST     = process.env.MYSQL_HOST     || process.env.DB_HOST;
const DB_USER     = process.env.MYSQL_USER     || process.env.DB_USER;
const DB_PASSWORD = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD;
const DB_NAME     = process.env.MYSQL_DATABASE || process.env.DB_NAME;
const DB_PORT     = process.env.MYSQL_PORT     || process.env.DB_PORT || 3306;

// Vérification : si les variables obligatoires sont absentes, on bloque le démarrage
if (!DB_HOST || !DB_USER || !DB_NAME) {
  console.error('❌ Erreur de configuration : variables de connexion MySQL manquantes.');
  console.error('   Vérifiez que MYSQL_HOST, MYSQL_USER et MYSQL_DATABASE sont définies.');
  process.exit(1);
}

// Options de connexion
const poolConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: parseInt(DB_PORT, 10),
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
  enablePrepare: false,
  // Désactiver la vérification SSL pour les connexions internes Railway
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
};

const pool = mysql.createPool(poolConfig);

// Lecture du script d'initialisation (si besoin)
const readInitSql = () => {
  const initPath = path.join(__dirname, '..', 'database', 'init.sql');
  return fs.readFileSync(initPath, 'utf8');
};

const executeSqlStatements = async (connection, sql) => {
  const statements = sql
    .split(/;\s*$/gm)
    .map((stmt) => stmt.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await connection.query(statement);
  }
};

// Initialisation de la base (création si absente)
const initializeDatabase = async () => {
  try {
    const testConn = await pool.getConnection();
    testConn.release();
    console.log('✅ Base de données MySQL déjà accessible');
    return;
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') {
      console.error('❌ Erreur de connexion MySQL:', err.message);
      throw err;
    }
    console.log('⚠️ Base de données manquante : initialisation en cours...');
    const initSql = readInitSql();
    const connection = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      port: DB_PORT,
      multipleStatements: true,
    });
    try {
      await executeSqlStatements(connection, initSql);
      console.log('✅ Base de données initialisée avec succès');
    } finally {
      await connection.end();
    }
  }
};

const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connecté à la base de données MySQL');
    connection.release();
    return true;
  } catch (err) {
    console.error('❌ Erreur de connexion MySQL:', err.message);
    return false;
  }
};

const applyMigrations = async () => {
  try {
    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    if (migrationFiles.length === 0) {
      console.log('ℹ️ Aucune migration à appliquer');
      return;
    }
    const connection = await pool.getConnection();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const file of migrationFiles) {
      const [rows] = await connection.query(
        'SELECT * FROM migrations WHERE name = ?',
        [file]
      );
      if (rows.length > 0) {
        console.log(`⏭️ Migration déjà appliquée: ${file}`);
        continue;
      }
      console.log(`📝 Application de la migration: ${file}`);
      const migrationSql = fs.readFileSync(
        path.join(migrationsDir, file),
        'utf8'
      );
      const statements = migrationSql
        .split(/;\s*$/gm)
        .map((stmt) => stmt.trim())
        .filter(stmt => stmt && !stmt.startsWith('--'));
      for (const statement of statements) {
        await connection.query(statement);
      }
      await connection.query(
        'INSERT INTO migrations (name) VALUES (?)',
        [file]
      );
      console.log(`✅ Migration appliquée: ${file}`);
    }
    connection.release();
  } catch (error) {
    console.error('❌ Erreur lors de l\'application des migrations:', error.message);
    console.warn('⚠️ Continuant malgré l\'erreur de migration...');
  }
};

module.exports = { pool, testConnection, initializeDatabase, applyMigrations };