// =======================================================
// 🤖 Asistente Virtual MiQR - Servidor multiusuario (Railway + Firebase)
// =======================================================
import express from "express";
import wppconnect from "@wppconnect-team/wppconnect";
import fs from "fs";
import cors from "cors";
import chromium from "@sparticuz/chromium"; // ✅ Chromium liviano para Railway
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = express();
const PORT = process.env.PORT || 3000;

// =======================================================
// 🔥 Integración con Firebase (usa el mismo proyecto QR DreamCar)
// =======================================================
// ⚠️ Variables necesarias en Railway:
// FIREBASE_CLIENT_EMAIL
// FIREBASE_PRIVATE_KEY_BASE64

try {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Faltan variables FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY");
  }

  initializeApp({
    credential: cert({
      projectId: "qrdreamcar-nuevo",
      clientEmail,
      privateKey,
    }),
  });

  console.log("✅ Firebase inicializado correctamente");
} catch (err) {
  console.error("❌ Error al inicializar Firebase:", err);
}

const db = getFirestore();
const COLECCION = "asistentes_virtuales";

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

  // Si ya existe una sesión activa, no generar un QR nuevo
if (fs.existsSync(`${pathTokens}/session.data.json`)) {
  console.log(`🟢 Asistente ${id} ya está logueado.`);
  res.json({ estado: "logueado" });
  return;
}

  console.log(`🚀 Iniciando asistente para restaurante: ${id}`);

  try {
    // 🧠 Obtener la ruta del Chromium liviano
    const browserPath = await chromium.executablePath();
    if (!browserPath) {
      throw new Error("No se pudo obtener el path de Chromium en Railway.");
    }

    // ⚙️ Crear sesión WPPConnect con Chromium liviano (Railway)
    wppconnect
      .create({
        session: id,
        headless: true,
        autoClose: false, // 👈 evita que se cierre el proceso
        pathNameToken: pathTokens,
        useChrome: true,
        executablePath: browserPath,
        puppeteerOptions: { executablePath: browserPath },
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
      .then(async (client) => {
        console.log(`✅ Bot iniciado correctamente para restaurante ${id}`);

        // 🧾 Guardar número del asistente en Firestore
        try {
          const info = await client.getHostDevice();
          const numero = info?.id?.user || "desconocido";

          await db.collection(COLECCION).doc(id).set(
            {
              idRestaurante: id,
              numero,
              conectado: true,
              ultimaConexion: new Date().toISOString(),
            },
            { merge: true }
          );

          console.log(`📦 Asistente ${id} registrado en Firebase (${numero})`);
        } catch (err) {
          console.warn(`⚠️ No se pudo guardar en Firebase:`, err.message);
        }

        iniciarBot(client, id);
      })
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
// 🧪 TEST: Verificar si Firebase y Chromium funcionan en Railway
// =======================================================
app.get("/test-firebase", async (req, res) => {
  try {
    const testDoc = db.collection(COLECCION).doc("test-railway");
    await testDoc.set({
      ok: true,
      timestamp: new Date().toISOString(),
    });
    res.json({ estado: "ok", mensaje: "Conectado a Firestore correctamente ✅" });
  } catch (err) {
    res.status(500).json({ estado: "error", error: err.message });
  }
});

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
