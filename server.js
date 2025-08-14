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
    try {
        const data = JSON.parse(req.body.formData);
        const { nombre, apellidos, poBox, direccion, casaApartamento, condado, ciudad, codigoPostal,
            cignaPlans, dependents, metodoPago, pagoBanco, pagoTarjeta, ...obamacareData } = data;

        const clientId = `CLI-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

        const uploadedFileLinks = [];
        if (req.files && req.files.length > 0) {
            const drive = google.drive({ version: 'v3', auth });
            for (const file of req.files) {
                const fileName = `${nombre}-${apellidos}-${Date.now()}-${file.originalname}`;
                const fileMetadata = { name: fileName, parents: [DRIVE_FOLDER_ID] };
                const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
                
                const driveResponse = await drive.files.create({
                    resource: fileMetadata, media, fields: 'id', supportsAllDrives: true
                });
                const fileId = driveResponse.data.id;
                
                await drive.permissions.create({
                    fileId: fileId, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true
                });

                const fileInfo = await drive.files.get({ fileId: fileId, fields: 'webViewLink' });
                uploadedFileLinks.push(`HYPERLINK("${fileInfo.data.webViewLink}", "${fileName}")`);
            }
        }
        
        let fullAddress = '';
        if (poBox) {
            fullAddress = poBox;
        } else {
            const addressParts = [direccion, casaApartamento, condado, ciudad, codigoPostal].filter(Boolean);
            fullAddress = addressParts.join(', ');
        }

        const sheets = google.sheets({ version: 'v4', auth });

        const titularRow = [
            obamacareData.operador || '',
            new Date().toLocaleDateString('es-ES'),
            obamacareData.tipoVenta || '',
            obamacareData.claveSeguridad || '',
            'Titular',
            nombre || '',
            apellidos || '',
            obamacareData.sexo || '',
            obamacareData.correo || '',
            obamacareData.telefono || '',
            obamacareData.fechaNacimiento ? isoToUs(obamacareData.fechaNacimiento) : '',
            obamacareData.estadoMigratorio || '',
            obamacareData.ssn || '',
            obamacareData.ingresos || '',
            obamacareData.aplica || '',
            obamacareData.cantidadDependientes || '0',
            fullAddress,
            obamacareData.compania || '',
            obamacareData.plan || '',
            obamacareData.creditoFiscal || '',
            obamacareData.prima || '',
            obamacareData.link || '',
            obamacareData.observaciones || '',
            clientId,
            uploadedFileLinks.join('\n')
        ];
        
        const dependentsRows = dependents.map(dep => [
            obamacareData.operador || '', 
            new Date().toLocaleDateString('es-ES'),
            obamacareData.tipoVenta || '',
            obamacareData.claveSeguridad || '',
            dep.parentesco || '',
            dep.nombre || '',
            dep.apellido || '',
            '',
            '',
            '',
            dep.fechaNacimiento ? isoToUs(dep.fechaNacimiento) : '',
            '',
            dep.ssn || '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            clientId,
            ''
        ]);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME_OBAMACARE}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [titularRow, ...dependentsRows] }
        });

        if (cignaPlans && cignaPlans.length > 0) {
            const cignaRows = cignaPlans.map(plan => [
                clientId,
                new Date().toLocaleString('es-ES'),
                `${nombre} ${apellidos}`,
                plan.tipo || '',
                plan.coberturaTipo || '',
                plan.beneficio || '',
                plan.deducible || '',
                plan.prima || '',
                plan.comentarios || '',
                plan.beneficioDiario || '',
                `${plan.beneficiarioNombre || ''} / ${plan.beneficiarioFechaNacimiento ? isoToUs(plan.beneficiarioFechaNacimiento) : ''} / ${plan.beneficiarioDireccion || ''} / ${plan.beneficiarioRelacion || ''}`
            ]);
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME_CIGNA}!A:Z`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: cignaRows }
            });
        }
        
        if (metodoPago) {
            const pagoRow = [
                clientId,
                new Date().toLocaleString('es-ES'),
                metodoPago || '',
                metodoPago === 'banco' ? pagoBanco.numCuenta : pagoTarjeta.numTarjeta,
                metodoPago === 'banco' ? pagoBanco.numRuta : pagoTarjeta.fechaVencimiento,
                metodoPago === 'banco' ? pagoBanco.nombreBanco : pagoTarjeta.cvc,
                metodoPago === 'banco' ? pagoBanco.titularCuenta : pagoTarjeta.titularTarjeta,
                metodoPago === 'banco' ? pagoBanco.socialCuenta : '',
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME_PAGOS}!A:Z`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [pagoRow] }
            });
        }

        res.status(200).json({ message: 'Formulario procesado correctamente' });

    } catch (error) {
        console.error('Error al procesar el formulario:', error);
        res.status(500).json({ error: 'Error interno del servidor al procesar el formulario.' });
    }
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

