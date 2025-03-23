require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Middleware para logar a origem da requisição (temporário)
app.use((req, res, next) => {
  console.log('Origin:', req.headers.origin);
  next();
});

// Configuração de CORS usando regex opcional para a parte extra
const corsOptions = {
  origin: /https:\/\/backend-cadastro(-[a-z0-9]+)?-renissons-projects\.vercel\.app/,
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type',
  preflightContinue: false,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

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
    console.error('Erro ao cadastrar:', error);
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
