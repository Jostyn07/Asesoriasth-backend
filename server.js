// server.js
require('dotenv').config(); // Carga las variables de entorno desde .env

// <-- VERIFICA ESTO: ¡Esta línea es CRUCIAL y DEBE estar aquí al principio!
const { Readable } = require('stream'); 
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const cors = require('cors'); 

// --- Configuración de Google Drive: Variables de entorno ---
// <-- VERIFICA ESTO: Asegúrate de que esta línea esté aquí y no comentada.
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID; // ID de la carpeta en Google Drive desde .env
const SCOPES = ['https://www.googleapis.com/auth/drive.file']; // Permisos necesarios

// --- AUTENTICACIÓN DE GOOGLE DRIVE (se hace UNA VEZ al iniciar el servidor) ---
let auth; // Declara 'auth' aquí para que sea accesible globalmente.
try {
    // Intenta leer el contenido JSON directamente de la variable de entorno para despliegue
    // <-- VERIFICA ESTO: Este 'if' es para cuando uses Render, que pasa el JSON directamente.
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) { 
        auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), // Parsea el JSON
            scopes: SCOPES,
        });
        // <-- VERIFICA ESTO: "console"
        console.log('Autenticación de Google Drive configurada con credenciales de variable de entorno.'); 
    } 
    // Si no está el secret, intenta leer de un archivo local (para desarrollo)
    // <-- VERIFICA ESTO: Este 'else if' es para tu desarrollo local, usando Documentos.json.
    else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
        auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, // Debe apuntar a ./Documentos.json
            scopes: SCOPES,
        });
        // <-- VERIFICA ESTO: "console"
        console.log('Autenticación de Google Drive configurada con archivo de credenciales local.'); 
    } else {
        // Si ninguna variable está definida, lanza un error crítico
        throw new Error('Ni GOOGLE_SERVICE_ACCOUNT_KEY ni GOOGLE_SERVICE_ACCOUNT_KEY_PATH están definidos para la autenticación.');
    }
} catch (error) {
    // <-- VERIFICA ESTO: "console"
    console.error('Error al configurar la autenticación de Google Drive:', error);
    process.exit(1); // Es vital terminar el proceso si la autenticación falla.
}

// --- CONFIGURACIÓN DE EXPRESS Y MIDDLEWARES (se hace UNA VEZ al iniciar el servidor) ---
const app = express(); // Declara 'app' una vez
const upload = multer(); // Configura multer una vez

// Habilita CORS para todas las rutas
// <-- VERIFICA ESTO: FRONTEND_URL desde tu .env o secrets
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
    
app.use(express.json()); // Middleware para parsear JSON


// --- RUTA DE SUBIDA DE ARCHIVOS (Aquí solo va la lógica de la ruta) ---
app.post('/api/upload-to-drive', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No se subieron los archivos' });
    }

    try {
        const drive = google.drive({
            version: 'v3',
            auth: auth // Usa la instancia de 'auth' ya configurada globalmente
        });

        // Recoge datos adicionales enviados desde el frontend
        const clientName = req.body.nombreCliente || '';
        const clientLastName = req.body.apellidoCliente || '';

        const uploadedFileLinks = [];

        for (const file of req.files) {
            //Genera nombre único para el archivo
            const fileName = `${clientName}-${clientLastName}-${Date.now()}-${file.originalname}`;
            const fileMetadata = {
                name: fileName,
                // parents: [DRIVE_FOLDER_ID] ya está definido arriba y viene del .env
                parents: [DRIVE_FOLDER_ID] 
            };

            const media = {
                mimeType: file.mimetype,
                body: Readable.from(file.buffer), // Usa el buffer del archivo subido
            };  
            const driveResponse = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, webViewLink,name',
                supportsAllDrives: true,
            });

            uploadedFileLinks.push({
                name: driveResponse.data.name,
                url: driveResponse.data.webViewLink,
            });
        }
        res.status(200).json({
            message: 'Archivos subidos correctamente',
            files: uploadedFileLinks,
        });
    } catch (error) {
        // <-- VERIFICA ESTO: "console"
        console.error('Error al subir archivos a Google Drive:', error);
        res.status(500).json({ error: 'Error al subir archivos a Google Drive' });
    }
});

// --- INICIAR EL SERVIDOR (se hace UNA VEZ al final del archivo) ---
const PORT = process.env.PORT || 3001; 
app.listen(PORT, () => {
    // <-- VERIFICA ESTO: "console"
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    // <-- VERIFICA ESTO: "console" y FRONTEND_URL desde tu .env
    console.log(`CORS habilitado para: ${process.env.FRONTEND_URL}`); 
});
