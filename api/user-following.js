import axios from "axios";

export default async function handler(req, res) {
        if (req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido." });
        }
    
        const { userId } = req.query;
    
        if (!userId) {
            return res.status(400).json({ error: "Parâmetro 'userId' é obrigatório." });
        }
    
        const userFollowingUrl = `https://cybrix-bytedance1.p.rapidapi.com/scraping/user/followings`;
    
        try {
            const response = await axios.get(userFollowingUrl, {
  headers: {
    'x-rapidapi-key':  process.env.rapidapi_key,
    'x-rapidapi-host': 'cybrix-bytedance1.p.rapidapi.com',
    'Content-Type': 'application/json'
  },
  data: {
    username: userId
                }
            });
            
            const data = response.data;
    
            if (!data || Object.keys(data).length === 0) {
                return res.status(404).json({ error: "Nenhuma informação de seguidores encontrada." });
            }
    
            res.json(data);
        } catch (error) {
            console.error("Erro ao buscar seguidores:", error);
            res.status(500).json({ error: "Erro ao buscar seguidores." });
        }
    }    
