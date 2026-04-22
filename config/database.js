// backend/config/database.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'nafassante';

// Options de connexion avec rafraîchissement forcé des métadonnées
const poolConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,        // Force le rafraîchissement des métadonnées
  enablePrepare: false,     // Désactive le cache des requêtes préparées
};

const pool = mysql.createPool(poolConfig);

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
    
    // Créer le répertoire migrations s'il n'existe pas
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

    // Créer la table de suivi des migrations si elle n'existe pas
    await connection.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Appliquer les migrations non appliquées
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

      // Enregistrer la migration comme appliquée
      await connection.query(
        'INSERT INTO migrations (name) VALUES (?)',
        [file]
      );

      console.log(`✅ Migration appliquée: ${file}`);
    }

    connection.release();
  } catch (error) {
    console.error('❌ Erreur lors de l\'application des migrations:', error.message);
    // Ne pas bloquer le démarrage du serveur en cas d'erreur de migration
    console.warn('⚠️ Continuant malgré l\'erreur de migration...');
  }
};

module.exports = { pool, testConnection, initializeDatabase, applyMigrations };