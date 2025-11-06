// =======================================================
// 🤖 Asistente Virtual MiQR - Servidor multiusuario (Railway compatible)
// =======================================================
import express from "express";
import wppconnect from "@wppconnect-team/wppconnect";
import fs from "fs";
import cors from "cors";
import chromium from "@sparticuz/chromium"; // ✅ Chromium liviano para Railway

const app = express();
const PORT = process.env.PORT || 3000;

// =======================================================
// 🌐 Configuración general
// =======================================================
app.use(cors());
app.use(express.static("public"));

// =======================================================
// 📲 Endpoint para crear/ver QR de un restaurante
// =======================================================
app.get("/api/asistente/:idRestaurante", async (req, res) => {
  const id = req.params.idRestaurante;
  const pathTokens = `./bots/${id}`;

  // 🗂️ Crear carpeta para tokens si no existe
  if (!fs.existsSync(pathTokens)) fs.mkdirSync(pathTokens, { recursive: true });

  console.log(`🚀 Iniciando asistente para restaurante: ${id}`);

  try {
    // 🧠 Obtener el ejecutable de Chromium para Railway
    const browserPath = await chromium.executablePath();
    if (!browserPath) {
      throw new Error("No se pudo obtener el path de Chromium en Railway.");
    }

    // ⚙️ Crear sesión WPPConnect con Chromium liviano
    wppconnect
      .create({
        session: id,
        headless: true,
        pathNameToken: pathTokens,
        executablePath: browserPath, // ✅ Usa el Chromium de @sparticuz
        browserArgs: [
          ...chromium.args,
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
          "--no-zygote",
        ],
        disableWelcome: true,
        catchQR: (base64Qr) => {
          console.log(`📱 QR generado para ${id}`);
          res.json({ estado: "qr", qr: base64Qr });
        },
        statusFind: (status) => {
          console.log(`📶 [${id}] Estado: ${status}`);
        },
      })
      .then((client) => iniciarBot(client, id))
      .catch((err) => {
        console.error(`❌ Error creando bot ${id}:`, err);
        res.status(500).json({ estado: "error", error: err.message });
      });
  } catch (err) {
    console.error("❌ Error general en el asistente:", err);
    res.status(500).json({ estado: "error", error: err.message });
  }
});

// =======================================================
// 🧠 Lógica principal del bot
// =======================================================
function iniciarBot(client, id) {
  console.log(`✅ Bot iniciado correctamente para restaurante ${id}`);

  client.onMessage(async (message) => {
    try {
      if (message.isGroupMsg || message.fromMe) return;

      const texto = (message.body || "").toLowerCase();

      if (texto.includes("hola")) {
        await client.sendText(message.from, `👋 Hola! Soy el asistente de ${id}.`);
      } else if (texto.includes("facturó") || texto.includes("facturo")) {
        await client.sendText(
          message.from,
          "📊 Hoy se facturó $52.300 (ejemplo de prueba)."
        );
      } else if (texto.includes("ayuda")) {
        await client.sendText(
          message.from,
          "🤖 Comandos disponibles:\n• hola\n• facturó\n• ayuda"
        );
      } else {
        await client.sendText(
          message.from,
          "🤖 No entiendo ese comando todavía. Escribí *hola* o *facturó*."
        );
      }
    } catch (err) {
      console.error(`⚠️ Error procesando mensaje en ${id}:`, err);
    }
  });
}

// =======================================================
// 🧪 TEST: Verificar si Chromium funciona en Railway
// =======================================================
app.get("/test-chromium", async (req, res) => {
  try {
    const path = await chromium.executablePath();
    res.json({
      estado: "ok",
      path,
      argsCount: chromium.args.length,
      headless: chromium.headless,
    });
  } catch (err) {
    res.status(500).json({
      estado: "error",
      error: err.message,
    });
  }
});

// =======================================================
// 🚀 Servidor Express activo
// =======================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Servidor MiQR Asistente corriendo en el puerto ${PORT}`);
});
