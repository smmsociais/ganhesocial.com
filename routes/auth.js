// routes/auth.js
const express = require('express');
const router = express.Router();

// Rota de exemplo de autenticação
router.get('/', (req, res) => {
  res.send("Auth route is working!");
});

module.exports = router;
