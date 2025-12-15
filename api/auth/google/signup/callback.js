// api/auth/google/signup/callback.js
import axios from "axios";
import connectDB from "../../../db.js";
import { User } from "../../../schema.js";
import crypto from "crypto";

const FRONTEND_BASE = process.env.FRONTEND_URL || "https://ganhesocial.com";

// 🔥 Função de registro do usuário Google
async function registrarUsuarioGoogle({ email, nome, ref }) {
  const token = crypto.randomBytes(32).toString("hex");
  const gerarCodigo = () =>
    Math.floor(10000000 + Math.random() * 90000000).toString();

  let savedUser = null;
  let attempt = 0;

  while (attempt < 5 && !savedUser) {
    const codigo_afiliado = gerarCodigo();
    const ativo_ate = new Date(Date.now() + 30 * 86400000);

const payload = {
  email, nome, senha: "", token, codigo_afiliado, status: "ativo",
  ativo_ate, indicado_por: ref || null, provider: "google", historico_acoes: []
};
console.log("DEBUG: payload para new User:", JSON.stringify(payload));

// dentro do seu loop de tentativa, no lugar do `new User(...).save()`
const novoObj = {
  email,
  nome,
  senha: "",
  token,
  codigo_afiliado,
  status: "ativo",
  ativo_ate,
  indicado_por: ref || null,
  provider: "google",
  historico_acoes: [] // força array limpa
};

try {
  // tenta pelo Model (validação Mongoose)
  savedUser = await new User(novoObj).save();
} catch (err) {
  // se for conflito de unique -> re-tentaremos o loop externo
  if (err?.code === 11000) {
    attempt++;
    continue;
  }

  console.error("⚠️ Erro ao salvar via Mongoose, tentando fallback raw insert:", err?.message || err);

  try {
    // fallback: insere diretamente na collection (pula validação de schema)
    const usersColl = mongoose.connection.db.collection("users");
    const ins = await usersColl.insertOne(novoObj);
    // recupera via Model para ter os métodos e aplicar virtuals/populates se precisar
    savedUser = await User.findById(ins.insertedId).lean();
    // se quiser um documento Mongoose (não-lean), use:
    // savedUser = await User.findById(ins.insertedId);
  } catch (insErr) {
    console.error("❌ Erro no raw insert fallback:", insErr);
    throw insErr; // propaga para o outer catch (ou você pode tratar)
  }
}

  }

  if (!savedUser) {
    return { erro: true, mensagem: "Erro ao gerar código afiliado." };
  }

  return { erro: false, usuario: savedUser };
}

export default async function handler(req, res) {
  try {
    await connectDB();

    // ===============================================================
    // 1) LOGIN GOOGLE – FLUXO POST (credential / One Tap)
    // ===============================================================
    if (req.method === "POST") {
      const { credential, ref } = req.body;

      if (!credential) {
        return res.status(400).json({ success: false, error: "credential ausente" });
      }

      // Validar token
      const { data: info } = await axios.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
      );

      const { email, name } = info;

      // Verifica se já existe
      let user = await User.findOne({ email });

      if (!user) {
        // Criar usuário seguindo o mesmo padrão do signup normal
        const result = await registrarUsuarioGoogle({ email, nome: name, ref });

        if (result.erro) {
          return res.status(403).json({ error: result.mensagem });
        }

        user = result.usuario;
      }

      // retorna o token salvo no próprio usuário (como no signup normal)
      return res.status(200).json({
        success: true,
        token: user.token,
        codigo_afiliado: user.codigo_afiliado,
        id: user._id,
      });
    }

    // ===============================================================
    // 2) LOGIN GOOGLE – FLUXO GET (OAuth Redirect)
    // ===============================================================
    if (req.method === "GET") {
      const code = req.query.code;
      const ref = req.query.ref || null;

      if (!code) {
        return res.status(400).json({ error: "Código não fornecido." });
      }

      // Troca code -> token
      const { data: tokenData } = await axios.post(
        "https://oauth2.googleapis.com/token",
        {
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI_SIGNUP,
          grant_type: "authorization_code",
        }
      );

      const googleAccessToken = tokenData.access_token;

      // Obter dados do usuário Google
      const { data: googleUser } = await axios.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
      );

      const { email, name } = googleUser;

      let user = await User.findOne({ email });

      if (!user) {
        const result = await registrarUsuarioGoogle({ email, nome: name, ref });

        if (result.erro) {
          return res.status(403).send(result.mensagem);
        }

        user = result.usuario;
      }

      // Redireciona igual ao signup normal
      return res.redirect(`${FRONTEND_BASE}/login-success?token=${user.token}`);
    }

    // Método não permitido
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end("Method Not Allowed");

  } catch (err) {
    console.error("Erro em signup/callback:", err?.response?.data || err);
    return res.status(500).json({ success: false, error: "Erro interno" });
  }
}
