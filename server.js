import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import { google } from 'googleapis';
import { query } from './db.js';
import draftRoutes from './routes/draftRoutes.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURACIÓN GOOGLE SHEETS ====================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1T8YifEIUU7a6ugf_Xn5_1edUUMoYfM9loDuOQU1u2-8";
const SHEET_NAME_OBAMACARE = "Pólizas";
const SHEET_NAME_CIGNA = "Cigna Complementario";
const SHEET_NAME_PAGOS = "Pagos";

// Configurar autenticación con Service Account
let sheetsClient = null;

async function initGoogleSheets() {
  try {
    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY 
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
      : null;

    if (!credentials) {
      console.warn('⚠️ No se encontraron credenciales de Google. Sheets deshabilitado.');
      return null;
    }

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ],
    });

    const authClient = await auth.getClient();
    sheetsClient = google.sheets({ version: 'v4', auth: authClient });
    
    console.log('✅ Google Sheets API inicializada correctamente');
    return sheetsClient;
  } catch (error) {
    console.error('❌ Error inicializando Google Sheets:', error.message);
    return null;
  }
}

// Inicializar al arrancar
initGoogleSheets();

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

    console.log(`✅ Datos agregados a ${sheetName}:`, response.data.updates);
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
      googleSheets: sheetsClient !== null
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

    const userQuery = `
      SELECT id, nombre, email, password, rol 
      FROM usuarios 
      WHERE email = $1
    `;
    
    const users = await query(userQuery, [email]);

    if (users.length === 0) {
      console.log(`❌ Usuario no encontrado: ${email}`);
      return res.status(401).json({ 
        error: 'Credenciales inválidas' 
      });
    }

    const user = users[0];

    const isHashedPassword = user.password && user.password.startsWith('$2');
    let passwordValid = false;

    if (isHashedPassword) {
      passwordValid = await bcrypt.compare(password, user.password);
    } else {
      passwordValid = user.password === password;
    }

    if (!passwordValid) {
      console.log(`❌ Contraseña incorrecta para: ${email}`);
      return res.status(401).json({ 
        error: 'Credenciales inválidas' 
      });
    }

    console.log(`✅ Login exitoso: ${user.nombre} (${user.rol})`);

    const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');

    return res.json({
      success: true,
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
      error: 'Error interno del servidor',
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

    // ========== 2. GUARDAR EN GOOGLE SHEETS ==========
    if (sheetsClient) {
      try {
        // Preparar fila para Obamacare
        const obamacareRow = [
          data.fechaRegistro || '',
          data.nombre || '',
          data.apellidos || '',
          data.sexo || '',
          data.correo || '',
          data.telefono || '',
          data.telefono2 || '',
          data.fechaNacimiento || '',
          data.estadoMigratorio || '',
          data.ssn || '',
          data.ingresos || '',
          data.ocupacion || '',
          data.nacionalidad || '',
          data.aplica || '',
          data.cantidadDependientes || '0',
          data.direccion || '',
          data.casaApartamento || '',
          data.condado || '',
          data.ciudad || '',
          data.estado || '',
          data.codigoPostal || '',
          data.poBox || '',
          data.compania || '',
          data.plan || '',
          data.creditoFiscal || '',
          data.prima || '',
          data.link || '',
          data.tipoVenta || '',
          data.operador || '',
          data.claveSeguridad || '',
          data.observaciones || ''
        ];

        await appendToSheet(SHEET_NAME_OBAMACARE, obamacareRow);
        console.log('✅ Datos guardados en Google Sheets (Obamacare)');
      } catch (sheetsError) {
        console.error('⚠️ Error guardando en Sheets (continuando):', sheetsError.message);
      }
    }

    // ========== 3. GUARDAR PAGOS ==========
    if (data.metodoPago) {
      console.log(`💳 Guardando método de pago: ${data.metodoPago}`);
      
      // PostgreSQL
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

      // Google Sheets
      if (sheetsClient) {
        try {
          const pagoRow = [
            clientId,
            data.nombre || '',
            data.apellidos || '',
            data.metodoPago || '',
            data.pagoBanco?.numCuenta || '',
            data.pagoBanco?.numRuta || '',
            data.pagoBanco?.nombreBanco || '',
            data.pagoBanco?.titularCuenta || '',
            data.pagoBanco?.socialCuenta || '',
            data.pagoTarjeta?.numTarjeta || '',
            data.pagoTarjeta?.fechaVencimiento || '',
            data.pagoTarjeta?.cvc || '',
            data.pagoTarjeta?.titularTarjeta || '',
            data.pagoObservacionTarjeta || ''
          ];

          await appendToSheet(SHEET_NAME_PAGOS, pagoRow);
          console.log('✅ Datos de pago guardados en Google Sheets');
        } catch (sheetsError) {
          console.error('⚠️ Error guardando pagos en Sheets:', sheetsError.message);
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
        // PostgreSQL
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

        // Google Sheets
        if (sheetsClient) {
          try {
            const cignaRow = [
              clientId,
              data.nombre || '',
              data.apellidos || '',
              plan.tipo || '',
              plan.coberturaTipo || '',
              plan.beneficio || '',
              plan.deducible || '',
              plan.prima || '',
              plan.comentarios || '',
              plan.beneficioDiario || '',
              plan.beneficiarioNombre || '',
              plan.beneficiarioFechaNacimiento || '',
              plan.beneficiarioDireccion || '',
              plan.beneficiarioRelacion || ''
            ];

            await appendToSheet(SHEET_NAME_CIGNA, cignaRow);
          } catch (sheetsError) {
            console.error('⚠️ Error guardando plan Cigna en Sheets:', sheetsError.message);
          }
        }
      }

      console.log(`✅ ${data.cignaPlans.length} plan(es) Cigna guardado(s)`);
    }

    return res.status(201).json({
      success: true,
      clientId: clientId,
      folderName: folderName,
      message: 'Formulario procesado exitosamente',
      stats: {
        dependientes: data.dependents?.length || 0,
        cignaPlans: data.cignaPlans?.length || 0,
        metodoPago: data.metodoPago || 'ninguno',
        savedTo: {
          postgresql: true,
          googleSheets: sheetsClient !== null
        }
      }
    });

  } catch (error) {
    console.error('❌ Error en /api/submit-form-data:', error.message);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({
      error: error.message || 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
║   ⏰ ${new Date().toLocaleString('es-ES')} ║
╚════════════════════════════════════════╝
  `);
});

export default app;
