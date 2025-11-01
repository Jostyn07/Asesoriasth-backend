import express from 'express';
import { query } from '../db.js';

const router = express.Router();

// ==================== GUARDAR BORRADOR ====================
router.post('/save', async (req, res) => {
  try {
    console.log('💾 Guardando borrador...');
    
    const draftData = req.body;

    // Validación básica
    if (!draftData || typeof draftData !== 'object') {
      return res.status(400).json({ 
        error: 'Datos de borrador inválidos' 
      });
    }

    // Generar ID único si no existe
    const draftId = draftData.draftId || `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const timestamp = new Date().toISOString();

    // Preparar datos para inserción
    const insertQuery = `
      INSERT INTO borrador (
        draft_id,
        timestamp,
        nombre,
        apellidos,
        telefono,
        correo,
        fecha_nacimiento,
        estado_migratorio,
        ssn,
        ingresos,
        ocupacion,
        nacionalidad,
        direccion,
        ciudad,
        estado,
        codigo_postal,
        compania,
        plan,
        operador,
        data_completa,
        estado_borrador
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21
      )
      ON CONFLICT (draft_id) 
      DO UPDATE SET
        timestamp = EXCLUDED.timestamp,
        nombre = EXCLUDED.nombre,
        apellidos = EXCLUDED.apellidos,
        telefono = EXCLUDED.telefono,
        correo = EXCLUDED.correo,
        fecha_nacimiento = EXCLUDED.fecha_nacimiento,
        estado_migratorio = EXCLUDED.estado_migratorio,
        ssn = EXCLUDED.ssn,
        ingresos = EXCLUDED.ingresos,
        ocupacion = EXCLUDED.ocupacion,
        nacionalidad = EXCLUDED.nacionalidad,
        direccion = EXCLUDED.direccion,
        ciudad = EXCLUDED.ciudad,
        estado = EXCLUDED.estado,
        codigo_postal = EXCLUDED.codigo_postal,
        compania = EXCLUDED.compania,
        plan = EXCLUDED.plan,
        operador = EXCLUDED.operador,
        data_completa = EXCLUDED.data_completa
      RETURNING id, draft_id
    `;

    const values = [
      draftId,
      timestamp,
      draftData.nombre || null,
      draftData.apellidos || null,
      draftData.telefono || null,
      draftData.correo || null,
      draftData.fechaNacimiento || null,
      draftData.estadoMigratorio || null,
      draftData.ssn || null,
      draftData.ingresos || null,
      draftData.ocupacion || null,
      draftData.nacionalidad || null,
      draftData.direccion || null,
      draftData.ciudad || null,
      draftData.estado || null,
      draftData.codigoPostal || null,
      draftData.compania || null,
      draftData.plan || null,
      draftData.operador || null,
      JSON.stringify(draftData), // ✅ Guardar JSON completo
      'Activo'
    ];

    const result = await query(insertQuery, values);

    console.log(`✅ Borrador guardado: ${draftId}`);

    return res.status(200).json({
      success: true,
      draftId: draftId,
      dbId: result[0]?.id,
      message: 'Borrador guardado exitosamente',
      timestamp: timestamp,
      stats: {
        dependientes: draftData.dependents?.length || 0,
        cignaPlans: draftData.cignaPlans?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ Error guardando borrador:', error);
    return res.status(500).json({ 
      error: 'Error al guardar borrador',
      message: error.message 
    });
  }
});

// ==================== OBTENER BORRADOR ====================
router.get('/load/:draftId', async (req, res) => {
  try {
    const { draftId } = req.params;
    
    console.log(`📂 Cargando borrador: ${draftId}`);

    const selectQuery = `
      SELECT * FROM borrador 
      WHERE draft_id = $1 AND estado_borrador = 'Activo'
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const result = await query(selectQuery, [draftId]);

    if (result.length === 0) {
      return res.status(404).json({ 
        error: 'Borrador no encontrado' 
      });
    }

    const draft = result[0];

    return res.json({
      success: true,
      draft: draft.data_completa,
      metadata: {
        draftId: draft.draft_id,
        timestamp: draft.timestamp,
        nombre: draft.nombre,
        apellidos: draft.apellidos
      }
    });

  } catch (error) {
    console.error('❌ Error cargando borrador:', error);
    return res.status(500).json({ 
      error: 'Error al cargar borrador',
      message: error.message 
    });
  }
});

// ==================== LISTAR BORRADORES ACTIVOS ====================
router.get('/list', async (req, res) => {
  try {
    console.log('📋 Listando borradores activos...');

    const selectQuery = `
      SELECT 
        id, draft_id, timestamp, nombre, apellidos, 
        telefono, correo, estado_borrador
      FROM borrador 
      WHERE estado_borrador = 'Activo'
      ORDER BY timestamp DESC
      LIMIT 100
    `;

    const result = await query(selectQuery);

    return res.json({
      success: true,
      count: result.length,
      drafts: result
    });

  } catch (error) {
    console.error('❌ Error listando borradores:', error);
    return res.status(500).json({ 
      error: 'Error al listar borradores',
      message: error.message 
    });
  }
});

// ==================== ELIMINAR BORRADOR ====================
router.delete('/delete/:draftId', async (req, res) => {
  try {
    const { draftId } = req.params;
    
    console.log(`🗑️ Eliminando borrador: ${draftId}`);

    // Marcar como eliminado (soft delete) en lugar de borrar
    const updateQuery = `
      UPDATE borrador 
      SET estado_borrador = 'Eliminado'
      WHERE draft_id = $1
      RETURNING id
    `;

    const result = await query(updateQuery, [draftId]);

    if (result.length === 0) {
      return res.status(404).json({ 
        error: 'Borrador no encontrado' 
      });
    }

    console.log(`✅ Borrador eliminado: ${draftId}`);

    return res.json({
      success: true,
      message: 'Borrador eliminado exitosamente',
      draftId: draftId
    });

  } catch (error) {
    console.error('❌ Error eliminando borrador:', error);
    return res.status(500).json({ 
      error: 'Error al eliminar borrador',
      message: error.message 
    });
  }
});

export default router;