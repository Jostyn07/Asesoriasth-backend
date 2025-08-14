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

// Helper para obtener el sheetId por su nombre
async function getSheetId(sheets, spreadsheetId, sheetName) {
    const res = await sheets.spreadsheets.get({
        spreadsheetId
    });
    const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`Hoja de cálculo no encontrada: ${sheetName}`);
    return sheet.properties.sheetId;
}

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

// Endpoint unificado para recibir todo el formulario
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
        }
        
        let fullAddress = '';
        if (obamacareData.poBox) {
            fullAddress = obamacareData.poBox;
        } else {
            const addressParts = [obamacareData.direccion, obamacareData.casaApartamento, obamacareData.condado, obamacareData.ciudad, obamacareData.codigoPostal].filter(Boolean);
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
            obamacareData.fechaNacimiento ? usToIso(obamacareData.fechaNacimiento) : '',
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
            dep.fechaNacimiento ? usToIso(dep.fechaNacimiento) : '',
            dep.estadoMigratorio || '',
            dep.ssn || '',
            '',
            dep.aplica || '',
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
        
        const allRows = [titularRow, ...dependentsRows];

        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME_OBAMACARE}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: allRows }
        });

        const appendedRange = response.data.updates.updatedRange;
        const startRowIndex = parseInt(appendedRange.match(/\d+/)[0]) - 1;

        // Titular sin color (blanco por defecto)
        // Dependientes en amarillo
        const dependienteColor = { red: 1.0, green: 1.0, blue: 0.0 };

        if (dependentsRows.length > 0) {
            await colorRows(sheets, SPREADSHEET_ID, SHEET_NAME_OBAMACARE, startRowIndex + 1, dependentsRows.length, dependienteColor);
        }
        
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
                `${plan.beneficiarioNombre || ''} / ${plan.beneficiarioFechaNacimiento ? usToIso(plan.beneficiarioFechaNacimiento) : ''} / ${plan.beneficiarioDireccion || ''} / ${plan.beneficiarioRelacion || ''}`
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
                metodoPago === 'banco' ? pagoBanco.nombreBanco : pagoTarjeta.titularTarjeta,
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

function usToIso(us) {
    if (!us) return "";
    const [m, d, y] = us.split("/");
    return `${y}-${m}-${d}`;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

