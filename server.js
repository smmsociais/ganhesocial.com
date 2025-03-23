require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Configuração de CORS: Atualize o valor de 'origin' com a URL do seu frontend correto
const corsOptions = {
  origin: 'https://backend-cadastro-58ec3sacy-renissons-projects.vercel.app/', // Certifique-se de que essa URL seja a do seu frontend em produção
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type',
  preflightContinue: false,
  optionsSuccessStatus: 200 // Para algumas versões antigas do navegador
};

app.use(cors(corsOptions)); // Aplica a configuração de CORS a todas as rotas

app.use(bodyParser.json());

// Conectar ao MongoDB
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

// Rota para cadastro
app.post('/api/cadastrar', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    const novoUsuario = new User({ nome, email, senha });
    await novoUsuario.save();
    res.status(201).json({ message: 'Usuário cadastrado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
