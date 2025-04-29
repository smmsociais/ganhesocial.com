import { connectToDatabase } from '../../utils/mongodb'; // ajustar se seu caminho for diferente
import { sendRecoveryEmail } from '../../utils/mailer'; // função para enviar email
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email é obrigatório' });
  }

  try {
    const { db } = await connectToDatabase();

    // Verifica se o usuário existe
    const user = await db.collection('usuarios').findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: 'Email não encontrado' });
    }

    // Gera um token seguro
    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiration = new Date(Date.now() + 60 * 60 * 1000); // 1 hora a partir de agora

    // Atualiza o usuário com o token e expiração
    await db.collection('usuarios').updateOne(
      { _id: user._id },
      { $set: { resetPasswordToken: token, resetPasswordExpires: tokenExpiration } }
    );

    // Monta o link de recuperação
    const recoveryLink = `https://ganhesocial.com/reset-password?token=${token}`;

    // Envia o email
    await sendRecoveryEmail(email, recoveryLink);

    return res.status(200).json({ message: 'Link de recuperação enviado com sucesso' });
  } catch (error) {
    console.error('Erro em recover-password:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
