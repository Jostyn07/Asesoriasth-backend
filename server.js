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

// Endpoint unificado para recibir todo el formulario
app.post('/api/upload-files', upload.array('files'), async (req, res) => {
    try {
        const nombre = req.body.nombre || "SinNombre";
        const apellidos = req.body.apellidos || "SinApellido";
        const uploadedFileLinks = [];
        if (req.files && req.files.length > 0) {
            const drive = google.drive({ version: 'v3', auth });
            for (const file of req.files) {
                const fileName = `${nombre}-${apellidos}-${Date.now()}-${file.originalname}`;
                const fileMetadata = { name: fileName, parents: [DRIVE_FOLDER_ID] };
                
                const media = {
                    mimeType: file.mimetype,
                    body: Readable.from(file.buffer)
                };
                
                const driveResponse = await drive.files.create({
                    resource: fileMetadata, media, fields: 'id,webViewLink', supportsAllDrives: true
                });
                const fileInfo = driveResponse.data;
                const fileId = fileInfo.id;
                
                await drive.permissions.create({
                    fileId: fileId, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true
                });

                uploadedFileLinks.push(`HYPERLINK("${fileInfo.webViewLink}", "${fileName}")`);
            }
        }
        res.status(200).json({ message: 'Formulario procesado correctamente' });

    } catch (error) {
        console.error('Error al procesar el formulario:', error);
        res.status(500).json({ error: 'Error interno del servidor al procesar el formulario.' });
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



