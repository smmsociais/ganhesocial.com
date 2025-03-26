const axios = require("axios");

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    const { nomeUsuario } = req.body;

    if (!nomeUsuario) {
        return res.status(400).json({ error: "Nome de usuário é obrigatório." });
    }

    const url = `http://api.ganharnoinsta.com/bind_tk.php?token=afc012ec-a318-433d-b3c0-5bf07cd29430&sha1=e5990261605cd152f26c7919192d4cd6f6e22227&nome_usuario=${nomeUsuario}`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === "success") {
            return res.status(200).json({ id_conta: data.id_conta });
        } else {
            return res.status(400).json({ error: "Erro ao vincular conta." });
        }
    } catch (error) {
        console.error("Erro ao vincular conta:", error);
        return res.status(500).json({ error: "Erro interno ao vincular conta." });
    }
}
