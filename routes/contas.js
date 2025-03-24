console.log("Arquivos no diretório:", require("fs").readdirSync("../middlewares"));
const express = require("express");
const Conta = require("../models/Conta"); // Importa o modelo de Conta
const authMiddleware = require("../middleware/auth");

const router = express.Router();

// Criar uma nova conta
router.post("/api/contas", authMiddleware, async (req, res) => {
    try {
        const { nomeConta } = req.body;
        const userId = req.user.id; // Obtém o ID do usuário autenticado

        // Criar e salvar a conta no banco de dados
        const novaConta = new Conta({ userId, nomeConta, saldo: 0, historico: [] });
        await novaConta.save();

        res.status(201).json({ message: "Conta criada com sucesso!", conta: novaConta });
    } catch (error) {
        console.error("Erro ao criar conta:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

module.exports = router;
