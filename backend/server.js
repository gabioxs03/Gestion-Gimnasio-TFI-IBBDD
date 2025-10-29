const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
const port = 3000; // El puerto donde correrá tu backend (ajustado a 3000)

// Middlewares
app.use(cors()); // Permite peticiones desde cualquier origen (tu frontend)
app.use(express.json()); // Permite al servidor entender JSON en el cuerpo de las peticiones (para inscribir)

// --- CONFIGURACIÓN DE LA BASE DE DATOS ---
// ¡IMPORTANTE! Reemplaza estos valores con los de tu servidor SQL Server.
const dbConfig = {
    user: 'gimnasio_user',           // El usuario que creaste en el Paso 2
    password: 'P@ssw0rdG1m',         // La contraseña que definiste en el Paso 2
    server: 'localhost',             // Usar localhost es más estándar y robusto que el nombre de la máquina
    port: 1433,                     // El puerto dinámico que encontraste. ¡Correcto!
    database: 'DB_TFI_GestionGim',   // El nombre correcto de tu base de datos
    options: {
        encrypt: true, // Para Azure SQL, puede ser necesario
        trustServerCertificate: true, // Cambia a false para producción con un certificado válido
    }
};

// Crear un pool de conexiones. Es más eficiente que conectar/desconectar en cada petición.
const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect();

pool.on('error', err => {
    console.error('Error en el Pool de Conexiones SQL:', err);
});

// --- ENDPOINTS DE LA API ---

/**
 * Endpoint para obtener todas las clases disponibles.
 * GET /api/clases
 */
app.get('/api/clases', async (req, res) => {    
    try {
        // Asegurarse de que el pool esté conectado antes de usarlo
        await poolConnect; 
        // Usar el pool para ejecutar la consulta
        const result = await pool.request().query("SELECT ClaseID as id, Nombre as nombre, CONVERT(VARCHAR(5), Horario, 108) as descripcion FROM Clase");
        res.json(result.recordset);
    } catch (err) {
        console.error('Error en la base de datos:', err);
        res.status(500).json({ message: 'Error al obtener las clases' });
    }
});

/**
 * Endpoint para buscar un socio por ID y obtener sus inscripciones.
 * GET /api/socios/:id
 */
app.get('/api/socios/:id', async (req, res) => {
    const socioIdBuscado = req.params.id;
    try {
        await poolConnect;
        // Consulta que une Socios, Inscripciones y Clases para obtener toda la info
        const result = await pool.request().input('socioId', sql.Int, socioIdBuscado).query(`
            SELECT 
                S.SocioID, S.Nombre, S.Apellido, S.Email, -- Columnas de Socio
                C.ClaseID, C.Nombre as claseNombre, CONVERT(VARCHAR(5), C.Horario, 108) as claseDescripcion -- Columnas de Clase con alias en minúscula
            FROM Socio S
            LEFT JOIN Inscripcion I ON S.SocioID = I.SocioID
            LEFT JOIN Clase C ON I.ClaseID = C.ClaseID
            WHERE S.SocioID = @socioId`);

        if (result.recordset.length > 0) {
            // El socio existe. Ahora formateamos la respuesta como la esperaba el frontend.
            const socioInfo = result.recordset[0];
            const socio = {
                id: socioInfo.SocioID,
                nombre: `${socioInfo.Nombre} ${socioInfo.Apellido}`,
                email: socioInfo.Email,
                // Creamos el array de inscripciones a partir del resultado del JOIN
                inscripciones: result.recordset
                    .filter(r => r.ClaseID !== null) // Filtramos en caso de que el socio no tenga inscripciones
                    .map(r => ({ 
                        id: r.ClaseID, 
                        nombre: r.claseNombre, 
                        descripcion: r.claseDescripcion 
                    }))
            };
            res.json(socio);
        } else {
            res.status(404).json({ message: 'Socio no encontrado' });
        }
    } catch (err) {
        console.error('Error en la base de datos:', err);
        res.status(500).json({ message: 'Error al consultar la base de datos' });
    }
});

/**
 * Endpoint para dar de baja (lógica) a un socio.
 * DELETE /api/socios/:id
 * Esto activará el trigger TR_BajaLogica_Socio
 */
app.delete('/api/socios/:id', async (req, res) => {
    const socioId = req.params.id;
    try {
        await poolConnect;
        const result = await pool.request()
            .input('socioId', sql.Int, socioId)
            .query('DELETE FROM Socio WHERE SocioID = @socioId');

        // El trigger INSTEAD OF hace que rowsAffected sea 0, pero la operación es exitosa.
        // El trigger actualiza la fila, por lo que podemos confiar en que funcionó si no hay error.
        res.status(200).json({ message: `Socio con ID ${socioId} ha sido dado de baja (inactivado).` });

    } catch (err) {
        console.error('Error en la base de datos al dar de baja al socio:', err);
        res.status(500).json({ message: 'Error al procesar la baja del socio.' });
    }
});

/**
 * Endpoint para inscribir un socio a una clase.
 * POST /api/inscripciones
 */
app.post('/api/inscripciones', async (req, res) => {
    const { socioId, claseId } = req.body; // Recibimos los IDs desde el frontend

    if (!socioId || !claseId) {
        return res.status(400).json({ message: 'Faltan socioId o claseId' });
    }

    try {
        await poolConnect;
        // Ejecutamos el Stored Procedure que maneja la lógica de inscripción y cupos
        const result = await pool.request()
            .input('socioId', sql.Int, socioId)
            .input('claseId', sql.Int, claseId)
            .execute('SP_InscribirSocioEnClase');
        
        // El Stored Procedure devuelve un resultado con Mensaje y CodigoError
        const spResult = result.recordset[0];

        if (spResult.CodigoError === 0) {
            // Éxito
            res.status(201).json({ message: spResult.Mensaje });
        } else {
            // Error de lógica de negocio (sin cupos, ya inscripto, etc.)
            // Usamos 409 Conflict para indicar que la petición no se pudo procesar por el estado actual del recurso.
            res.status(409).json({ message: spResult.Mensaje });
        }
    } catch (err) {
        console.error('Error inesperado al ejecutar el Stored Procedure:', err);
        res.status(500).json({ message: 'Error al procesar la inscripción' });
    }
});

/**
 * Endpoint para dar de baja una inscripción de un socio a una clase.
 * DELETE /api/inscripciones
 */
app.delete('/api/inscripciones', async (req, res) => {
    const { socioId, claseId } = req.body;

    if (!socioId || !claseId) {
        return res.status(400).json({ message: 'Faltan socioId o claseId en el cuerpo de la petición.' });
    }

    try {
        await poolConnect;
        const request = pool.request();

        // 1. Eliminar la inscripción
        const resultDelete = await request
            .input('socioId', sql.Int, socioId)
            .input('claseId', sql.Int, claseId)
            .query('DELETE FROM Inscripcion WHERE SocioID = @socioId AND ClaseID = @claseId');

        if (resultDelete.rowsAffected[0] > 0) {
            // El trigger TR_ActualizarCupos_BajaInscripcion se encarga de liberar el cupo.
            res.status(200).json({ message: 'Inscripción dada de baja correctamente.' });
        } else {
            // Si no se afectaron filas, es porque la inscripción no existía.
            res.status(404).json({ message: 'No se encontró la inscripción para dar de baja.' });
        }
    } catch (err) {
        console.error('Error en la base de datos al dar de baja la inscripción:', err);
        res.status(500).json({ message: 'Error al procesar la baja de la inscripción.' });
    }
});


// Inicia el servidor
app.listen(port, async () => {
    try {
        await poolConnect;
        console.log("✅ Conexión con la base de datos establecida.");
        console.log(`🚀 Servidor backend escuchando en http://localhost:${port}`);
    } catch (err) {
        console.error("❌ ERROR: No se pudo conectar a la base de datos al iniciar el servidor.", err);
    }
});