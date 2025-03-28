import express from "express";
import jwt from "jsonwebtoken";
import User from "./User.js";  // Apenas importe o modelo User, sem redefinir
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";  // Adicionando bcryptjs para o hash de senha

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Conexão com o MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Conectado ao MongoDB"))
    .catch((err) => console.log("Erro ao conectar ao MongoDB", err));

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
        const { nomeConta, id_conta, id_tiktok, s } = req.body;
        const userId = req.user.id;

        if (!nomeConta || !id_conta) {
            return res.status(400).json({ error: "O nome da conta e o id_conta são obrigatórios." });
        }

        // Verifica se a conta já existe no banco de dados do usuário
        const contaExistente = await User.findOne({ "contas.id_conta": id_conta });
        if (contaExistente) {
            return res.status(400).json({ error: "Esta conta já foi adicionada." });
        }

        // Busca o usuário autenticado
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

        // Verifica se a conta já foi adicionada
        const contaJaCadastrada = user.contas.find(conta => conta.id_conta === id_conta);
        if (contaJaCadastrada) {
            return res.status(400).json({ error: "Esta conta já foi adicionada por você." });
        }

        // Adiciona a nova conta ao usuário
        user.contas.push({ nomeConta, id_conta, id_tiktok, s, status: "Pendente" });
        await user.save();

        res.status(201).json({
            message: "Conta adicionada com sucesso!",
            id_conta,
            detalhes: {
                status: "Pendente",
                id_conta,
                id_tiktok,
                s,
            },
        });
    } catch (error) {
        console.error("Erro ao adicionar conta:", error);
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});

// Listar Contas do Usuário
app.get("/api/contas", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        res.json(user.contas);
    } catch (error) {
        res.status(500).json({ error: "Erro ao carregar contas." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
