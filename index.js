// index.js - Versión Alta Disponibilidad

// 1. IGNORAR CERTIFICADOS VENCIDOS DEL GOBIERNO (Clave para que fetch no muera)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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

function obtenerHoraArgentina() {
    return new Date(Date.now() - 3 * 3600 * 1000);
}

function formatoFechaAPI(fecha) {
    return `${fecha.getFullYear()}-${(fecha.getMonth()+1).toString().padStart(2, '0')}-${fecha.getDate().toString().padStart(2, '0')}`;
}

function esAntiguo(fechaMedicion) {
    const ahora = obtenerHoraArgentina();
    const diferenciaHoras = Math.abs(ahora - fechaMedicion) / 36e5;
    return diferenciaHoras > 24;
}

// Lógica de respaldo: Consultando API del INA para Concordia (VERSIÓN BLINDADA)
async function obtenerFallbackINA() {
    try {
        console.log("Activando Plan B: Consultando túnel GeoServer para Concordia...");
        const hoy = obtenerHoraArgentina();
        
        const manana = new Date(hoy);
        manana.setDate(hoy.getDate() + 1);
        
        const fechaInicio = new Date(hoy);
        fechaInicio.setDate(hoy.getDate() - 5); 

        // Usamos la URL secreta que descubriste con las fechas dinámicas
        const urlGeoServer = `https://alerta.ina.gob.ar/geoserver/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=public2%3Aultimas_alturas_con_timeseries&LAYERS=public2%3Aultimas_alturas_con_timeseries&VIEWPARAMS=timeStart%3A${formatoFechaAPI(fechaInicio)}%3BtimeEnd%3A${formatoFechaAPI(manana)}%3B&STYLES=&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=150&I=50&J=50&CRS=EPSG%3A4326&WIDTH=101&HEIGHT=101&BBOX=-31.41860783100128%2C-58.03407669067383%2C-31.38393223285675%2C-57.9994010925293`;
        
        const res = await fetch(urlGeoServer, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        });
        
        if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
        
        const data = await res.json();
        
        // Entramos a las "features" del mapa
        if (data.features && data.features.length > 0) {
            const propiedades = data.features[0].properties;
            const valorFluvial = propiedades.valor; // Atrapamos el 5.3 directo
            
            // La fecha viene como "2026-04-23T03:00:00Z". (La Z significa Hora Universal).
            // Le restamos 3 horas para que diga "00:00 hs" de Argentina.
            const fechaZ = new Date(propiedades.fecha);
            const argTime = new Date(fechaZ.getTime() - 3 * 3600 * 1000);
            
            const dia = argTime.getUTCDate().toString().padStart(2, '0');
            const mes = (argTime.getUTCMonth()+1).toString().padStart(2, '0');
            const anio = argTime.getUTCFullYear();
            const hora = argTime.getUTCHours().toString().padStart(2, '0') + ":" + argTime.getUTCMinutes().toString().padStart(2, '0');
            
            let advertencia = esAntiguo(argTime) ? " ⚠️ (Dato desactualizado)" : " *(Fuente: INA)*";
            
            return {
                altura: `${parseFloat(valorFluvial).toFixed(2)}m (a las ${hora} hs)${advertencia}`,
                fechaStr: `${dia}/${mes}/${anio}`
            };
        }
        return null;
    } catch (e) {
        console.log("⚠️ Error en Fallback Geoserver:", e.message);
        return null;
    }
}
async function obtenerDatos() {
    try {
        console.log("Iniciando recolección masiva de datos fluviales...");

        const ahora = obtenerHoraArgentina();
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

        // --- 3. CONCORDIA ---
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
                const matchFecha = bloqueConcordia.match(/(\d{2}\/\d{2}\/\d{4})/); 

                if (matchAltura && matchHora) {
                    const altCo = matchAltura[1].replace(',', '.') + "m";
                    const horaCo = matchHora[1];
                    
                    if (matchFecha) {
                        fechaConcordiaStr = matchFecha[1];
                        const [d, m, y] = matchFecha[1].split('/');
                        const [H, M] = horaCo.split(':');
                        const fechaMedicion = new Date(y, m - 1, d, H, M);
                        
                        if (esAntiguo(fechaMedicion)) {
                            usarINA = true; 
                        } else {
                            alturaConcordia = `${altCo} (a las ${horaCo} hs)`;
                        }
                    } else {
                        alturaConcordia = `${altCo} (a las ${horaCo} hs)`;
                    }
                } else {
                    usarINA = true; 
                }
            } else {
                usarINA = true; 
            }
        } catch (e) {
            usarINA = true; 
        }

        // Ejecutar Fallback si la fuente primaria falló o es vieja
        if (usarINA) {
            const datosRespaldo = await obtenerFallbackINA();
            if (datosRespaldo) {
                alturaConcordia = datosRespaldo.altura;
                fechaConcordiaStr = datosRespaldo.fechaStr;
            } else {
                alturaConcordia = "N/D (Servidores caídos)";
                // Si falla también, ponemos la fecha de ayer o anterior para que se entienda que no hay dato fresco
                fechaConcordiaStr = "Sin dato reciente";
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
