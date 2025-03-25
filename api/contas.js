const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const bcrypt = require("bcryptjs");

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
    password: { type: String, required: true },
    contas: [ContaSchema]  // Contas armazenadas dentro do usuário
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
        if (!nomeConta) return res.status(400).json({ error: "O nome da conta é obrigatório." });

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        const novaConta = { nomeConta, status: "Pendente" };
        user.contas.push(novaConta);

        // 🔥 Corrigindo erro de validação do password
        await user.save({ validateBeforeSave: false });

        res.status(201).json({ message: "Conta adicionada!", contas: user.contas });
    } catch (error) {
        console.error("Erro ao criar conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
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

// Iniciar o Servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
