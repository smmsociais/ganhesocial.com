import express from "express";
import cors from "cors";
import adicionarContaExterna from "./api/adicionar-conta-externa.js";
import connectDB from "./api/db.js";

const app = express();

// 🛑 Configuração de CORS — segurança
app.use(cors({
    origin: "https://ganhesocial.com",  // ✅ Permitir só esse domínio
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));

// 🧠 Middleware para ler JSON
app.use(express.json());

// 🔗 Conectar ao banco antes de qualquer requisição
connectDB();

// 🚀 Rotas
app.use(adicionarContaExterna);

// 🔥 Teste rápido
app.get("/", (req, res) => {
    res.send("🚀 API está funcionando com CORS liberado.");
});

// 🔥 Inicializa servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
