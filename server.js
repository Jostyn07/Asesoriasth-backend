// server.js
require('dotenv').config();
const { Readable } = require('stream'); 
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const cors = require('cors'); 

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let auth;
try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        auth = new google.auth.GoogleAuth({
            keyFile: '/etc/secrets/Service-account.json',
            scopes: ['https://www.googleapis.com/auth/drive']
        });
        console.log('Autenticación de Google Drive configurada con variable de entorno.');
    } else {
        throw new Error('No se encontró GOOGLE_SERVICE_ACCOUNT_KEY.');
    }
} catch (error) {
    console.error('Error al configurar la autenticación de Google Drive:', error);
    process.exit(1);
}

const app = express();
const upload = multer();

const allowedOrigins = ["https://asesoriasth.com"];
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
                supportsAllDrives: true
            };
            const media = {
                mimeType: file.mimetype,
                body: Readable.from(file.buffer)
            };
            const driveResponse = await drive.files.create({
                resource: fileMetadata,
                media,
                fields: 'id, name',
                supportsAllDrives: true
            });

            const fileId = driveResponse.data.id;

            await drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                },
                supportsAllDrives: true
            });

            const webViewLink = `https://drive.google.com/file/d/${fileId}/view`;

            uploadedFileLinks.push({
                name: driveResponse.data.name,
                url: webViewLink
            });
        }

        res.status(200).json({
            message: 'Archivos subidos correctamente',
            files: uploadedFileLinks
        });
    } catch (error) {
        console.error('Error al subir archivos a Google Drive:', error);
        res.status(500).json({ error: 'Error al subir archivos a Google Drive' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`CORS habilitado para: ${allowedOrigins.join(', ')}`);
});
