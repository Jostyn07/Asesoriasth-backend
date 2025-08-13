require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');

const app = express();

// ====== CORS ======
const allowedOrigins = [
  "https://landing-asesorias-frontend.onrender.com",
  "http://localhost:3000"
];
app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error("No autorizado por CORS")),
}));
app.use(express.json({ limit: "2mb" }));

// ====== Multer (memoria) ======
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ====== Google Drive Auth ======
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
if (!DRIVE_FOLDER_ID) {
  console.error("Falta GOOGLE_DRIVE_FOLDER_ID");
}

function buildGoogleAuth() {
  const scopes = ["https://www.googleapis.com/auth/drive.file"];
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    return new google.auth.GoogleAuth({ credentials: creds, scopes });
  }
  throw new Error("No hay credenciales de Google configuradas");
}
const auth = buildGoogleAuth();

// ====== Endpoints ======
app.post("/api/upload-to-drive", upload.any(), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ ok: false, error: "No se recibió ningún archivo." });
    }
    if (!DRIVE_FOLDER_ID) {
      return res.status(500).json({ ok: false, error: "Falta GOOGLE_DRIVE_FOLDER_ID" });
    }
    const drive = google.drive({ version: "v3", auth });
    const uploaded = [];
    for (const f of files) {
      if (!f.buffer || !f.buffer.length) {
        throw new Error("El archivo está vacío o no tiene buffer");
      }
      const safeName = `${Date.now()}-${f.originalname}`;
      const createResp = await drive.files.create({
        requestBody: {
          name: safeName,
          parents: [DRIVE_FOLDER_ID],
        },
        media: {
          mimeType: f.mimetype,
          body: f.buffer,
        },
        fields: "id,name",
      });
      const fileId = createResp.data.id;
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
      });
      const { data: getData } = await drive.files.get({
        fileId,
        fields: "webViewLink, webContentLink",
      });
      uploaded.push({
        id: fileId,
        name: createResp.data.name,
        webViewLink: getData.webViewLink,
        webContentLink: getData.webContentLink,
      });
    }
    return res.json({ ok: true, message: "Archivos subidos correctamente", files: uploaded });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Error interno al subir a Drive",
    });
  }
});

app.post('/api/polizas', (req, res) => {
  res.json({ ok: true, message: "Poliza recibida correctamente" });
});

app.post('/api/cigna', (req, res) => {
  res.json({ ok: true, message: "Cigna recibida correctamente" });
});

app.post('/api/pagos', (req, res) => {
  res.json({ ok: true, message: "Pago recibido correctamente" });
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});