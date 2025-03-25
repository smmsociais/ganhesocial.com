const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Configurações
app.use(express.json());
app.use(cors());

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Conectado ao MongoDB"))
    .catch((err) => console.log("Erro ao conectar ao MongoDB", err));

// Modelo de Conta
const ContaSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    nomeConta: { type: String, required: true },
    saldo: { type: Number, required: true, default: 0 },
    historico: { type: Array, default: [] }
});
const Conta = mongoose.model("Conta", ContaSchema);

// Middleware de Autenticação
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).json({ error: "Acesso negado, token não encontrado." });
    }

    try {
        const tokenSemBearer = token.split(" ")[1];
        const decoded = jwt.verify(tokenSemBearer, process.env.JWT_SECRET);
        req.user = decoded; // Adiciona as informações do usuário à requisição
        next();
    } catch (error) {
        return res.status(400).json({ error: "Token inválido." });
    }
};

// Rotas para as Contas
app.post("/api/contas", authMiddleware, async (req, res) => {
    try {
        const { nomeConta } = req.body;
        const userId = req.user.id; // Obtém o ID do usuário autenticado

        const novaConta = new Conta({ userId, nomeConta, saldo: 0, historico: [] });
        await novaConta.save();

        res.status(201).json({ message: "Conta criada com sucesso!", conta: novaConta });
    } catch (error) {
        console.error("Erro ao criar conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

app.get("/api/contas", authMiddleware, async (req, res) => {
    try {
        const contas = await Conta.find({ userId: req.user.id });
        res.json(contas);
    } catch (error) {
        console.error("Erro ao listar contas:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

app.get("/api/contas/:id", authMiddleware, async (req, res) => {
    try {
        const conta = await Conta.findOne({ _id: req.params.id, userId: req.user.id });

        if (!conta) {
            return res.status(404).json({ error: "Conta não encontrada." });
        }

        res.json(conta);
    } catch (error) {
        console.error("Erro ao buscar conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

app.put("/api/contas/:id/saldo", authMiddleware, async (req, res) => {
    try {
        const { saldo } = req.body;

        const conta = await Conta.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { saldo },
            { new: true }
        );

        if (!conta) {
            return res.status(404).json({ error: "Conta não encontrada." });
        }

        res.json({ message: "Saldo atualizado com sucesso!", conta });
    } catch (error) {
        console.error("Erro ao atualizar saldo:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

app.delete("/api/contas/:id", authMiddleware, async (req, res) => {
    try {
        const conta = await Conta.findOneAndDelete({ _id: req.params.id, userId: req.user.id });

        if (!conta) {
            return res.status(404).json({ error: "Conta não encontrada." });
        }

        res.json({ message: "Conta excluída com sucesso!" });
    } catch (error) {
        console.error("Erro ao excluir conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Rota para login e geração de token JWT
app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    // Aqui você deve verificar o usuário na base de dados
    // Para o exemplo, vamos considerar que o usuário existe
    if (email === "usuario@exemplo.com" && password === "senha") {
        const token = jwt.sign({ id: "123456" }, process.env.JWT_SECRET, { expiresIn: '1h' });
        return res.json({ token });
    }
    res.status(400).json({ error: "Usuário ou senha inválidos." });
});

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
