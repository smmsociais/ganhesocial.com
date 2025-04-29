import nodemailer from 'nodemailer';

export async function sendRecoveryEmail(email, link) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USER,  // Usa a variável de ambiente
      pass: process.env.MAIL_PASS,  // Usa a variável de ambiente
    },
  });

  const mailOptions = {
    from: '"Ganhê Social" <no-reply@ganhesocial.com>',
    to: email,
    subject: 'Recuperação de Senha',
    html: `
      <p>Você solicitou a recuperação de senha.</p>
      <p>Clique no link abaixo para redefinir sua senha:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Se você não solicitou essa recuperação, ignore este email.</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Link de recuperação enviado para ${email}`);
  } catch (error) {
    console.error('Erro ao enviar email:', error);
    throw new Error('Erro ao enviar email de recuperação');
  }
}
