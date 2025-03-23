// api/cadastrar.js
require('dotenv').config();
const mongoose = require('mongoose');

// Conectar ao MongoDB (use a URL do seu MongoDB Atlas ou local)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("🔥 Conectado ao MongoDB!"))
  .catch(err => console.error("Erro ao conectar:", err));

// Criar um modelo para usuários
const UserSchema = new mongoose.Schema({
  nome: String,
  email: String,
  senha: String
});
const User = mongoose.model('User', UserSchema);

module.exports = async (req, res) => {
  // Rota para cadastro
  if (req.method === 'POST') {
    try {
      const { nome, email, senha } = req.body;
      const novoUsuario = new User({ nome, email, senha });
      await novoUsuario.save();
      return res.status(201).json({ message: 'Usuário cadastrado com sucesso!' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao cadastrar usuário' });
    }
  } else {
    return res.status(405).json({ error: 'Método não permitido' });
  }
};
