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

// 🧠 Control avanzado de sesión
if (fs.existsSync(`${pathTokens}/session.data.json`) || fs.existsSync(`${pathTokens}/Default`)) {
  console.log(`⚠️ Sesión ${id} ya detectada. Evitando navegador duplicado.`);
  return res.json({ estado: "logueado" });
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
        autoClose: false,      // ✅ mantiene el QR abierto hasta que escanees
        restartOnCrash: true,  // ✅ reinicia si se bloquea
                              // 👈 reinicia la sesión si hay un bloqueo
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

function iniciarBot(client, id) {
  console.log(`✅ Bot iniciado correctamente para restaurante ${id}`);

  // 🧠 Estado temporal de conversación por número
  const estadoConversacion = new Map();

  client.onMessage(async (message) => {
    try {
      if (message.isGroupMsg || message.fromMe) return;
      const texto = (message.body || "").toLowerCase().trim();

      // =======================================================
      // 📋 MENÚ PRINCIPAL (A/B/C/D)
      // =======================================================
      if (["hola", "menu", "menú", "inicio"].includes(texto)) {
        let nombreRestaurante = "tu restaurante 🍽️";
        try {
          const doc = await db.collection("menus").doc(id).get();
          if (doc.exists && doc.data().nombre) nombreRestaurante = doc.data().nombre;
        } catch (e) {
          console.warn("⚠️ No se pudo obtener el nombre:", e.message);
        }

        await client.sendText(
          message.from,
          `👋 ¡Hola! Soy el asistente virtual de *${nombreRestaurante}*.\n` +
            "Puedo brindarte información actualizada del restaurante:\n\n" +
            "A – 📊 Facturación del día\n" +
            "B – 🕓 Pedidos activos\n" +
            "C – 🍽️ Mesas ocupadas\n" +
            "D – 👨‍🍳 Mozos y rendimiento\n\n" +
            "Escribí la *letra* o el *nombre del comando* para continuar."
        );
        estadoConversacion.delete(message.from);
        return;
      }

      // =======================================================
      // 🅰️ 🅱️ 🅲 🅳 OPCIONES PRINCIPALES (solo si no hay contexto activo)
      // =======================================================
      const contextoActivo = estadoConversacion.get(message.from);
      if (!contextoActivo) {
        // 🅰️ OPCIÓN A – FACTURACIÓN DEL DÍA
        if (texto === "a" || (texto.includes("factur") && texto.includes("hoy"))) {
          const hoy = new Date();
          hoy.setHours(0, 0, 0, 0);
          const mañana = new Date(hoy);
          mañana.setDate(mañana.getDate() + 1);

          const pedidosRef = db.collection("pedidos_restaurante");
          const pedidos = await pedidosRef
            .where("idMenu", "==", id)
            .where("estado", "==", "pagado")
            .where("finalizado", ">=", hoy)
            .where("finalizado", "<", mañana)
            .get();

          if (pedidos.empty) {
            await client.sendText(message.from, "📊 No hay ventas registradas hoy.");
            return;
          }

          let total = 0;
          const porMozo = {};
          pedidos.forEach((doc) => {
            const data = doc.data();
            total += data.total || 0;
            const mozo = data.nombreMozo || "Desconocido";
            porMozo[mozo] = (porMozo[mozo] || 0) + (data.total || 0);
          });

          estadoConversacion.set(message.from, {
            tipo: "facturacionHoy",
            total,
            porMozo,
          });

          await client.sendText(
            message.from,
            `📊 *Facturación de hoy: $${total.toLocaleString("es-AR")}* (${pedidos.size} pedidos)\n\n` +
              "¿Deseás ver el detalle por mozo?\n\n" +
              "A – Sí, mostrar detalle\n" +
              "B – No, volver al menú principal"
          );
          return;
        }

        // 🅲 OPCIÓN C – MESAS OCUPADAS
        if (texto === "c" || (texto.includes("mesa") && texto.includes("ocup"))) {
          const mesasRef = db.collection("mesas_restaurante");
          const snapshot = await mesasRef
            .where("menuId", "==", id)
            .where("estado", "in", ["OCUPADA", "ocupada"])
            .get();

          if (snapshot.empty) {
            await client.sendText(
              message.from,
              "🍽️ Actualmente no hay mesas ocupadas. Todo está disponible. ✅"
            );
            return;
          }

          const cantidad = snapshot.size;
          estadoConversacion.set(message.from, {
            tipo: "mesasOcupadas",
            datos: snapshot.docs.map((doc) => ({
              mesa: doc.data().mesa,
              mozo: doc.data().mozoNombre || "Sin asignar",
              hora: doc.data().timestamp,
            })),
          });

          await client.sendText(
            message.from,
            `🍽️ En este momento hay *${cantidad}* mesa${
              cantidad > 1 ? "s" : ""
            } ocupada${
              cantidad > 1 ? "s" : ""
            }.\n¿Deseás que te detalle quién las atiende?\n\nA – Sí, mostrar detalle\nB – No, volver al menú principal`
          );
          return;
        }

        // 🅳 OPCIÓN D – MOZOS Y RENDIMIENTO (placeholder)
        if (texto === "d" || texto.includes("mozo")) {
          await client.sendText(
            message.from,
            "👨‍🍳 Esta función mostrará pronto el rendimiento de mozos (en desarrollo)."
          );
          return;
        }
      }

      // =======================================================
      // 🔁 RESPUESTAS A/B SECTORIZADAS POR CONTEXTO
      // =======================================================
      if (["a", "b", "si", "sí", "no"].includes(texto)) {
        const contexto = estadoConversacion.get(message.from);
        if (!contexto) return;

        switch (contexto.tipo) {
          // 🔹 FACTURACIÓN HOY
          case "facturacionHoy":
            if (texto.startsWith("a") || texto.startsWith("s")) {
              let respuesta = "👨‍🍳 *Detalle de ventas por mozo:*\n";
              for (const [mozo, monto] of Object.entries(contexto.porMozo)) {
                respuesta += `• ${mozo}: $${monto.toLocaleString("es-AR")}\n`;
              }
              respuesta += `\n💰 *Total general:* $${contexto.total.toLocaleString("es-AR")}\n`;
              await client.sendText(
                message.from,
                respuesta + "\n✅ Escribí *menu* para volver al inicio."
              );
            } else {
              await client.sendText(
                message.from,
                "👌 Perfecto. Escribí *menu* para volver al inicio."
              );
            }
            estadoConversacion.delete(message.from);
            break;

          // 🔹 MESAS OCUPADAS
          case "mesasOcupadas":
            if (texto.startsWith("a") || texto.startsWith("s")) {
              let respuesta = "📋 *Detalle de mesas actualmente ocupadas:*\n\n";
              contexto.datos.forEach((m) => {
                let tiempo = "";
                if (m.hora?.seconds) {
                  const minutos = Math.floor(
                    (Date.now() - new Date(m.hora.seconds * 1000)) / 60000
                  );
                  const horas = Math.floor(minutos / 60);
                  const minRest = minutos % 60;
                  tiempo =
                    horas > 0
                      ? ` (hace ${horas}h ${minRest}min)`
                      : ` (hace ${minRest} min)`;
                }
                respuesta += `• 🪑 Mesa ${m.mesa} — *${m.mozo}*${tiempo}\n`;
              });
              await client.sendText(
                message.from,
                respuesta + "\n✅ Escribí *menu* para volver al inicio."
              );
            } else {
              await client.sendText(
                message.from,
                "👌 Perfecto. Escribí *menu* para volver al inicio."
              );
            }
            estadoConversacion.delete(message.from);
            break;

          default:
            await client.sendText(
              message.from,
              "🤖 No entiendo esa opción. Escribí *menu* para volver al inicio."
            );
            estadoConversacion.delete(message.from);
            break;
        }
        return;
      }

      // =======================================================
      // 🆘 AYUDA GENERAL
      // =======================================================
      if (texto.includes("ayuda")) {
        await client.sendText(
          message.from,
          "🤖 Puedo ayudarte con:\n\n" +
            "A – Facturación del día\n" +
            "B – Pedidos activos\n" +
            "C – Mesas ocupadas\n" +
            "D – Mozos y rendimiento\n\n" +
            "Escribí *menu* para volver al inicio."
        );
        return;
      }

      // =======================================================
      // ❔ DEFAULT
      // =======================================================
      await client.sendText(
        message.from,
        "🤖 No entiendo ese comando todavía. Escribí *menu* para ver las opciones disponibles."
      );
    } catch (err) {
      console.error(`⚠️ Error procesando mensaje en ${id}:`, err);
      await client.sendText(
        message.from,
        "⚠️ Ocurrió un error procesando la consulta."
      );
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
// 🧹 Endpoint para eliminar sesión de un restaurante
// =======================================================
app.get("/api/reiniciar/:id", async (req, res) => {
  const id = req.params.id;
  const pathTokens = `./bots/${id}`;
  try {
    if (fs.existsSync(pathTokens)) {
      fs.rmSync(pathTokens, { recursive: true, force: true });
      console.log(`🧹 Sesión ${id} eliminada correctamente.`);
      res.json({ estado: "ok", mensaje: `Sesión ${id} eliminada correctamente.` });
    } else {
      res.json({ estado: "ok", mensaje: `No existía sesión para ${id}.` });
    }
  } catch (err) {
    console.error("❌ Error eliminando sesión:", err);
    res.status(500).json({ estado: "error", error: err.message });
  }
});

// =======================================================
// 🧹 Forzar limpieza completa (cuando el QR no se genera o se corrompe)
// =======================================================
app.get("/api/forzar-reinicio/:id", async (req, res) => {
  const id = req.params.id;
  const pathTokens = `./bots/${id}`;
  try {
    fs.rmSync(pathTokens, { recursive: true, force: true });
    console.log(`🧹 Carpeta de sesión eliminada: ${pathTokens}`);
    res.json({ estado: "ok", mensaje: `Sesión ${id} eliminada completamente.` });
  } catch (err) {
    console.error("❌ Error eliminando carpeta:", err);
    res.status(500).json({ estado: "error", error: err.message });
  }
});

// =======================================================
// 🚀 Servidor Express activo
// =======================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Servidor MiQR Asistente corriendo en el puerto ${PORT}`);
});
