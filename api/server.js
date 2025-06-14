import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";

import buscarAcaoRouter from "./buscar_acao.js";
import adicionarContaExterna from "./adicionar-conta-externa.js"; // ✅ Importa sua nova rota
import { User } from "./schema.js"; // ✅ Usa o schema centralizado

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// ✅ Middleware CORS bem configurado
const allowedOrigins = ["https://ganhesocial.com", "https://api.ganhesocial.com"];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// ✅ Middleware JSON
app.use(express.json());

// ✅ Servir arquivos estáticos da pasta frontend
app.use(express.static(path.join(__dirname, "frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// ✅ Conectar MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("🔥 Conectado ao MongoDB!"))
.catch(err => console.error("❌ Erro ao conectar no MongoDB:", err));

// ✅ Rota de cadastro simples (exemplo)
app.post("/api/cadastrar", async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: "Todos os campos são obrigatórios!" });
    }

    const usuarioExistente = await User.findOne({ email });
    if (usuarioExistente) {
      return res.status(400).json({ error: "Usuário já cadastrado!" });
    }

    const novoUsuario = new User({ nome, email, senha });
    await novoUsuario.save();

    res.status(201).json({ message: "Usuário cadastrado com sucesso!" });
  } catch (error) {
    console.error("❌ Erro ao cadastrar:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ✅ Importar suas rotas
app.use("/api", buscarAcaoRouter);
app.use("/api", adicionarContaExterna); // ✅ Nova rota externa adicionada

// ✅ Exportar app para usar no server.js ou Railway
export default app;
