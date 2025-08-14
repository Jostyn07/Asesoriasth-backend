const express = require('express');
const cors = require('cors');
const multer = require('multer');
const {
    google
} = require('googleapis');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configuración de CORS
app.use(cors({
    origin: true,
    credentials: true,
}));
app.use(express.json()); // para parsear application/json

// Configuración de Multer para manejar la subida de archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage
});

// Autenticación con Google como cuenta de servicio
const auth = new google.auth.GoogleAuth({
    keyFile: "Documentos.json",
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({
    version: 'v3',
    auth
});

// Endpoint para subir archivos
app.post('/api/upload-files', upload.array('files'), async (req, res) => {
    try {
        const authClient = await auth.getClient();
        google.options({
            auth: authClient
        });

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                error: "No se subió ningún archivo."
            });
        }

        const uploadPromises = req.files.map(file => {
            const fileMetadata = {
                'name': file.originalname,
                parents: [process.env.DRIVE_FOLDER_ID || '1zxpiKTAgF6ZPDF3hi40f7CRWY8QXVqRE'],
            };
            const media = {
                mimeType: file.mimetype,
                body: file.buffer,
            };

            return drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id',
            });
        });

        await Promise.all(uploadPromises);

        console.log("Archivos subidos exitosamente a Google Drive.");
        res.status(200).json({
            message: "Archivos subidos correctamente."
        });

    } catch (error) {
        console.error("Error al subir archivos a Google Drive:", error);
        res.status(500).json({
            error: "Error interno del servidor al subir archivos."
        });
    }
});

// Endpoint para probar el servidor
app.get('/api/status', (req, res) => {
    res.status(200).send('Backend is running.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
