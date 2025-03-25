const express = require("express");
const Conta = require("../models/Conta"); // Importa o modelo de Conta
const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).json({ error: "Acesso negado, token não encontrado." });
    }

    try {
        const tokenSemBearer = token.split(" ")[1]; // Remover "Bearer "
        const decoded = jwt.verify(tokenSemBearer, process.env.JWT_SECRET);
        req.user = decoded; // Adiciona as informações do usuário na requisição
        next();
    } catch (error) {
        return res.status(400).json({ error: "Token inválido." });
    }
};

// Criar uma nova conta
router.post("/", authMiddleware, async (req, res) => {
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

// Listar todas as contas do usuário autenticado
router.get("/", authMiddleware, async (req, res) => {
    try {
        const contas = await Conta.find({ userId: req.user.id });
        res.json(contas);
    } catch (error) {
        console.error("Erro ao listar contas:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Buscar uma conta específica do usuário
router.get("/:id", authMiddleware, async (req, res) => {
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

// Atualizar saldo de uma conta
router.put("/:id/saldo", authMiddleware, async (req, res) => {
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

// Excluir uma conta
router.delete("/:id", authMiddleware, async (req, res) => {
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

module.exports = router;
