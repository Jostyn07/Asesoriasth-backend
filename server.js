import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import { query } from './db.js';
import draftRoutes from './routes/draftRoutes.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
    timestamp: new Date().toISOString()
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

    // Consultar usuario en la base de datos
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

    // Verificar si la contraseña almacenada es un hash de bcrypt
    const isHashedPassword = user.password && user.password.startsWith('$2');

    let passwordValid = false;

    if (isHashedPassword) {
      // Comparar con bcrypt si es un hash
      passwordValid = await bcrypt.compare(password, user.password);
    } else {
      // Comparación directa para contraseñas no hasheadas (temporal)
      passwordValid = user.password === password;
    }

    if (!passwordValid) {
      console.log(`❌ Contraseña incorrecta para: ${email}`);
      return res.status(401).json({ 
        error: 'Credenciales inválidas' 
      });
    }

    console.log(`✅ Login exitoso: ${user.nombre} (${user.rol})`);

    // Generar token simple (en producción usa JWT)
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

    // Validación básica
    if (!data.nombre || !data.apellidos) {
      return res.status(400).json({ 
        error: 'Los campos "nombre" y "apellidos" son obligatorios' 
      });
    }

    const folderName = `${data.nombre} ${data.apellidos}`;
    console.log(`📋 Procesando cliente: ${folderName}`);

    // 1. Insertar datos principales en pólizas (Obamacare)
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

    console.log(`✅ Cliente guardado con ID: ${clientId}`);

    // 2. Insertar datos de pago si existen
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
      console.log('✅ Datos de pago guardados');
    }

    // 3. Insertar planes Cigna si existen
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
        metodoPago: data.metodoPago || 'ninguno'
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
║   ⏰ Fecha: ${new Date().toLocaleString('es-ES')} ║
╚════════════════════════════════════════╝
  `);
});

export default app;
