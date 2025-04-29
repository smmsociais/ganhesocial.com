import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

export async function sendRecoveryEmail(email, link) {
  // Configuração do transporte SMTP (Outlook)
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST, // smtp.office365.com
    port: process.env.MAIL_PORT, // 587
    secure: false, // Usamos TLS
    auth: {
      user: process.env.MAIL_USER, // contato@ganhesocial.com
      pass: process.env.MAIL_PASS, // senha do email
    },
  });

  const mailOptions = {
    from: `"${process.env.MAIL_NAME}" <${process.env.MAIL_FROM}>`, // Remetente
    to: email, // Destinatário
    subject: 'Recuperação de Senha', // Assunto do email
    html: `
      <p>Você solicitou a recuperação de senha.</p>
      <p>Clique no link abaixo para redefinir sua senha:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Se você não solicitou essa recuperação, ignore este email.</p>
    `, // Corpo do email em HTML
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Link de recuperação enviado para ${email}`);
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    throw new Error('Erro ao enviar email de recuperação');
  }
}
