// server.js
require('dotenv').config();
const { Readable } = require('stream'); 
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const cors = require('cors'); 
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = "1T8YifEIUU7a6ugf_Xn5_1edUUMoYfM9loDuOQU1u2-8";
const SHEET_NAME_OBAMACARE = "Pólizas";
const SHEET_NAME_CIGNA = "Cigna Complementario";
const SHEET_NAME_PAGOS = "Pagos";
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

let auth;
try {
    const secretFilePath = process.env.NODE_ENV === 'production' 
        ? '/etc/secrets/Documentos_json' 
        : path.join(__dirname, 'Documentos.json');

    if (fs.existsSync(secretFilePath)) {
        const credentialsContent = fs.readFileSync(secretFilePath, 'utf8');
        const credentials = JSON.parse(credentialsContent);
        
        auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
        });
        console.log('Autenticación de Google configurada.');
    } else {
        throw new Error('No se encontró el archivo de credenciales.');
    }
} catch (error) {
    console.error('Error al configurar la autenticación de Google:', error);
    process.exit(1);
}

const app = express();
const upload = multer();
const allowedOrigins = ["https://asesoriasth.com", "http://127.0.0.1:5500"];
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

app.post('/api/upload-files', upload.array('files'), async (req, res) => {
    try {
        const { nombre, apellidos, clientId } = req.body;
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No se subieron archivos.' });
        }
        
        const uploadedFileLinks = [];
        const drive = google.drive({ version: 'v3', auth });

        for (const file of req.files) {
            const fileName = `${nombre}-${apellidos}-${clientId}-${Date.now()}-${file.originalname}`;
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
        
        res.status(200).json({
            message: 'Archivos subidos correctamente.',
            fileLinks: uploadedFileLinks
        });

    } catch (error) {
        console.error('Error al subir archivos:', error);
        res.status(500).json({ error: 'Error interno del servidor al subir los archivos.' });
    }
});

// Función para actualizar el color de las filas
async function colorRows(sheets, spreadsheetId, sheetName, startRowIndex, numRows, color) {
    const requests = [{
        updateCells: {
            range: {
                sheetId: await getSheetId(sheets, spreadsheetId, sheetName),
                startRowIndex: startRowIndex,
                endRowIndex: startRowIndex + numRows,
                startColumnIndex: 0,
                endColumnIndex: 25 // Asume que tienes 25 columnas (A-Y)
            },
            rows: Array(numRows).fill({
                values: [{
                    userEnteredFormat: {
                        backgroundColor: color
                    }
                }]
            }),
            fields: 'userEnteredFormat.backgroundColor'
        }
    }];

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests
        }
    });
}

// Helper para obtener el sheetId por su nombre
async function getSheetId(sheets, spreadsheetId, sheetName) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId
    });
    const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`Hoja de cálculo no encontrada: ${sheetName}`);
    return sheet.properties.sheetId;
}


// ... (continúa dentro del app.post) ...
app.post('/api/submit-form', upload.array('files'), async (req, res) => {
    try {
        // ... (Tu lógica para procesar datos y subir archivos) ...

        const sheets = google.sheets({ version: 'v4', auth });
        const titularColor = { red: 0.8, green: 0.9, blue: 1.0 }; // Azul claro
        const dependienteColor = { red: 0.9, green: 0.9, blue: 0.9 }; // Gris claro

        // ... (Construcción de titularRow y dependentsRows) ...
        const allRows = [titularRow, ...dependentsRows];

        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME_OBAMACARE}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: allRows }
        });

        // Obtener el rango de las filas agregadas
        const appendedRange = response.data.updates.updatedRange;
        const startRowIndex = parseInt(appendedRange.match(/\d+/)[0]) - 1;

        // Aplicar color a la fila del titular
        await colorRows(sheets, SPREADSHEET_ID, SHEET_NAME_OBAMACARE, startRowIndex, 1, titularColor);

        // Aplicar color a las filas de los dependientes
        if (dependentsRows.length > 0) {
            await colorRows(sheets, SPREADSHEET_ID, SHEET_NAME_OBAMACARE, startRowIndex + 1, dependentsRows.length, dependienteColor);
        }
        
        // ... (Tu lógica para Cigna y Pagos sigue igual) ...

        res.status(200).json({ message: 'Formulario procesado correctamente' });

    } catch (error) {
        console.error('Error al procesar el formulario:', error);
        res.status(500).json({ error: 'Error interno del servidor al procesar el formulario.' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

function isoToUs(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
}
