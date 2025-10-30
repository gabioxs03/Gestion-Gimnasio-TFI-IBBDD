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
    server: 'localhost\\SQLEXPRESS', // Ajusta si usas instancia diferente
    // Si usas puerto explícito, descomenta y coloca el puerto correcto:
    // port: 1433,
    database: 'DB_TFI_GestionGim',   // El nombre correcto de tu base de datos
    options: {
        // trustedConnection: true,
        // encrypt: true, // Para Azure SQL, puede ser necesario
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
        await poolConnect; 
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
        const result = await pool.request().input('socioId', sql.Int, socioIdBuscado).query(`
            SELECT 
                S.SocioID, S.Nombre, S.Apellido, S.Email,
                C.ClaseID, C.Nombre as claseNombre, CONVERT(VARCHAR(5), C.Horario, 108) as claseDescripcion
            FROM Socio S
            LEFT JOIN Inscripcion I ON S.SocioID = I.SocioID
            LEFT JOIN Clase C ON I.ClaseID = C.ClaseID
            WHERE S.SocioID = @socioId`);

        if (result.recordset.length > 0) {
            const socioInfo = result.recordset[0];
            const socio = {
                id: socioInfo.SocioID,
                nombre: `${socioInfo.Nombre} ${socioInfo.Apellido}`,
                email: socioInfo.Email,
                inscripciones: result.recordset
                    .filter(r => r.ClaseID !== null)
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
 * Esto activará el trigger TR_BajaLogica_Socio y liberará cupos vía triggers en Inscripcion.
 */
app.delete('/api/socios/:id', async (req, res) => {
    const socioId = req.params.id;
    try {
        await poolConnect;

        // Usamos transacción para asegurar consistencia al borrar inscripciones y dar de baja al socio.
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = new sql.Request(transaction);

        try {
            // 1. Borrar todas las inscripciones del socio (dispara trigger para actualizar cupos).
            await request.input('socioIdInsc', sql.Int, socioId)
                .query('DELETE FROM Inscripcion WHERE SocioID = @socioIdInsc');

            // 2. Dar de baja lógica al socio (trigger INSTEAD OF o similar).
            await request.input('socioIdSocio', sql.Int, socioId)
                .query('DELETE FROM Socio WHERE SocioID = @socioIdSocio');

            await transaction.commit();

            res.status(200).json({ message: `Socio con ID ${socioId} ha sido dado de baja y sus inscripciones han sido canceladas.` });
        } catch (err) {
            await transaction.rollback();
            console.error('Error en la transacción de baja de socio:', err);
            res.status(500).json({ message: 'Error al procesar la baja del socio.' });
        }

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
    const { socioId, claseId } = req.body;

    if (!socioId || !claseId) {
        return res.status(400).json({ message: 'Faltan socioId o claseId' });
    }

    try {
        await poolConnect;
        const result = await pool.request()
            .input('socioId', sql.Int, socioId)
            .input('claseId', sql.Int, claseId)
            .execute('SP_InscribirSocioEnClase');
        
        const spResult = result.recordset && result.recordset[0];

        if (spResult && spResult.CodigoError === 0) {
            res.status(201).json({ message: spResult.Mensaje });
        } else if (spResult) {
            res.status(409).json({ message: spResult.Mensaje });
        } else {
            res.status(500).json({ message: 'Stored procedure no devolvió resultado esperado.' });
        }
    } catch (err) {
        console.error('Error inesperado al ejecutar el Stored Procedure:', err);
        res.status(500).json({ message: 'Error al procesar la inscripción' });
    }
});

/**
 * Endpoint para dar de baja una inscripción de un socio a una clase.
 * DELETE /api/inscripciones
 * Esto activará el trigger TR_ActualizarCupos_BajaInscripcion
 */
app.delete('/api/inscripciones', async (req, res) => {
    const { socioId, claseId } = req.body;

    if (!socioId || !claseId) {
        return res.status(400).json({ message: 'Faltan socioId o claseId en el cuerpo de la petición.' });
    }

    try {
        await poolConnect;
        const request = pool.request();

        const resultDelete = await request
            .input('socioId', sql.Int, socioId)
            .input('claseId', sql.Int, claseId)
            .query('DELETE FROM Inscripcion WHERE SocioID = @socioId AND ClaseID = @claseId');

        if (resultDelete.rowsAffected && resultDelete.rowsAffected[0] > 0) {
            // El trigger TR_ActualizarCupos_BajaInscripcion se encarga de liberar el cupo.
            res.status(200).json({ message: 'Inscripción dada de baja correctamente.' });
        } else {
            res.status(404).json({ message: 'No se encontró la inscripción para dar de baja.' });
        }
    } catch (err) {
        console.error('Error en la base de datos al dar de baja la inscripción:', err);
        res.status(500).json({ message: 'Error al procesar la baja de la inscripción.' });
    }
});

/*
 * Endpoint para registrar un nuevo socio.
 * POST /api/socios
 */
app.post('/api/socios', async (req, res) => {
    const { nombre, apellido, email } = req.body;
    if (!nombre || !apellido || !email) {
        return res.status(400).json({ message: 'Faltan datos obligatorios: nombre, apellido o email' });
    }
    try {
        await poolConnect;
        const result = await pool.request()
            .input('nombre', sql.VarChar(50), nombre)
            .input('apellido', sql.VarChar(50), apellido)
            .input('email', sql.VarChar(100), email)
            .query(`
                INSERT INTO Socio (Nombre, Apellido, Email, Activo)
                VALUES (@nombre, @apellido, @email, 1);
                SELECT SCOPE_IDENTITY() AS nuevoSocioId; -- Obtener el ID del nuevo socio
            `);
        const nuevoSocioId = result.recordset[0] && result.recordset[0].nuevoSocioId;
        if (nuevoSocioId) {
            res.status(201).json({ message: 'Socio registrado exitosamente', socioId: nuevoSocioId });
        } else {
            res.status(500).json({ message: 'Error al obtener el ID del nuevo socio' });
        }
    } catch (error) {
        console.error('Error al registrar socio:', error);
        res.status(500).json({ message: 'Error al registrar socio' });
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