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
    // Definir la ruta del archivo secreto en Render
    const secretFilePath = process.env.NODE_ENV === 'production' 
        ? '/etc/secrets/Documentos_json' // Ruta en Render
        : path.join(__dirname, 'Documentos.json'); // Ruta local para desarrollo

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

app.post('/api/submit-form', upload.array('files'), async (req, res) => {
    // ... Tu lógica de procesamiento del formulario y escritura en Sheets
    // ... sigue igual, no necesita cambios aquí.
});

function isoToUs(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
