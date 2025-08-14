// server.js
require('dotenv').config();
const { Readable } = require('stream'); 
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const cors = require('cors'); 
const fs = require('fs');
const path = require('path');

// Solo necesitamos el ID de la carpeta de Drive en el back-end
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
            scopes: ['https://www.googleapis.com/auth/drive']
        });
        console.log('Autenticación de Google configurada (solo Drive).');
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

// Endpoint dedicado para la subida de archivos
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
            
            // Corrección: Usar `Readable.from` de manera correcta
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

function isoToUs(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
}
