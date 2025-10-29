document.addEventListener('DOMContentLoaded', async () => {
    const pagina = window.location.pathname.split("/").pop();

    // URL de tu API de backend
    const API_URL = 'http://localhost:3000';
    let todasLasClases = []; // Almacenaremos todas las clases aquí
    let socioActual = null; // Almacenaremos el socio consultado

    // --- LÓGICA PARA EL PANEL PRINCIPAL (index.html) ---
    if (pagina === 'index.html' || pagina === '') { // Se ejecuta solo en la página principal
        const consultaForm = document.getElementById('consulta-socio-form');
        const panelSocio = document.getElementById('panel-socio');
        const socioIdInput = document.getElementById('socio-id');
        
        // Cargar todas las clases al iniciar la página desde el backend
        try {
            const response = await fetch(`${API_URL}/api/clases`);
            if (!response.ok) throw new Error('No se pudieron cargar las clases.');
            todasLasClases = await response.json();
        } catch (error) {
            console.error('Error al cargar clases:', error);
            alert('Error de conexión con el servidor. No se pueden mostrar las clases.');
        }

        consultaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const idBuscado = socioIdInput.value;
            try {
                const response = await fetch(`${API_URL}/api/socios/${idBuscado}`);
                if (!response.ok) throw new Error('Socio no encontrado');
                socioActual = await response.json(); // Guardamos el socio en la variable global
                document.getElementById('socio-nombre').textContent = `${socioActual.nombre}`;
                panelSocio.classList.remove('hidden');
                actualizarPanel(socioActual);
            } catch (error) {
                alert('Socio no encontrado. Por favor, verifica el ID ingresado.');
                panelSocio.classList.add('hidden');
            }
        });

        /**
         * Actualiza las listas de clases inscritas y disponibles para un socio.
         */
        function actualizarPanel(socio) {
            const listaInscripciones = document.getElementById('lista-inscripciones');
            const disponiblesContainer = document.getElementById('disponibles-container');

            // Limpiar vistas anteriores
            listaInscripciones.innerHTML = '';
            disponiblesContainer.innerHTML = '';

            // 1. Llenar la lista de "Tus Clases Inscritas"
            if (socio.inscripciones.length > 0) {
                socio.inscripciones.forEach(claseInscrita => {
                    const li = document.createElement('li');
                    li.textContent = `${claseInscrita.nombre} - ${claseInscrita.descripcion}`;
                    listaInscripciones.appendChild(li);
                });
            } else {
                listaInscripciones.innerHTML = '<li>Aún no se inscribió a ninguna clase.</li>';
            }

            // 2. Llenar las "Clases Disponibles"
            const idsClasesInscritas = socio.inscripciones.map(c => c.id);
            const clasesDisponibles = todasLasClases.filter(clase => !idsClasesInscritas.includes(clase.id));
            
            if (clasesDisponibles.length > 0) {
                clasesDisponibles.forEach(clase => {
                    const card = document.createElement('div');
                    card.className = 'clase-card';
                    card.innerHTML = `
                        <h3>${clase.nombre}</h3>
                        <p>${clase.descripcion}</p>
                        <button class="btn btn-inscribir" data-clase-id="${clase.id}">Inscribir</button>
                    `;
                    disponiblesContainer.appendChild(card);
                });
            } else {
                disponiblesContainer.innerHTML = '<p>Se encuentra inscripto en todas las clases disponibles.</p>';
            }
        }

        // 3. Manejar clic en "Inscribirme" usando delegación de eventos
        panelSocio.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-inscribir')) {
                const claseId = parseInt(e.target.getAttribute('data-clase-id'));
                
                if (socioActual) {
                    try {
                        const response = await fetch(`${API_URL}/api/inscripciones`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ socioId: socioActual.id, claseId: claseId })
                        });

                        const result = await response.json();

                        if (!response.ok) {
                            throw new Error(result.message || 'Error al inscribir');
                        }

                        alert('¡Inscripción exitosa!');
                        // Disparamos el submit del formulario de nuevo para recargar los datos del socio desde el backend
                        consultaForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    } catch (error) {
                        alert(`Error: ${error.message}`);
                    }
                }
            }

            // Manejar clic en "Dar de Baja Socio"
            if (e.target.id === 'btn-baja-socio') {
                if (socioActual && confirm(`¿Estás seguro de que quieres dar de baja al socio ${socioActual.nombre}? Esta acción no se puede deshacer.`)) {
                    try {
                        const response = await fetch(`${API_URL}/api/socios/${socioActual.id}`, {
                            method: 'DELETE'
                        });

                        const result = await response.json();
                        if (!response.ok) throw new Error(result.message);

                        alert(result.message);
                        // Ocultamos el panel y reseteamos el formulario
                        panelSocio.classList.add('hidden');
                        consultaForm.reset();
                        socioActual = null;

                    } catch (error) {
                        alert(`Error: ${error.message}`);
                    }
                }
            }
        });
    }
    else if (pagina === 'register.html') {
        // implementar la logica para registrar un nuevo socio en register.html
        const registroForm = document.getElementById('registro-socio-form');
        registroForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nombre = document.getElementById('nombre').value;
            const apellido = document.getElementById('apellido').value;
            const email = document.getElementById('email').value;

            try {
                const response = await fetch(`${API_URL}/api/socios`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, apellido, email })
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.message);
                }

                alert('¡Socio registrado con éxito!');
                registroForm.reset();

            } catch (error) {
                alert(`Error al registrar: ${error.message}`);
            }
        });
    }

});