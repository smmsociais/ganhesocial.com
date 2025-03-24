const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const authRoutes = require("./routes/auth"); // Rotas de autenticação
const contasRoutes = require("./routes/contas"); // Rotas de contas

const app = express();
app.use(express.json());
app.use(cors());

app.use(authRoutes);
app.use(contasRoutes);

mongoose.connect("mongodb+srv://renisson:renisson@cluster0.1iy44.mongodb.net/ganhesocial?retryWrites=true&w=majority&appName=Cluster0", {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB conectado"))
  .catch(err => console.error("Erro ao conectar no MongoDB:", err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
