import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import multer from 'multer';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { query } from './db.js';
import draftRoutes from './routes/draftRoutes.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURACIÓN MULTER ====================
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// ==================== CONFIGURACIÓN GOOGLE ====================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const SHEET_NAME_OBAMACARE = "Pólizas";
const SHEET_NAME_CIGNA = "Cigna Complementario";
const SHEET_NAME_PAGOS = "Pagos";

// Variables globales para los clientes de Google
let sheetsClient = null;
let driveClient = null;
let authClient = null;

// ==================== AUTENTICACIÓN GOOGLE ====================
async function getAuthenticatedClient() {
  if (authClient) {
    return authClient;
  }

  try {
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      : null;

    if (!credentials) {
      throw new Error('No se encontraron credenciales de Google Service Account');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive'
      ],
    });

    authClient = await auth.getClient();
    console.log('✅ Cliente de autenticación Google creado');
    return authClient;
  } catch (error) {
    console.error('❌ Error creando cliente de autenticación:', error.message);
    throw error;
  }
}

// Inicializar Google Sheets
async function initGoogleSheets() {
  try {
    const auth = await getAuthenticatedClient();
    sheetsClient = google.sheets({ version: 'v4', auth: auth });
    console.log('✅ Google Sheets API inicializada');
    return sheetsClient;
  } catch (error) {
    console.error('❌ Error inicializando Google Sheets:', error.message);
    return null;
  }
}

// Inicializar Google Drive
async function initGoogleDrive() {
  try {
    const auth = await getAuthenticatedClient();
    driveClient = google.drive({ version: 'v3', auth: auth });
    console.log('✅ Google Drive API inicializada');
    return driveClient;
  } catch (error) {
    console.error('❌ Error inicializando Google Drive:', error.message);
    return null;
  }
}

// Inicializar al arrancar
(async () => {
  await initGoogleSheets();
  await initGoogleDrive();
})();

// Función para limpiar valores de moneda
function cleanCurrency(value) {
  if (!value) return '';
  return value.toString().replace(/[$,]/g, '');
}

// Función para agregar datos a Google Sheets
async function appendToSheet(sheetName, values) {
  if (!sheetsClient) {
    console.warn('⚠️ Google Sheets no disponible. Saltando...');
    return null;
  }

  try {
    const response = await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values]
      }
    });

    console.log(`✅ Datos agregados a ${sheetName}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Error agregando a ${sheetName}:`, error.message);
    throw error;
  }
}

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Backend de Asesorías S&S funcionando correctamente',
    timestamp: new Date().toISOString(),
    services: {
      postgresql: true,
      googleSheets: sheetsClient !== null,
      googleDrive: driveClient !== null
    }
  });
});

// Rutas de borradores
app.use('/api/drafts', draftRoutes);

// ==================== ENDPOINT: LOGIN ====================
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log(`🔐 Intento de login para: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email y contraseña son requeridos' 
      });
    }

    // Buscar usuario por email
    const sql = 'SELECT id, nombre, email, password, rol FROM usuarios WHERE email = $1';
    const users = await query(sql, [email]);

    if (users.length === 0) {
      console.log(`❌ Usuario no encontrado: ${email}`);
      return res.status(401).json({ 
        error: 'Credenciales inválidas' 
      });
    }

    const user = users[0];

    // Verificar si la contraseña es un hash de bcrypt
    const isHashedPassword = user.password && user.password.startsWith('$2');
    let passwordValid = false;

    if (isHashedPassword) {
      // Comparar con bcrypt
      passwordValid = await bcrypt.compare(password, user.password);
    } else {
      // Comparación directa (para contraseñas sin hashear)
      passwordValid = user.password === password;
    }

    if (!passwordValid) {
      console.log(`❌ Contraseña incorrecta para: ${email}`);
      return res.status(401).json({ 
        error: 'Credenciales inválidas' 
      });
    }

    console.log(`✅ Login exitoso: ${user.nombre} (${user.rol})`);

    // Generar token
    const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');

    return res.json({
      success: true,
      message: 'Autenticación exitosa',
      token: token,
      user: {
        id: user.id,
        name: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });

  } catch (error) {
    console.error('❌ Error en /api/login:', error);
    console.error('Stack:', error.stack);
    return res.status(500).json({ 
      error: 'Error interno del servidor al intentar iniciar sesión',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== ENDPOINT: CREAR CARPETA EN DRIVE ====================
app.post('/api/create-folder', async (req, res) => {
  console.log('📁 Solicitud para crear carpeta:', req.body);
  
  try {
    const { folderName } = req.body;
    
    if (!folderName) {
      return res.status(400).json({ 
        error: 'El nombre de la carpeta es requerido' 
      });
    }

    if (!driveClient) {
      // Intentar inicializar si no está disponible
      await initGoogleDrive();
      
      if (!driveClient) {
        return res.status(503).json({ 
          error: 'Google Drive no está disponible en este momento' 
        });
      }
    }

    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [DRIVE_FOLDER_ID]
    };

    const response = await driveClient.files.create({
      resource: folderMetadata,
      fields: 'id, webViewLink',
      supportsAllDrives: true 
    });

    const folderId = response.data.id;
    const folderLink = response.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;

    console.log(`✅ Carpeta creada: ${folderName} (ID: ${folderId})`);

    return res.status(201).json({
      success: true,
      message: 'Carpeta creada exitosamente',
      folderId: folderId,
      folderLink: folderLink
    });

  } catch (error) {
    console.error('❌ Error creando carpeta:', error);
    return res.status(500).json({ 
      error: 'Error al crear la carpeta',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== ENDPOINT: SUBIR ARCHIVOS A DRIVE ====================
app.post('/api/upload-files', upload.array('files'), async (req, res) => {
  console.log('📤 Solicitud para subir archivos');
  
  try {
    const { folderId, folderLink, nombre, apellidos, telefono } = req.body;
    
    if (!folderId && !folderLink) {
      return res.status(400).json({ 
        error: 'Se requiere folderId o folderLink' 
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        error: 'No se recibieron archivos para subir' 
      });
    }

    if (!driveClient) {
      await initGoogleDrive();
      
      if (!driveClient) {
        return res.status(503).json({ 
          error: 'Google Drive no está disponible' 
        });
      }
    }

    console.log(`📁 Subiendo ${req.files.length} archivo(s) a carpeta: ${folderId}`);

    const uploadedFileLinks = [];

    for (const file of req.files) {
      console.log(`📄 Subiendo: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`);
      
      const fileMetadata = {
        name: file.originalname,
        parents: [folderId]
      };

      const media = {
        mimeType: file.mimetype,
        body: Readable.from(file.buffer)
      };

      const response = await driveClient.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
        supportsAllDrives: true
      });

      uploadedFileLinks.push({
        name: file.originalname,
        id: response.data.id,
        link: response.data.webViewLink
      });

      console.log(`✅ Archivo subido: ${file.originalname}`);
    }

    const finalFolderLink = folderLink || `https://drive.google.com/drive/folders/${folderId}`;

    return res.status(200).json({
      success: true,
      message: 'Archivos subidos exitosamente',
      fileLinks: uploadedFileLinks,
      folderLink: finalFolderLink,
      stats: {
        uploaded: uploadedFileLinks.length,
        total: req.files.length
      }
    });

  } catch (error) {
    console.error('❌ Error subiendo archivos:', error);
    return res.status(500).json({ 
      error: 'Error al subir archivos',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== ENDPOINT: SUBMIT FORM DATA ====================
app.post('/api/submit-form-data', async (req, res) => {
  try {
    console.log('📥 Recibiendo datos del formulario...');
    const data = req.body;

    if (!data.nombre || !data.apellidos) {
      return res.status(400).json({ 
        error: 'Los campos "nombre" y "apellidos" son obligatorios' 
      });
    }

    const folderName = `${data.nombre} ${data.apellidos}`;
    console.log(`📋 Procesando cliente: ${folderName}`);

    // ========== 1. GUARDAR EN POSTGRESQL ==========
    const obamacareQuery = `
      INSERT INTO polizas (
        fecha_registro, nombre, apellidos, sexo, correo, telefono, telefono2,
        fecha_nacimiento, estado_migratorio, ssn, ingresos, ocupacion,
        nacionalidad, aplica, cantidad_dependientes, direccion, casa_apartamento,
        condado, ciudad, estado, codigo_postal, po_box, compania, plan,
        credito_fiscal, prima, link, tipo_venta, operador, clave_seguridad,
        observaciones, dependents
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31, $32::jsonb
      )
      RETURNING id
    `;

    const obamacareValues = [
      data.fechaRegistro || null,
      data.nombre,
      data.apellidos,
      data.sexo || null,
      data.correo || null,
      data.telefono || null,
      data.telefono2 || null,
      data.fechaNacimiento || null,
      data.estadoMigratorio || null,
      data.ssn || null,
      data.ingresos || null,
      data.ocupacion || null,
      data.nacionalidad || null,
      data.aplica || null,
      parseInt(data.cantidadDependientes || 0),
      data.direccion || null,
      data.casaApartamento || null,
      data.condado || null,
      data.ciudad || null,
      data.estado || null,
      data.codigoPostal || null,
      data.poBox || null,
      data.compania || null,
      data.plan || null,
      data.creditoFiscal || null,
      data.prima || null,
      data.link || null,
      data.tipoVenta || null,
      data.operador || null,
      data.claveSeguridad || null,
      data.observaciones || null,
      JSON.stringify(data.dependents || [])
    ];

    const obamacareResult = await query(obamacareQuery, obamacareValues);
    const clientId = obamacareResult[0]?.id;

    if (!clientId) {
      throw new Error('No se pudo obtener el ID del cliente insertado');
    }

    console.log(`✅ Cliente guardado en PostgreSQL con ID: ${clientId}`);

    // ========== 2. GUARDAR EN GOOGLE SHEETS (CRÍTICO - CON REINTENTOS) ==========
    let sheetsSuccess = false;
    let sheetsError = null;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`📊 Intento ${attempt}/${MAX_RETRIES} de guardar en Google Sheets...`);

        const authClient = await getAuthenticatedClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const fechaRegistroUS = data.fechaRegistro || '';

        // Preparar datos de Obamacare para Sheets
        const obamacareData = [
          data.operador || '',
          fechaRegistroUS,
          data.tipoVenta || '',
          data.claveSeguridad || '',
          'Titular',
          data.nombre || '',
          data.apellidos || '',
          data.sexo || '',
          data.correo || '',
          data.telefono || '',
          data.telefono2 || '',
          data.fechaNacimiento || '',
          data.estadoMigratorio || '',
          data.ssn || '',
          cleanCurrency(data.ingresos) || '',
          data.ocupacion || '',
          data.nacionalidad || '',
          data.aplica || '',
          data.cantidadDependientes || '0',
          data.poBox ? `PO Box: ${data.poBox}` :
            `${data.direccion || ''}, ${data.casaApartamento || ''}, ${data.condado || ''}, ${data.ciudad || ''}, ${data.estado || ''}, ${data.codigoPostal || ''}`.replace(/,\s*,/g, ', ').replace(/,\s*$/, '').trim(),
          data.compania || '',
          data.plan || '',
          cleanCurrency(data.creditoFiscal) || '',
          cleanCurrency(data.prima) || '',
          data.link || '',
          data.observaciones || '',
          `CLI-${clientId}`,
        ];

        let obamacareRows = [obamacareData];

        // Añadir dependientes
        if (data.dependents && data.dependents.length > 0) {
          data.dependents.forEach(dep => {
            obamacareRows.push([
              data.operador || '',
              fechaRegistroUS,
              data.tipoVenta || '',
              data.claveSeguridad || '',
              dep.parentesco || '',
              dep.nombre || '',
              dep.apellido || '',
              '', '', '', '',
              dep.fechaNacimiento || '',
              dep.estadoMigratorio || '',
              dep.ssn || '',
              '', '', '',
              dep.aplica || '',
              '',
              '',
              '', '', '', '', '', '',
              `CLI-${clientId}`
            ]);
          });
        }

        // Enviar a Sheets
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME_OBAMACARE}!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: obamacareRows },
        });

        console.log(`✅ Datos guardados en Google Sheets (Obamacare) - Rango: ${response.data.updates.updatedRange}`);
        sheetsSuccess = true;
        break; // Salir del loop si fue exitoso

      } catch (error) {
        sheetsError = error;
        console.error(`❌ Error en intento ${attempt}/${MAX_RETRIES} guardando en Google Sheets:`, {
          message: error.message,
          code: error.code,
          status: error.status,
          details: error.errors || error.response?.data
        });

        // Si no es el último intento, esperar antes de reintentar
        if (attempt < MAX_RETRIES) {
          const waitTime = attempt * 1000; // 1s, 2s, 3s
          console.log(`⏳ Esperando ${waitTime}ms antes de reintentar...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // Si falló después de todos los intentos, registrar error crítico
    if (!sheetsSuccess) {
      console.error('🚨 ERROR CRÍTICO: No se pudo guardar en Google Sheets después de todos los intentos');
      console.error('Detalles del error:', sheetsError);
    }

    // ========== 3. GUARDAR PAGOS ==========
    if (data.metodoPago) {
      console.log(`💳 Guardando método de pago: ${data.metodoPago}`);
      
      const pagoQuery = `
        INSERT INTO pagos (
          client_id, metodo_pago, num_cuenta, num_ruta, nombre_banco,
          titular_cuenta, social_cuenta, num_tarjeta, fecha_vencimiento,
          cvc, titular_tarjeta, observaciones
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;

      const pagoValues = [
        clientId,
        data.metodoPago,
        data.pagoBanco?.numCuenta || null,
        data.pagoBanco?.numRuta || null,
        data.pagoBanco?.nombreBanco || null,
        data.pagoBanco?.titularCuenta || null,
        data.pagoBanco?.socialCuenta || null,
        data.pagoTarjeta?.numTarjeta || null,
        data.pagoTarjeta?.fechaVencimiento || null,
        data.pagoTarjeta?.cvc || null,
        data.pagoTarjeta?.titularTarjeta || null,
        data.pagoObservacionTarjeta || null
      ];

      await query(pagoQuery, pagoValues);
      console.log('✅ Datos de pago guardados en PostgreSQL');

      // Guardar en Google Sheets con reintentos
      let pagosSheetsSuccess = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`📊 Intento ${attempt}/${MAX_RETRIES} de guardar pagos en Google Sheets...`);

          const authClient = await getAuthenticatedClient();
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          let pagoData = [
            `CLI-${clientId}`,
            `${data.nombre} ${data.apellidos}`,
            data.telefono || '',
            data.metodoPago || '',
          ];

          const pagosObservaciones = data.pagoObservacionTarjeta || data.observaciones;

          if (data.metodoPago === "banco" && data.pagoBanco) {
            pagoData = pagoData.concat([
              data.pagoBanco.numCuenta || '',
              data.pagoBanco.numRuta || '',
              data.pagoBanco.nombreBanco || '',
              data.pagoBanco.titularCuenta || '',
              data.pagoBanco.socialCuenta || '',
              pagosObservaciones || '',
            ]);
          } else if (data.metodoPago === 'tarjeta' && data.pagoTarjeta) {
            pagoData = pagoData.concat([
              data.pagoTarjeta.numTarjeta || '',
              data.pagoTarjeta.fechaVencimiento || '',
              data.pagoTarjeta.titularTarjeta || '',
              data.pagoTarjeta.cvc || '',
              '',
              pagosObservaciones || '',
            ]);
          }

          const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME_PAGOS}!A1`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [pagoData] },
          });

          console.log(`✅ Datos de pago guardados en Google Sheets - Rango: ${response.data.updates.updatedRange}`);
          pagosSheetsSuccess = true;
          break;

        } catch (error) {
          console.error(`❌ Error en intento ${attempt}/${MAX_RETRIES} guardando pagos en Sheets:`, error.message);
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          } else {
            console.error('🚨 ERROR CRÍTICO: No se pudo guardar pagos en Google Sheets');
            sheetsSuccess = false; // Marcar que hubo error en Sheets
          }
        }
      }
    }

    // ========== 4. GUARDAR PLANES CIGNA ==========
    if (data.cignaPlans && Array.isArray(data.cignaPlans) && data.cignaPlans.length > 0) {
      console.log(`🏥 Guardando ${data.cignaPlans.length} plan(es) Cigna`);
      
      const cignaQuery = `
        INSERT INTO cigna_complementario (
          client_id, plan_tipo, cobertura_tipo, beneficio, deducible,
          prima, comentarios, beneficio_diario, beneficiario_nombre,
          beneficiario_fecha_nacimiento, beneficiario_direccion,
          beneficiario_relacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;

      for (const plan of data.cignaPlans) {
        const cignaValues = [
          clientId,
          plan.tipo || null,
          plan.coberturaTipo || null,
          plan.beneficio || null,
          plan.deducible || null,
          plan.prima || null,
          plan.comentarios || null,
          plan.beneficioDiario || null,
          plan.beneficiarioNombre || null,
          plan.beneficiarioFechaNacimiento || null,
          plan.beneficiarioDireccion || null,
          plan.beneficiarioRelacion || null
        ];

        await query(cignaQuery, cignaValues);
      }

      console.log(`✅ ${data.cignaPlans.length} plan(es) Cigna guardado(s) en PostgreSQL`);

      // Guardar en Google Sheets con reintentos
      let cignaSheetsSuccess = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`📊 Intento ${attempt}/${MAX_RETRIES} de guardar Cigna en Google Sheets...`);

          const authClient = await getAuthenticatedClient();
          const sheets = google.sheets({ version: 'v4', auth: authClient });

          const cignaValues = data.cignaPlans.map((p) => [
            `CLI-${clientId}`,
            new Date().toLocaleDateString('es-ES'),
            `${data.nombre} ${data.apellidos}`,
            data.telefono || '',
            data.sexo || '',
            data.fechaNacimiento || '',
            data.poBox ? `PO Box: ${data.poBox}` :
              `${data.direccion || ''}, ${data.casaApartamento || ''}, ${data.condado || ''}, ${data.ciudad || ''}, ${data.estado || ''}, ${data.codigoPostal || ''}`.replace(/,\s*,/g, ', ').replace(/,\s*$/, '').trim(),
            data.correo || '',
            data.estadoMigratorio || '',
            data.ssn || '',
            `${p.beneficiarioNombre || ''} / ${p.beneficiarioFechaNacimiento || ''} / ${p.beneficiarioDireccion || ''} / ${p.beneficiarioRelacion || ''}`,
            p.tipo || '',
            p.coberturaTipo || '',
            p.beneficio || '',
            cleanCurrency(p.beneficioDiario) || '',
            cleanCurrency(p.deducible) || '',
            cleanCurrency(p.prima) || '',
            p.comentarios || '',
          ]);

          const response = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME_CIGNA}!A1`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: cignaValues },
          });

          console.log(`✅ Datos de Cigna guardados en Google Sheets - Rango: ${response.data.updates.updatedRange}`);
          cignaSheetsSuccess = true;
          break;

        } catch (error) {
          console.error(`❌ Error en intento ${attempt}/${MAX_RETRIES} guardando Cigna en Sheets:`, error.message);
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          } else {
            console.error('🚨 ERROR CRÍTICO: No se pudo guardar Cigna en Google Sheets');
            sheetsSuccess = false; // Marcar que hubo error en Sheets
          }
        }
      }
    }

    // Preparar respuesta con información detallada
    const responseData = {
      success: true,
      clientId: clientId,
      folderName: folderName,
      message: sheetsSuccess
        ? 'Formulario procesado y guardado exitosamente en PostgreSQL y Google Sheets'
        : 'Formulario guardado en PostgreSQL. ADVERTENCIA: Hubo problemas al guardar en Google Sheets',
      stats: {
        dependientes: data.dependents?.length || 0,
        cignaPlans: data.cignaPlans?.length || 0,
        metodoPago: data.metodoPago || 'ninguno',
        savedTo: {
          postgresql: true,
          googleSheets: sheetsSuccess
        }
      }
    };

    // Si hubo error en Sheets, agregar advertencia
    if (!sheetsSuccess) {
      responseData.warning = 'Los datos se guardaron en la base de datos pero NO en Google Sheets. Por favor, contacte al administrador.';
      responseData.sheetsError = sheetsError?.message || 'Error desconocido';
    }

    return res.status(sheetsSuccess ? 201 : 207).json(responseData); // 207 = Multi-Status (éxito parcial)

  } catch (error) {
    console.error('❌ Error en /api/submit-form-data:', error.message);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({
      error: error.message || 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
  
});

// ==================== ENDPOINT: OBTENER POLÍTICAS (ADMIN) ====================
app.get('/api/policies', async (req, res) => {
  try {
    console.log('📊 Obteniendo listado de pólizas...');

    const policiesQuery = `
      SELECT 
        id as client_id,
        fecha_registro,
        nombre || ' ' || apellidos as nombre_completo,
        operador,
        compania,
        prima,
        telefono,
        correo,
        dependents as dependents_json,
        cantidad_dependientes
      FROM polizas
      ORDER BY fecha_registro DESC
      LIMIT 1000
    `;

    const policies = await query(policiesQuery);

    return res.json({
      success: true,
      data: policies,
      count: policies.length
    });

  } catch (error) {
    console.error('❌ Error obteniendo pólizas:', error);
    return res.status(500).json({
      error: 'Error obteniendo pólizas',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== MANEJO DE ERRORES 404 ====================
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method
  });
});

// ==================== MANEJO DE ERRORES GLOBAL ====================
app.use((error, req, res, next) => {
  console.error('❌ Error no capturado:', error);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: error.message
  });
});

// ==================== INICIAR SERVIDOR ====================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🚀 Servidor Backend Iniciado         ║
║   📍 Puerto: ${PORT}                    ║
║   🌍 Entorno: ${process.env.NODE_ENV || 'development'}     ║
║   📊 PostgreSQL: ✅                     ║
║   📈 Google Sheets: ${sheetsClient ? '✅' : '❌'}            ║
║   📁 Google Drive: ${driveClient ? '✅' : '❌'}             ║
║   ⏰ ${new Date().toLocaleString('es-ES')} ║
╚════════════════════════════════════════╝
  `);
});

export default app;
