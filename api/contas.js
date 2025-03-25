const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Conectado ao MongoDB"))
    .catch((err) => console.log("Erro ao conectar ao MongoDB", err));

// Modelo de Usuário com Contas Embutidas
const ContaSchema = new mongoose.Schema({
    nomeConta: { type: String, required: true },
    status: { type: String, enum: ["Pendente", "Aprovada"], default: "Pendente" }
});

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { 
        type: String, 
        required: [true, "A senha é obrigatória"], 
        select: false  // Impede que a senha seja retornada automaticamente
    },
    contas: [ContaSchema]
});

const User = mongoose.model("User", UserSchema);

// Middleware de Autenticação
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: "Acesso negado, token não encontrado." });

    try {
        const decoded = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(400).json({ error: "Token inválido." });
    }
};

// Rota de Registro de Usuário
app.post("/api/register", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) return res.status(400).json({ error: "E-mail e senha são obrigatórios." });

        const userExists = await User.findOne({ email });
        if (userExists) return res.status(400).json({ error: "E-mail já cadastrado." });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, password: hashedPassword, contas: [] });
        await newUser.save();

        res.status(201).json({ message: "Usuário registrado com sucesso!" });
    } catch (error) {
        console.error("Erro no registro:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Rota de Login (Autenticação)
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: "E-mail ou senha inválidos." });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Criar Conta dentro do Usuário
app.post("/api/contas", authMiddleware, async (req, res) => {
    try {
        const { nomeConta } = req.body;
        const userId = req.user.id;

        if (!nomeConta) {
            return res.status(400).json({ error: "O nome da conta é obrigatório." });
        }

        // Verifica se a conta já existe no sistema
        const contaExistente = await User.findOne({ "contas.nomeConta": nomeConta });
        if (contaExistente) {
            return res.status(400).json({ error: "Esta conta já foi adicionada por outro usuário." });
        }

        // Busca o usuário autenticado
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        // Verifica se o usuário já tem essa conta
        const contaJaCadastrada = user.contas.find(conta => conta.nomeConta === nomeConta);
        if (contaJaCadastrada) {
            return res.status(400).json({ error: "Você já adicionou esta conta." });
        }

        // Adiciona a nova conta ao usuário
// Adiciona a nova conta ao usuário
user.contas.push({ nomeConta, status: "Pendente" });

// Salva ignorando validações globais (como a de senha)
await user.save({ validateBeforeSave: false });


        res.status(201).json({ message: "Conta adicionada com sucesso!" });

    } catch (error) {
        console.error("Erro ao adicionar conta:", error);
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});

// Listar Contas do Usuário
app.get("/api/contas", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        res.json(user.contas);
    } catch (error) {
        console.error("Erro ao listar contas:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Atualizar Status da Conta
app.put("/api/contas/:contaId", authMiddleware, async (req, res) => {
    try {
        const { status } = req.body;
        if (!["Pendente", "Aprovada"].includes(status)) {
            return res.status(400).json({ error: "Status inválido." });
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        const conta = user.contas.id(req.params.contaId);
        if (!conta) return res.status(404).json({ error: "Conta não encontrada." });

        conta.status = status;
        await user.save();

        res.json({ message: "Status atualizado!", contas: user.contas });
    } catch (error) {
        console.error("Erro ao atualizar conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Excluir Conta do Usuário
app.delete("/api/contas/:contaId", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        user.contas = user.contas.filter(conta => conta._id.toString() !== req.params.contaId);
        await user.save();

        res.json({ message: "Conta removida!", contas: user.contas });
    } catch (error) {
        console.error("Erro ao excluir conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Rota para listar todas as contas de todos os usuários
app.get("/api/todas-contas", async (req, res) => {
    try {
        const usuarios = await User.find({}, "contas"); // Busca apenas o campo "contas" de todos os usuários
        const todasAsContas = usuarios.flatMap(user => user.contas); // Une todas as contas em um único array

        res.json(todasAsContas);
    } catch (error) {
        console.error("Erro ao listar todas as contas:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Rota para vincular conta
app.post("/api/vincular_conta", authMiddleware, async (req, res) => {
    const { nomeUsuario } = req.body; // Recebe o nome do usuário a partir da requisição

    if (!nomeUsuario) {
        return res.status(400).json({ error: "Nome de usuário é obrigatório." });
    }

    const url = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nomeUsuario}`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === "success") {
            res.json({ id_conta: data.id_conta });
        } else {
            res.status(400).json({ error: "Erro ao vincular conta." });
        }
    } catch (error) {
        console.error("Erro ao vincular conta:", error);
        res.status(500).json({ error: "Erro ao vincular conta." });
    }
});

// Rota para buscar ação
app.get("/api/buscar_acao", authMiddleware, async (req, res) => {
    const { id_conta } = req.query; // Recebe o id_conta a partir da query

    if (!id_conta) {
        return res.status(400).json({ error: "ID da conta é obrigatório." });
    }

    const url = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === "ENCONTRADA") {
            res.json(data);
        } else {
            res.status(404).json({ error: "Nenhuma ação encontrada." });
        }
    } catch (error) {
        console.error("Erro ao buscar ação:", error);
        res.status(500).json({ error: "Erro ao buscar ação." });
    }
});

// Iniciar o Servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
