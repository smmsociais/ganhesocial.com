const auth = require("../middleware/auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  auth(req, res, () => {
    res.json({ message: "Acesso autorizado!", user: req.user });
  });
};
