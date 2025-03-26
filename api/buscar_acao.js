import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/buscar_acao", async (req, res) => {
    const { id_conta } = req.query;

    if (!id_conta) {
        return res.status(400).json({ error: "ID da conta é obrigatório." });
    }

    const url = `https://api.ganharnoinsta.com/get_action.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&id_conta=${id_conta}&is_tiktok=1&tipo=1`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === "ENCONTRADA") {
            res.json(data);
        } else {
            res.status(404).json({ error: "Nenhuma ação encontrada." });
        }
    } catch (error) {
        console.error("Erro ao buscar ação:", error);
        res.status(500).json({ error: "Erro ao buscar ação." });
    }
});

export default router;
