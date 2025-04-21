export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Método não permitido' });
  }

  const githubToken = process.env.GITHUB_TOKEN; // Defina isso nas variáveis de ambiente da Vercel

  try {
    const response = await fetch('https://api.github.com/repos/GanheSocial/ganhesocial.com/dispatches', {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({ event_type: 'verificar-acoes' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ message: 'Erro ao disparar workflow', details: errorText });
    }

    return res.status(200).json({ message: 'Workflow disparado com sucesso' });
  } catch (error) {
    return res.status(500).json({ message: 'Erro interno', error: error.message });
  }
}
