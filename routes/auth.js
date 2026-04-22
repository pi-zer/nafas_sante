// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');

// ==================== INSCRIPTION ====================
router.post('/register', async (req, res) => {
  console.log('📝 ========== NOUVELLE INSCRIPTION ==========');
  console.log('📝 Données brutes reçues:', JSON.stringify(req.body, null, 2));
  
  try {
    const { email, password, fullName, username, phone, region, role, centerName } = req.body;
    
    if (!email) return res.status(400).json({ error: 'Email requis' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    if (!fullName) return res.status(400).json({ error: 'Nom complet requis' });
    
    // Préparer les données avec les bons noms de colonnes
    const finalUsername = (username || email.split('@')[0] || 'user').trim();
    const finalEmail = email.trim().toLowerCase();
    const finalFullName = fullName.trim();
    const finalPhone = phone ? phone.trim() : null;
    const finalRegion = region ? region.trim() : null;
    const finalRole = (role === 'admin' ? 'admin' : 'agent');
    
    console.log('📝 Données préparées:', {
      username: finalUsername,
      email: finalEmail,
      full_name: finalFullName,
      phone: finalPhone,
      region: finalRegion,
      role: finalRole
    });
    
    // Vérifier si l'utilisateur existe déjà
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [finalEmail, finalUsername]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Cet email ou nom d\'utilisateur est déjà utilisé' });
    }
    
    // Hasher le mot de passe
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Insertion avec les colonnes correctes
    const [result] = await pool.query(
      `INSERT INTO users (username, password, email, full_name, phone, region, role, active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [finalUsername, hashedPassword, finalEmail, finalFullName, finalPhone, finalRegion, finalRole]
    );
    
    console.log('✅ Utilisateur créé avec succès, ID:', result.insertId);
    
    // Créer le token
    const token = jwt.sign(
      { id: result.insertId, email: finalEmail, role: finalRole },
      process.env.JWT_SECRET || 'nafassante_secret_key_2024',
      { expiresIn: '7d' }
    );
    
    const refreshToken = jwt.sign(
      { id: result.insertId },
      process.env.JWT_REFRESH_SECRET || 'nafassante_refresh_secret_key_2024',
      { expiresIn: '30d' }
    );
    
    res.status(201).json({
      success: true,
      token,
      refreshToken,
      user: {
        id: result.insertId,
        username: finalUsername,
        email: finalEmail,
        full_name: finalFullName,
        role: finalRole,
        region: finalRegion,
        phone: finalPhone,
        centerName: centerName || null
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur inscription:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur lors de l\'inscription',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== CONNEXION ====================
router.post('/login', async (req, res) => {
  console.log('📝 Tentative de connexion:', { email: req.body.email });
  
  const { email, password } = req.body;
  const finalEmail = email?.trim().toLowerCase();

  if (!finalEmail || !password) {
    return res.status(400).json({ 
      success: false,
      error: 'Email et mot de passe requis' 
    });
  }

  try {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [finalEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: 'Email ou mot de passe incorrect' 
      });
    }

    const user = users[0];

    if (!user.active) {
      return res.status(401).json({ 
        success: false,
        error: 'Compte désactivé. Contactez l\'administrateur.' 
      });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ 
        success: false,
        error: 'Email ou mot de passe incorrect' 
      });
    }

    console.log('✅ Connexion réussie pour:', finalEmail);

    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'nafassante_secret_key_2024',
      { expiresIn: '7d' }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET || 'nafassante_refresh_secret_key_2024',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        region: user.region,
        phone: user.phone,
        photo: user.photo
      }
    });

  } catch (error) {
    console.error('❌ Erreur login:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur lors de la connexion' 
    });
  }
});

// ==================== RAFRAÎCHIR LE TOKEN ====================
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ 
      success: false,
      error: 'Refresh token requis' 
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'nafassante_refresh_secret_key_2024');
    
    const [users] = await pool.query(
      'SELECT id, email, role FROM users WHERE id = ? AND active = 1',
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: 'Utilisateur non trouvé ou inactif' 
      });
    }

    const user = users[0];
    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'nafassante_secret_key_2024',
      { expiresIn: '7d' }
    );

    res.json({ 
      success: true,
      token: newToken 
    });
  } catch (error) {
    console.error('❌ Erreur refresh token:', error);
    res.status(401).json({ 
      success: false,
      error: 'Refresh token invalide ou expiré' 
    });
  }
});

// ==================== CHANGER LE MOT DE PASSE ====================
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ 
      success: false,
      error: 'Non authentifié' 
    });
  }

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ 
      success: false,
      error: 'Mot de passe actuel requis et nouveau mot de passe doit faire au moins 6 caractères' 
    });
  }

  try {
    const [users] = await pool.query(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Utilisateur non trouvé' 
      });
    }

    const validPassword = await bcrypt.compare(currentPassword, users[0].password);
    if (!validPassword) {
      return res.status(401).json({ 
        success: false,
        error: 'Mot de passe actuel incorrect' 
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, userId]
    );

    res.json({ 
      success: true, 
      message: 'Mot de passe modifié avec succès' 
    });
  } catch (error) {
    console.error('❌ Erreur changement mot de passe:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur' 
    });
  }
});

// ==================== DÉCONNEXION ====================
router.post('/logout', async (req, res) => {
  res.json({ 
    success: true, 
    message: 'Déconnexion réussie' 
  });
});

// ==================== MOT DE PASSE OUBLIÉ ====================
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const finalEmail = email?.trim().toLowerCase();

  if (!finalEmail) {
    return res.status(400).json({ 
      success: false,
      error: 'Email requis' 
    });
  }

  try {
    const [users] = await pool.query(
      'SELECT id, full_name FROM users WHERE email = ? AND active = 1',
      [finalEmail]
    );

    if (users.length === 0) {
      return res.json({ 
        success: true, 
        message: 'Si cet email existe, un lien de réinitialisation vous a été envoyé' 
      });
    }

    const user = users[0];
    const resetToken = jwt.sign(
      { id: user.id },
      process.env.JWT_RESET_SECRET || 'nafassante_reset_secret_key_2024',
      { expiresIn: '1h' }
    );

    console.log(`🔐 Lien de réinitialisation pour ${user.full_name}: /reset-password?token=${resetToken}`);

    res.json({ 
      success: true, 
      message: 'Si cet email existe, un lien de réinitialisation vous a été envoyé',
      ...(process.env.NODE_ENV === 'development' && { resetToken })
    });
  } catch (error) {
    console.error('❌ Erreur forgot password:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur' 
    });
  }
});

// ==================== RÉINITIALISER LE MOT DE PASSE ====================
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ 
      success: false,
      error: 'Token et nouveau mot de passe requis (min 6 caractères)' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_RESET_SECRET || 'nafassante_reset_secret_key_2024');
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, decoded.id]
    );

    res.json({ 
      success: true, 
      message: 'Mot de passe réinitialisé avec succès' 
    });
  } catch (error) {
    console.error('❌ Erreur reset password:', error);
    res.status(400).json({ 
      success: false,
      error: 'Token invalide ou expiré' 
    });
  }
});

// ==================== DIAGNOSTIC ====================
router.get('/diagnostic', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [activeUsers] = await pool.query('SELECT COUNT(*) as count FROM users WHERE active = 1');
    
    res.json({
      success: true,
      message: 'Auth routes fonctionnent',
      usersCount: users[0]?.count || 0,
      activeUsers: activeUsers[0]?.count || 0,
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur serveur' 
    });
  }
});

// ==================== TEST ROUTE ====================
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Auth route fonctionne',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;