import nodemailer from 'nodemailer';

export async function sendRecoveryEmail(email, link) {
  // Configuração do transporte SMTP (Outlook) com credenciais diretas
  const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com', // Servidor SMTP do Outlook
    port: 587, // Porta para TLS
    secure: false, // Usamos TLS (não SSL)
    auth: {
      user: 'contato@ganhesocial.com', // Seu email
      pass: 'reno4769!', // Sua senha de aplicativo ou senha normal
    },
  });

  const mailOptions = {
    from: '"GanheSocial" <contato@ganhesocial.com>', // Remetente
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
