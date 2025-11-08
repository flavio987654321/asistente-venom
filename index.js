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
// 🧠 Lógica principal del bot (versión mejorada con datos reales)
// =======================================================
function iniciarBot(client, id) {
  console.log(`✅ Bot iniciado correctamente para restaurante ${id}`);

  client.onMessage(async (message) => {
    try {
      if (message.isGroupMsg || message.fromMe) return;

      const texto = (message.body || "").toLowerCase().trim();

      // === SALUDO ===
      if (texto.includes("hola")) {
        await client.sendText(message.from, `👋 Hola! Soy el asistente virtual de ${id}.`);
        return;
      }

      // === 1️⃣ FACTURACIÓN DE HOY ===
      if (texto.includes("factur") && texto.includes("hoy")) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const mañana = new Date(hoy);
        mañana.setDate(mañana.getDate() + 1);

        const pedidos = await db.collection("pedidos_restaurante")
          .where("idMenu", "==", id)
          .where("estado", "==", "pagado")
          .where("finalizado", ">=", hoy)
          .where("finalizado", "<", mañana)
          .get();

        let total = 0;
        pedidos.forEach((doc) => total += doc.data().total || 0);

        await client.sendText(
          message.from,
          pedidos.empty
            ? "📊 No hay ventas registradas hoy."
            : `📊 Facturación de hoy: *$${total.toLocaleString("es-AR")}* (${pedidos.size} pedidos)`
        );
        return;
      }

      // === 2️⃣ FACTURACIÓN DE AYER ===
      if (texto.includes("factur") && texto.includes("ayer")) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const ayer = new Date(hoy);
        ayer.setDate(ayer.getDate() - 1);

        const pedidos = await db.collection("pedidos_restaurante")
          .where("idMenu", "==", id)
          .where("estado", "==", "pagado")
          .where("finalizado", ">=", ayer)
          .where("finalizado", "<", hoy)
          .get();

        let total = 0;
        pedidos.forEach((doc) => total += doc.data().total || 0);

        await client.sendText(
          message.from,
          pedidos.empty
            ? "📉 No hubo ventas registradas ayer."
            : `📉 Facturación de ayer: *$${total.toLocaleString("es-AR")}* (${pedidos.size} pedidos)`
        );
        return;
      }

     // === 3️⃣ MESAS OCUPADAS ===
if (texto.includes("mesa") && texto.includes("ocup")) {
  const mesas = await db.collection("mesas_restaurante")
    .where("menuId", "==", id)
    .where("estado", "in", ["OCUPADA", "ocupada"])
    .get();

  await client.sendText(
    message.from,
    mesas.empty
      ? "🍽️ No hay mesas ocupadas en este momento."
      : `🍽️ Hay *${mesas.size}* mesas ocupadas ahora mismo.`
  );
  return;
}


      // === 4️⃣ PEDIDOS ACTIVOS ===
      if (texto.includes("pedido") && texto.includes("activo")) {
        const activos = await db.collection("pedidos_restaurante")
          .where("idMenu", "==", id)
          .where("estado", "==", "activo")
          .get();

        await client.sendText(
          message.from,
          activos.empty
            ? "🕓 No hay pedidos activos en este momento."
            : `🕓 Hay *${activos.size}* pedidos activos.`
        );
        return;
      }

      // === 5️⃣ MEJOR MOZO DEL DÍA ===
      if (texto.includes("mejor") && texto.includes("mozo")) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const mañana = new Date(hoy);
        mañana.setDate(mañana.getDate() + 1);

        const pedidos = await db.collection("pedidos_restaurante")
          .where("idMenu", "==", id)
          .where("estado", "==", "pagado")
          .where("finalizado", ">=", hoy)
          .where("finalizado", "<", mañana)
          .get();

        const conteo = {};
        pedidos.forEach((doc) => {
          const mozo = doc.data().nombreMozo || "Sin nombre";
          conteo[mozo] = (conteo[mozo] || 0) + (doc.data().total || 0);
        });

        if (!Object.keys(conteo).length) {
          await client.sendText(message.from, "👤 No hay mozos con ventas registradas hoy.");
          return;
        }

        const [mejor, monto] = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];
        await client.sendText(
          message.from,
          `🏆 El mejor mozo de hoy es *${mejor}* con ventas por *$${monto.toLocaleString("es-AR")}*.`
        );
        return;
      }

      // === AYUDA / MENÚ DE COMANDOS ===
      if (texto.includes("ayuda")) {
        await client.sendText(
          message.from,
          "🤖 Puedo responder a estos comandos:\n\n" +
          "• facturó hoy\n" +
          "• facturó ayer\n" +
          "• mesas ocupadas\n" +
          "• pedidos activos\n" +
          "• mejor mozo\n"
        );
        return;
      }

      // === POR DEFECTO ===
      await client.sendText(
        message.from,
        "🤖 No entiendo ese comando todavía. Escribí *ayuda* para ver opciones disponibles."
      );

    } catch (err) {
      console.error(`⚠️ Error procesando mensaje en ${id}:`, err);
      await client.sendText(message.from, "⚠️ Ocurrió un error procesando la consulta.");
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
