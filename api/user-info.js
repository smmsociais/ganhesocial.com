import express from "express";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

router.get("/user-info", async (req, res) => {
    const { unique_id } = req.query;

    if (!unique_id) {
        return res.status(400).json({ error: "Parâmetro 'unique_id' é obrigatório" });
    }

    try {
        const response = await fetch(`https://tiktok-scraper7.p.rapidapi.com/user/info?unique_id=${unique_id}`, {
            method: "GET",
            headers: {
                "x-rapidapi-key": process.env.RAPIDAPI_KEY,
                "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com",
            },
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Erro ao buscar dados do TikTok:", error);
        res.status(500).json({ error: "Erro ao buscar dados do TikTok" });
    }
});

export default router;
