const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const bcrypt = require("bcrypt");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Conectado ao MongoDB"))
    .catch((err) => console.log("Erro ao conectar ao MongoDB", err));

// Modelo de Usuário
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model("User", UserSchema);

// Modelo de Conta
const ContaSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    nomeConta: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    historico: { type: Array, default: [] }
});
const Conta = mongoose.model("Conta", ContaSchema);

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
        const newUser = new User({ email, password: hashedPassword });
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

// Criar Conta Bancária
app.post("/api/contas", authMiddleware, async (req, res) => {
    try {
        const { nomeConta } = req.body;
        if (!nomeConta) return res.status(400).json({ error: "O nome da conta é obrigatório." });

        const novaConta = new Conta({ userId: req.user.id, nomeConta });
        await novaConta.save();

        res.status(201).json({ message: "Conta criada com sucesso!", conta: novaConta });
    } catch (error) {
        console.error("Erro ao criar conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Listar Contas do Usuário
app.get("/api/contas", authMiddleware, async (req, res) => {
    try {
        const contas = await Conta.find({ userId: req.user.id });
        res.json(contas);
    } catch (error) {
        console.error("Erro ao listar contas:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Buscar Conta Específica
app.get("/api/contas/:id", authMiddleware, async (req, res) => {
    try {
        const conta = await Conta.findOne({ _id: req.params.id, userId: req.user.id });
        if (!conta) return res.status(404).json({ error: "Conta não encontrada." });

        res.json(conta);
    } catch (error) {
        console.error("Erro ao buscar conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Atualizar Saldo da Conta (Depósito ou Saque)
app.put("/api/contas/:id/saldo", authMiddleware, async (req, res) => {
    try {
        const { valor } = req.body;
        if (typeof valor !== "number") return res.status(400).json({ error: "O valor deve ser um número." });

        const conta = await Conta.findOne({ _id: req.params.id, userId: req.user.id });
        if (!conta) return res.status(404).json({ error: "Conta não encontrada." });

        conta.saldo += valor; // Atualiza o saldo
        conta.historico.push({ tipo: valor > 0 ? "Depósito" : "Saque", valor, data: new Date() });
        await conta.save();

        res.json({ message: "Saldo atualizado!", conta });
    } catch (error) {
        console.error("Erro ao atualizar saldo:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Excluir Conta Bancária
app.delete("/api/contas/:id", authMiddleware, async (req, res) => {
    try {
        const conta = await Conta.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        if (!conta) return res.status(404).json({ error: "Conta não encontrada." });

        res.json({ message: "Conta excluída com sucesso!" });
    } catch (error) {
        console.error("Erro ao excluir conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Iniciar o Servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
