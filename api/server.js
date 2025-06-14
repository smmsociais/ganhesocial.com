import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import buscarAcaoRouter from "./buscar_acao.js";
import adicionarContaExternaRouter from "./adicionar_conta_externa.js";
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// 🔧 Middleware de CORS
const allowedOrigins = ["https://ganhesocial.com"];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// 🔧 Middleware para JSON
app.use(express.json());

// 🔧 Servir arquivos estáticos (se tiver frontend)
app.use(express.static(path.join(__dirname, "frontend")));

// 🔧 Rota raiz (se quiser)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// 🔗 Conexão MongoDB
mongoose.connect(process.env.MONGO_URI, {
})
  .then(() => console.log("🔥 Conectado ao MongoDB!"))
  .catch((err) => console.error("❌ Erro ao conectar:", err));

// 🔗 Suas rotas
app.use("/api", buscarAcaoRouter);
app.use("/api", adicionarContaExternaRouter);

// ✅ Exporta o app
export default app;
