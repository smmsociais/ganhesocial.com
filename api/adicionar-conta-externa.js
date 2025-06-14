import express from "express";
import axios from "axios";
import connectDB from './db.js';
import { User } from "./schema.js";

const router = express.Router();

const CAPMONSTER_API_KEY = "cbbe3f324b95a704eeb9a2d3aa1565b3";
const WEBSITE_URL = "https://www.ganharnasredes.com/painel/?pagina=login";
const WEBSITE_KEY = "6LeHHAoaAAAAAO8g8W16nDsmqD7sh1co6HBy_hpT";

// 🔑 Login no site externo
const EMAIL = "renissontk@gmail.com";
const SENHA = "ffffff";

// ---- Resolver o Captcha ----
async function resolverCaptcha() {
    const { data } = await axios.post("https://api.capmonster.cloud/createTask", {
        clientKey: CAPMONSTER_API_KEY,
        task: {
            type: "NoCaptchaTaskProxyless",
            websiteURL: WEBSITE_URL,
            websiteKey: WEBSITE_KEY
        }
    });

    if (data.errorId !== 0) throw new Error(`Erro criando task: ${data.errorDescription}`);
    const taskId = data.taskId;

    while (true) {
        const { data: res } = await axios.post("https://api.capmonster.cloud/getTaskResult", {
            clientKey: CAPMONSTER_API_KEY,
            taskId
        });

        if (res.errorId !== 0) throw new Error(`Erro no captcha: ${res.errorDescription}`);
        if (res.status === "ready") return res.solution.gRecaptchaResponse;
        await new Promise(r => setTimeout(r, 5000));
    }
}

// ---- Login no site externo ----
async function loginSiteExterno() {
    const captchaToken = await resolverCaptcha();

    const formData = new URLSearchParams();
    formData.append("email", EMAIL);
    formData.append("senha", SENHA);
    formData.append("g-recaptcha-response", captchaToken);

    const response = await axios.post(
        "https://www.ganharnasredes.com/painel/",
        formData.toString(),
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0",
                Referer: WEBSITE_URL,
            },
            maxRedirects: 0,
            validateStatus: status => status < 500,
        }
    );

    const cookies = response.headers["set-cookie"];
    if (!cookies) throw new Error("Falha no login externo");

    return cookies;
}

// ---- Adicionar conta no site externo ----
async function adicionarContaSiteExterno(cookies, nomeConta) {
    const formData = new URLSearchParams();
    formData.append("rede_social", "tiktok");
    formData.append("nome_usuario", nomeConta);
    formData.append("sexo", "1"); // opcional
    formData.append("estado", "SP"); // opcional

    const response = await axios.post(
        "https://www.ganharnasredes.com/painel/?pagina=adicionar_conta&action=informar_dados",
        formData.toString(),
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0",
                Cookie: cookies.join("; "),
                Referer: "https://www.ganharnasredes.com/painel/?pagina=adicionar_conta&action=informar_dados"
            }
        }
    );

    if (response.status !== 200) {
        throw new Error("Erro ao adicionar conta no site externo");
    }
}

// ---- Rota API ----
router.post("/api/adicionar-conta-externa", async (req, res) => {
    const { nomeConta, token } = req.body;

    if (!nomeConta || !token) {
        return res.status(400).json({ error: "Nome da conta e token são obrigatórios." });
    }

    try {
        await connectDB();
        const user = await User.findOne({ token });

        if (!user) {
            return res.status(401).json({ error: "Token inválido" });
        }

        const cookies = await loginSiteExterno();
        await adicionarContaSiteExterno(cookies, nomeConta);

        return res.json({ success: true, message: `Conta ${nomeConta} adicionada no site externo.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

export default router;
