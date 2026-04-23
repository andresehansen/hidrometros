// index.js - Versión Blindada Definitiva

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// URLS (Mantenemos LAPLATA_ROTO para la prueba)
const urlLaPlata = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA_ROTO.dat";
const urlClima = "https://api.open-meteo.com/v1/forecast?latitude=-34.8339&longitude=-57.8803&current_weather=true&timezone=America/Argentina/Buenos_Aires";
const urlPronostico = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";
const urlIguazu = "https://hidrografia2.agpse.gob.ar/histdat/PUERTO_IGUAZU_ROTO.dat";
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

// --- LÓGICA DE RESPALDO INA (Iguazú y Concordia) ---
async function fetchGeoServerINA(unid, bbox, nombrePuerto) {
    try {
        console.log(`Activando Plan B: Consultando INA para ${nombrePuerto}...`);
        const hoy = obtenerHoraArgentina();
        const manana = new Date(hoy);
        manana.setDate(hoy.getDate() + 1);
        const inicio = new Date(hoy);
        inicio.setDate(hoy.getDate() - 5);

        const url = `https://alerta.ina.gob.ar/geoserver/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=public2%3Aultimas_alturas_con_timeseries&LAYERS=public2%3Aultimas_alturas_con_timeseries&VIEWPARAMS=timeStart%3A${formatoFechaAPI(inicio)}%3BtimeEnd%3A${formatoFechaAPI(manana)}%3B&STYLES=&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=150&I=50&J=50&CRS=EPSG%3A4326&WIDTH=101&HEIGHT=101&BBOX=${bbox}`;

        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            const prop = data.features[0].properties;
            const fechaZ = new Date(prop.fecha);
            const argTime = new Date(fechaZ.getTime() - 3 * 3600 * 1000);
            
            const fechaStr = `${argTime.getUTCDate().toString().padStart(2, '0')}/${(argTime.getUTCMonth()+1).toString().padStart(2, '0')}/${argTime.getUTCFullYear()}`;
            const horaStr = `${argTime.getUTCHours().toString().padStart(2, '0')}:${argTime.getUTCMinutes().toString().padStart(2, '0')}`;
            
            let tag = esAntiguo(argTime) ? " ⚠️ (Dato viejo)" : " *(Fuente: INA)*";
            return {
                altura: `${parseFloat(prop.valor).toFixed(2)}m (a las ${horaStr} hs)${tag}`,
                fecha: fechaStr
            };
        }
    } catch (e) { console.log(`Error INA ${nombrePuerto}:`, e.message); }
    return null;
}

// --- LÓGICA DE RESPALDO CARP (Pilote Norden para La Plata) ---
async function fetchCarpNorden() {
    return new Promise((resolve) => {
        console.log("Activando Plan B: Consultando CARP Pilote Norden...");
        const https = require('https');
        const crypto = require('crypto');
        
        const numeroAleatorio = Math.random();
        const urlStr = `https://meteo.comisionriodelaplata.org/ecsCommand.php?c=telemetry%2FupdateTelemetry&s=${numeroAleatorio}`;
        
        const options = {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://www.comisionriodelaplata.org/"
            },
            rejectUnauthorized: false,
            ciphers: 'DEFAULT:@SECLEVEL=0', 
            secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
        };

        https.get(urlStr, options, (res) => {
            let texto = '';
            res.on('data', chunk => texto += chunk);
            res.on('end', () => {
                // EL ESPÍA: Vemos qué respondió exactamente el servidor
                if (!texto.includes('JSON**')) {
                    console.log("🔍 Respuesta cruda de la CARP (No es JSON):", texto.substring(0, 300));
                    resolve(null);
                    return;
                }

                try {
                    const jsonPart = JSON.parse(texto.split('JSON**')[1]);
                    if (jsonPart && jsonPart.tide && jsonPart.tide.latest) {
                        const htmlDecodificado = decodeURIComponent(jsonPart.tide.latest);
                        const match = htmlDecodificado.match(/<td[^>]*>(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})<\/td><td[^>]*>(\d+\.\d{2})<\/td>/i);
                        
                        if (match) {
                            const fechaRaw = match[1];
                            const altura = match[2];
                            const [f, h] = fechaRaw.split(' ');
                            const [y, m, d] = f.split('-');
                            
                            resolve({
                                altura: `${altura}m (a las ${h.substring(0,5)} hs) *(Fuente: CARP Norden)*`,
                                fecha: `${d}/${m}/${y}`
                            });
                            return;
                        }
                    }
                    resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', (e) => resolve(null));
    });
}

// --- ORQUESTADOR PRINCIPAL ---
async function obtenerDatos() {
    try {
        console.log("Iniciando recolección...");
        const ahora = obtenerHoraArgentina();
        const fechaReporte = `${ahora.getDate().toString().padStart(2, '0')}/${(ahora.getMonth()+1).toString().padStart(2, '0')}/${ahora.getFullYear()} a las ${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')} hs`;
        const hoy = `${ahora.getDate().toString().padStart(2, '0')}/${(ahora.getMonth()+1).toString().padStart(2, '0')}/${ahora.getFullYear()}`;

        // --- 1. LA PLATA ---
        let altLP = "N/D"; let fecLP = hoy; let usarCarp = false;
        try {
            const r = await fetch(urlLaPlata);
            if (!r.ok) throw new Error("Falla HTTP");
            const t = await r.text();
            const v = t.trim().split('\n').pop().split(',');
            altLP = parseFloat(v[3]).toFixed(2) + "m (a las " + v[0].replace(/['"]/g, '').split(' ')[1].substring(0,5) + " hs)";
            const [y, m, d] = v[0].replace(/['"]/g, '').split(' ')[0].split('-');
            fecLP = `${d}/${m}/${y}`;
            if (esAntiguo(new Date(v[0].replace(/['"]/g, '')))) usarCarp = true;
        } catch (e) { usarCarp = true; }

        if (usarCarp) {
            const r = await fetchCarpNorden();
            if (r) { altLP = r.altura; fecLP = r.fecha; }
        }

        // Viento y Pronóstico
        let infoV = "N/D"; try { const rc = await fetch(urlClima); const dc = await rc.json(); infoV = `${dc.current_weather.windspeed} km/h ${gradosACardinal(dc.current_weather.winddirection)}`; } catch(e){}
        let infoP = "N/D"; try {
            const rp = await fetch(urlPronostico); const hp = await rp.text().then(t => t.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' '));
            const mp = hp.match(/PUERTO LA PLATA.*?PLEA-?MAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            const mb = hp.match(/PUERTO LA PLATA.*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            infoP = `📈 Pleamar: ${mp?mp[2]+'m el '+mp[3].substring(0,5)+' '+mp[1]:'S/D'}\n📉 Bajamar: ${mb?mb[2]+'m el '+mb[3].substring(0,5)+' '+mb[1]:'S/D'}`;
        } catch(e){}

        // --- 2. IGUAZÚ ---
        let altIg = "N/D"; let fecIg = hoy; let usarInaIg = false;
        try {
            const r = await fetch(urlIguazu);
            if (!r.ok) throw new Error("Falla HTTP");
            const t = await r.text();
            const v = t.trim().split('\n').pop().split(',');
            altIg = parseFloat(v[3]).toFixed(2) + "m (a las " + v[0].replace(/['"]/g, '').split(' ')[1].substring(0,5) + " hs)";
            const [y, m, d] = v[0].replace(/['"]/g, '').split(' ')[0].split('-');
            fecIg = `${d}/${m}/${y}`;
            if (esAntiguo(new Date(v[0].replace(/['"]/g, '')))) usarInaIg = true;
        } catch (e) { usarInaIg = true; }

        if (usarInaIg) {
            const r = await fetchGeoServerINA(9, "-25.648033618927002%2C-54.64118957519531%2C-25.509331226348877%2C-54.50248718261719", "Iguazú");
            if (r) { altIg = r.altura; fecIg = r.fecha; }
        }

        // --- 3. CONCORDIA ---
        let altCo = "N/D"; let fecCo = hoy; let usarInaCo = false;
        try {
            const r = await fetch(urlConcordia);
            if (!r.ok) throw new Error("Falla HTTP");
            const t = await r.text();
            const tx = t.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            const idx = tx.indexOf("Concordia");
            const blq = tx.substring(idx, idx + 150);
            const mA = blq.match(/(\d+[,.]\d{1,2})/);
            const mH = blq.match(/(\d{2}:\d{2})/);
            const mF = blq.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (mA && mH && mF) {
                const [d,m,y] = mF[1].split('/');
                if (esAntiguo(new Date(y, m-1, d))) usarInaCo = true;
                else { altCo = mA[1].replace(',','.')+"m (a las "+mH[1]+" hs)"; fecCo = mF[1]; }
            } else usarInaCo = true;
        } catch (e) { usarInaCo = true; }

        if (usarInaCo) {
            const r = await fetchGeoServerINA(79, "-31.41860783100128%2C-58.03407669067383%2C-31.38393223285675%2C-57.9994010925293", "Concordia");
            if (r) { altCo = r.altura; fecCo = r.fecha; }
        }

        // --- ENVÍO ---
        const tels = process.env.TELEFONO ? process.env.TELEFONO.split(',') : [];
        const key = process.env.API_KEY;
        const msg = `🌊 *REPORTE FLUVIAL* 🌊\n📅 ${fechaReporte}\n\n📍 *La Plata* (${fecLP})\n📏 Altura: *${altLP}*\n🌬️ Viento: ${infoV}\n*SHN:*\n${infoP}\n\n📍 *Iguazú* (${fecIg})\n📏 Altura: *${altIg}*\n\n📍 *Concordia* (${fecCo})\n📏 Altura: *${altCo}*`;
        
        for (const t of tels) { await fetch(`https://api.callmebot.com/whatsapp.php?phone=${t.trim()}&text=${encodeURIComponent(msg)}&apikey=${key}`); }
        console.log("✅ Reporte enviado!");
    } catch (e) { console.error("Error fatal:", e.message); }
}

obtenerDatos();
