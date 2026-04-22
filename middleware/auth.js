// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

function authenticateToken(req, res, next) {
  // Ignorer l'authentification pour la route de logout
  if (req.path === '/logout') {
    console.log('🔓 [AUTH] Route logout ignorée, passage sans authentification');
    return next();
  }

  console.log('🔐 [AUTH] Vérification token...');

  // Récupère le header Authorization (gère les deux cas: Authorization ou authorization)
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  
  if (!authHeader) {
    console.log('❌ [AUTH] Token manquant (header absent)');
    return res.status(401).json({
      error: 'Accès non autorisé',
      message: 'Token manquant dans l’en-tête Authorization'
    });
  }

  // Vérifie le format "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    console.log('❌ [AUTH] Format de token invalide');
    return res.status(401).json({
      error: 'Accès non autorisé',
      message: 'Format de token invalide, attendu "Bearer <token>"'
    });
  }

  const token = parts[1];

  // Vérifie le token
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ [AUTH] Token valide pour user:', user.id);
    req.user = user;
    next();
  } catch (err) {
    console.log('❌ [AUTH] Token invalide:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({
        error: 'Session expirée',
        message: 'Veuillez vous reconnecter'
      });
    }
    return res.status(403).json({
      error: 'Token invalide',
      message: 'Authentification échouée'
    });
  }
}

module.exports = authenticateToken;