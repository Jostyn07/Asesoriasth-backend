// server.js
require('dotenv').config();
const fs = require('fs');
const { Readable } = require('stream');
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const cors = require('cors');

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let auth;

try {
    const keyFilePath = '/etc/secrets/service-account.json';
    if (fs.existsSync(keyFilePath)) {
        auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: SCOPES,
        });
        console.log('Autenticación configurada desde archivo secreto.');
    } else {
        throw new Error('No se encontró el archivo de clave del servicio.');
    }
} catch (error) {
    console.error('Error al configurar la autenticación de Google Drive:', error);
    process.exit(1);
}

const app = express();
const upload = multer();

const allowedOrigins = ["https://jostyn07.github.io"];
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

app.post('/api/upload-to-drive', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No se subieron los archivos' });
    }

    try {
        const drive = google.drive({ version: 'v3', auth });
        const clientName = req.body.nombreCliente || '';
        const clientLastName = req.body.apellidoCliente || '';

        const uploadedFileLinks = [];

        for (const file of req.files) {
            const fileName = `${clientName}-${clientLastName}-${Date.now()}-${file.originalname}`;
            const fileMetadata = {
                name: fileName,
                parents: [DRIVE_FOLDER_ID],
            };
            const media = {
                mimeType: file.mimetype,
                body: Readable.from(file.buffer),
            };
            const driveResponse = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, webViewLink, name',
                supportsAllDrives: true,
            });

            uploadedFileLinks.push({
                name: driveResponse.data.name,
                url: driveResponse.data.webViewLink,
            });
        }

        res.status(200).json({ message: 'Archivos subidos correctamente', files: uploadedFileLinks });
    } catch (error) {
        console.error('Error al subir archivos a Google Drive:', error);
        res.status(500).json({ error: 'Error al subir archivos a Google Drive' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
