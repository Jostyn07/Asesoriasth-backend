// server.js
require('dotenv').config();
const { Readable } = require('stream'); 
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const cors = require('cors'); 
const fs = require('fs');
const path = require('path');
const { parse } = require('url');
const getAuthenticatedClient = require('./auth');

const SPREADSHEET_ID = "1T8YifEIUU7a6ugf_Xn5_1edUUMoYfM9loDuOQU1u2-8";
const SHEET_NAME_OBAMACARE = "Pólizas";
const SHEET_NAME_CIGNA = "Cigna Complementario";
const SHEET_NAME_PAGOS = "Pagos";
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

let auth;try {
auth = new google.auth.GoogleAuth({
scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
});
console.log('Autenticación de Google configurada.');
} catch (error) {
console.error('Error al configurar la autenticación de Google:', error);
process.exit(1);
}

const app = express();
const upload = multer();
const allowedOrigins = ["https://asesoriasth.com", "http://127.0.0.1:5500", "https://asesoriasth.com/formulario.html"];
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("No autorizado por CORS"));
        }
    },
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// Helper para obtener el sheetId por su nombre
async function getSheetId(sheets, spreadsheetId, sheetName) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId
    });
    const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`Hoja de cálculo no encontrada: ${sheetName}`);
    return sheet.properties.sheetId;
}

// Endpoint para crear carpeta y subir archivos a Google Drive
app.post('/create-folder', async (req, res) => {
  try {
    const folderName = req.body.folderName;
    if (!folderName) {
      return res.status(400).send('El nombre de la carpeta es requerido.');
    }

    // Usa tu función de autenticación
    const authClient = await getAuthenticatedClient();
    const drive = google.drive({ version: 'v3', auth: authClient });

    const fileMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [DRIVE_FOLDER_ID], // Usa la carpeta raíz de tu .env
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      fields: 'id',
    });

    res.status(201).send({
      message: 'Carpeta creada exitosamente',
      folderId: response.data.id,
    });

  } catch (error) {
    console.error('Error al crear la carpeta:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// Subir archivos a una carpeta específica en Google Drive
app.post('/upload-to-folder', upload.array('files'), async (req, res) => {
    try {
        const { folderId } = req.body;
        if (!folderId) {
            return res.status(400).send('El ID de la carpeta es requerido.');
        }
        // Usa tu función de autenticación
        const authClient = await getAuthenticatedClient();
        const drive = google.drive({ version: 'v3', auth: authClient });

        const uploadFileLinks = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const fileMetadata = { name: file.originalname, parents: [folderId] };
                const media = {
                    mimeType: file.mimetype,
                    body: Readable.from(file.buffer)
                };
                const driveResponse = await drive.files.create({
                    resource: fileMetadata, media, fields: 'id, webViewLink', supportsAllDrives: true
                });
                const fileInfo = driveResponse.data;
                await drive.permissions.create({
                    fileId: fileInfo.id, requestBody: {role: 'reader', type: 'anyone'}, supportsAllDrives: true
                });
                uploadFileLinks.push(`HYPERLINK("${fileInfo.webViewLink}", "${file.originalname}")`);
            }
        }
        res.status(200).send({ message: 'Archivos subidos exitosamente', links: uploadFileLinks });
    } catch (error) {
        console.error('Error al subir archivos:', error);
        res.status(500).send('Error interno del servidor');
    }
});
function usToIso(us) {
    if (!us) return "";
    const [m, d, y] = us.split("/");
    return `${y}-${m}-${d}`;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

