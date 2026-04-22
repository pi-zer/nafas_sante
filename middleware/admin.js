// backend/middleware/admin.js
/**
 * Middleware d'autorisation admin
 * Vérifie que l'utilisateur a le rôle 'admin'
 */
function authorizeAdmin(req, res, next) {
  // Vérifier si l'utilisateur est authentifié
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      error: 'Non authentifié',
      message: 'Vous devez être connecté'
    });
  }
  
  // Vérifier si l'utilisateur a le rôle admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false,
      error: 'Accès interdit',
      message: 'Cette action requiert les droits administrateur'
    });
  }
  
  // Si tout est OK, passer au prochain middleware
  next();
}

module.exports = authorizeAdmin;