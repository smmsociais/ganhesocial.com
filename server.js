require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Configuração de CORS com origem dinâmica
const corsOptions = (req, callback) => {
  const allowedOrigin = req.headers.origin;  // Pegando a origem da requisição

  // A configuração de CORS permite qualquer origem que envie a requisição, ou você pode adicionar restrições específicas
  if (allowedOrigin) {
    callback(null, { origin: allowedOrigin });
  } else {
    callback(new Error('CORS Error'), { origin: false });
  }
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
