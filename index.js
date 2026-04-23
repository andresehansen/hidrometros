// index.js - Versión Alta Disponibilidad con Fallback INA y Fechas

const urlLaPlata = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";
const urlClima = "https://api.open-meteo.com/v1/forecast?latitude=-34.8339&longitude=-57.8803&current_weather=true&timezone=America/Argentina/Buenos_Aires";
const urlPronostico = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";
const urlIguazu = "https://hidrografia2.agpse.gob.ar/histdat/PUERTO_IGUAZU.dat";
const urlConcordia = "http://190.0.152.194:8080/alturas/web/user/alturas";

// --- FUNCIONES AUXILIARES ---
function gradosACardinal(grados) {
    const direcciones = ['Norte (N)', 'Noreste (NE)', 'Este (E)', 'Sureste (SE)', 'Sur (S)', 'Suroeste (SW)', 'Oeste (W)', 'Noroeste (NW)'];
    return direcciones[Math.round(grados / 45) % 8];
}

// Devuelve fecha formato YYYY-MM-DD para la API del INA
function formatoFechaAPI(fecha) {
    return `${fecha.getFullYear()}-${(fecha.getMonth()+1).toString().padStart(2, '0')}-${fecha.getDate().toString().padStart(2, '0')}`;
}

// Calcula si la diferencia entre ahora y una fecha es mayor a 24 horas
function esAntiguo(fechaMedicion) {
    const ahora = new Date();
    const diferenciaHoras = Math.abs(ahora - fechaMedicion) / 36e5;
    return diferenciaHoras > 24;
}

// Lógica de respaldo: Consulta la API oficial del INA para Concordia
async function obtenerFallbackINA() {
    try {
        console.log("Activando Plan B: Consultando API del INA para Concordia...");
        const hoy = new Date();
        const ayer = new Date(hoy);
        ayer.setDate(hoy.getDate() - 2); // Pedimos últimos 2 días por si acaso

        // siteCode=79 (Concordia) | varId=2 (Altura Hidrométrica)
        const urlINA = `https://alerta.ina.gob.ar/pub/datos/datos?timeStart=${formatoFechaAPI(ayer)}&timeEnd=${formatoFechaAPI(hoy)}&siteCode=79&varId=2&format=json`;
        
        const res = await fetch(urlINA);
        if (!res.ok) throw new Error("INA no respondió");
        
        const data = await res.json();
        // Buscar el último registro válido
        if (data && data.length > 0) {
            // El INA suele devolver los datos al final o principio del array. Asumimos el último como el más reciente.
            const ultimoRegistro = data[data.length - 1]; 
            const fechaINA = new Date(ultimoRegistro.timestart);
            
            // Formatear la fecha para nuestro mensaje
            const dia = fechaINA.getDate().toString().padStart(2, '0');
            const mes = (fechaINA.getMonth()+1).toString().padStart(2, '0');
            const anio = fechaINA.getFullYear();
            const hora = fechaINA.getHours().toString().padStart(2, '0') + ":" + fechaINA.getMinutes().toString().padStart(2, '0');
            
            let advertencia = esAntiguo(fechaINA) ? " ⚠️ (Dato desactualizado)" : " *(Fuente: INA)*";
            
            return {
                altura: `${parseFloat(ultimoRegistro.valor).toFixed(2)}m (a las ${hora} hs)${advertencia}`,
                fechaStr: `${dia}/${mes}/${anio}`
            };
        }
        return null;
    } catch (e) {
        console.log("⚠️ Falló también el respaldo del INA.");
        return null;
    }
}

async function obtenerDatos() {
    try {
        console.log("Iniciando recolección masiva de datos fluviales...");

        const ahora = new Date();
        const fechaReporte = `${ahora.getDate().toString().padStart(2, '0')}/${(ahora.getMonth()+1).toString().padStart(2, '0')}/${ahora.getFullYear()} a las ${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')} hs`;
        const fechaCortaHoy = `${ahora.getDate().toString().padStart(2, '0')}/${(ahora.getMonth()+1).toString().padStart(2, '0')}/${ahora.getFullYear()}`;

        // --- 1. LA PLATA ---
        let alturaLP = "N/D";
        let fechaLPStr = fechaCortaHoy;
        let msjHoraLP = "";
        try {
            const resAltura = await fetch(urlLaPlata);
            if (resAltura.ok) {
                const dataAltura = await resAltura.text();
                const valoresLP = dataAltura.trim().split('\n').pop().split(',');
                const fechaCruda = valoresLP[0].replace(/['"]/g, ''); 
                alturaLP = parseFloat(valoresLP[3]).toFixed(2) + "m";
                
                const [fechaParte, horaParte] = fechaCruda.split(' ');
                const [anio, mes, dia] = fechaParte.split('-');
                fechaLPStr = `${dia}/${mes}/${anio}`;
                msjHoraLP = ` (a las ${horaParte.substring(0,5)} hs)`;
            }
        } catch (e) { console.log("⚠️ Error La Plata"); }

        // Viento La Plata
        let infoViento = "N/D";
        try {
            const resClima = await fetch(urlClima);
            const dataClima = await resClima.json();
            const horaViento = dataClima.current_weather.time.split('T')[1];
            infoViento = `${dataClima.current_weather.windspeed} km/h ${gradosACardinal(dataClima.current_weather.winddirection)} (${horaViento} hs)`;
        } catch (e) {}

        // Pronóstico La Plata
        let infoPronostico = "N/D";
        try {
            const resPronostico = await fetch(urlPronostico);
            const htmlPronostico = await resPronostico.text().then(t => t.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' '));
            const matchPleamar = htmlPronostico.match(/PUERTO LA PLATA.*?PLEA-?MAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            const matchBajamar = htmlPronostico.match(/PUERTO LA PLATA.*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            const txtPleamar = matchPleamar ? `${matchPleamar[2]}m el ${matchPleamar[3].substring(0,5)} a las ${matchPleamar[1]} hs` : "Sin datos";
            const txtBajamar = matchBajamar ? `${matchBajamar[2]}m el ${matchBajamar[3].substring(0,5)} a las ${matchBajamar[1]} hs` : "Sin datos";
            infoPronostico = `📈 Pleamar: ${txtPleamar}\n📉 Bajamar: ${txtBajamar}`;
        } catch (e) {}

        // --- 2. IGUAZÚ ---
        let alturaIguazu = "N/D";
        let fechaIguazuStr = fechaCortaHoy;
        try {
            const resIguazu = await fetch(urlIguazu);
            if (resIguazu.ok) {
                const dataIguazu = await resIguazu.text();
                const valoresIg = dataIguazu.trim().split('\n').pop().split(',');
                const fechaCrudaIg = valoresIg[0].replace(/['"]/g, '');
                
                const [fechaParteIg, horaParteIg] = fechaCrudaIg.split(' ');
                const [anioIg, mesIg, diaIg] = fechaParteIg.split('-');
                fechaIguazuStr = `${diaIg}/${mesIg}/${anioIg}`;
                const horaIg = horaParteIg.substring(0,5);
                alturaIguazu = `${parseFloat(valoresIg[3]).toFixed(2)}m (a las ${horaIg} hs)`;
            }
        } catch (e) {}

        // --- 3. CONCORDIA (CON LÓGICA DE FALLBACK 24HS) ---
        let alturaConcordia = "N/D";
        let fechaConcordiaStr = fechaCortaHoy;
        let usarINA = false;

        try {
            const resConcordia = await fetch(urlConcordia);
            if (!resConcordia.ok) throw new Error("CARU caído");
            
            const htmlConcordia = await resConcordia.text();
            const textoLimpioCo = htmlConcordia.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            const indexCo = textoLimpioCo.indexOf("Concordia");
            
            if (indexCo !== -1) {
                const bloqueConcordia = textoLimpioCo.substring(indexCo, indexCo + 150);
                const matchAltura = bloqueConcordia.match(/(\d+[,.]\d{1,2})/);
                const matchHora = bloqueConcordia.match(/(\d{2}:\d{2})/);
                const matchFecha = bloqueConcordia.match(/(\d{2}\/\d{2}\/\d{4})/); // Asumiendo formato DD/MM/YYYY en CARU

                if (matchAltura && matchHora) {
                    const altCo = matchAltura[1].replace(',', '.') + "m";
                    const horaCo = matchHora[1];
                    
                    if (matchFecha) {
                        fechaConcordiaStr = matchFecha[1];
                        const [d, m, y] = matchFecha[1].split('/');
                        const [H, M] = horaCo.split(':');
                        const fechaMedicion = new Date(y, m - 1, d, H, M);
                        
                        if (esAntiguo(fechaMedicion)) {
                            usarINA = true; // El dato es viejo, saltamos al INA
                        } else {
                            alturaConcordia = `${altCo} (a las ${horaCo} hs)`;
                        }
                    } else {
                        // Si por algún motivo no encontramos fecha en la web pero sí hora, lo mandamos
                        alturaConcordia = `${altCo} (a las ${horaCo} hs)`;
                    }
                } else {
                    usarINA = true; // Falla el regex
                }
            } else {
                usarINA = true; // No encontró la palabra Concordia
            }
        } catch (e) {
            usarINA = true; // Falla la petición (Servidor caído)
        }

        // Ejecutar Fallback si la fuente primaria falló o es vieja
        if (usarINA) {
            const datosRespaldo = await obtenerFallbackINA();
            if (datosRespaldo) {
                alturaConcordia = datosRespaldo.altura;
                fechaConcordiaStr = datosRespaldo.fechaStr;
            } else {
                alturaConcordia = "N/D (Servidores caídos)";
            }
        }

        // --- 4. ENVÍO MULTI-RECEPTOR ---
        const listaTelefonos = process.env.TELEFONO ? process.env.TELEFONO.split(',') : [];
        const apiKey = process.env.API_KEY;

        if (listaTelefonos.length === 0 || !apiKey) return console.log("⚠️ Faltan Secrets.");

        const mensaje = `🌊 *REPORTE FLUVIAL* 🌊\n📅 ${fechaReporte}\n\n📍 *Puerto La Plata* (${fechaLPStr})\n📏 Altura: *${alturaLP}*${msjHoraLP}\n🌬️ Viento: ${infoViento}\n*Pronóstico SHN:*\n${infoPronostico}\n\n📍 *Puerto Iguazú* (${fechaIguazuStr})\n📏 Altura: *${alturaIguazu}*\n\n📍 *Concordia* (${fechaConcordiaStr})\n📏 Altura: *${alturaConcordia}*`;
        const textoCodificado = encodeURIComponent(mensaje);

        for (const tel of listaTelefonos) {
            const numeroLimpio = tel.trim();
            console.log(`Enviando a: ${numeroLimpio}...`);
            const url = `https://api.callmebot.com/whatsapp.php?phone=${numeroLimpio}&text=${textoCodificado}&apikey=${apiKey}`;
            await fetch(url);
        }
        
        console.log("✅ ¡Proceso finalizado!");

    } catch (error) {
        console.error("❌ Error fatal:", error.message);
    }
}

obtenerDatos();
