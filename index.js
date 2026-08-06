// index.js - Reporte Fluvial
// Publica en Facebook Y genera data.json para el sitio web
const https = require('https');  // necesario para TLS inválido en AGPSE
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const urlLaPlata    = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";
const urlClima      = "https://api.open-meteo.com/v1/forecast?latitude=-34.8339&longitude=-57.8803&current_weather=true&timezone=America/Argentina/Buenos_Aires";
const urlPronostico = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";
const urlIguazu     = "https://hidrografia2.agpse.gob.ar/histdat/PUERTO_IGUAZU.dat";
const urlConcordia  = "http://190.0.152.194:8080/alturas/web/user/alturas";

// --- FUNCIONES AUXILIARES ---

function aNegrita(texto) {
    const normal  = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const negrita = "𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵";
    return texto.split('').map(char => {
        const index = normal.indexOf(char);
        return index > -1 ? negrita.slice(index * 2, index * 2 + 2) : char;
    }).join('');
}

function gradosACardinal(grados) {
    const dir = ['Norte (N)', 'Noreste (NE)', 'Este (E)', 'Sureste (SE)', 'Sur (S)', 'Suroeste (SW)', 'Oeste (W)', 'Noroeste (NW)'];
    return dir[Math.round(grados / 45) % 8];
}

function obtenerHoraArgentina() {
    return new Date(Date.now() - 3 * 3600 * 1000);
}

function formatoFechaAPI(fecha) {
    return `${fecha.getFullYear()}-${(fecha.getMonth()+1).toString().padStart(2,'0')}-${fecha.getDate().toString().padStart(2,'0')}`;
}

function esAntiguo(fechaMedicion) {
    if (!fechaMedicion) return false;
    const t = fechaMedicion instanceof Date ? fechaMedicion.getTime() : new Date(fechaMedicion).getTime();
    if (isNaN(t)) return false;
    return Math.abs(Date.now() - t) / 36e5 > 24;
}

// --- HELPERS INA ---

// Convierte una observación INA a nuestro formato estándar
function parsearObsINA(prop) {
    const fechaZ  = new Date(prop.fecha);
    const argTime = new Date(fechaZ.getTime() - 3 * 3600 * 1000);
    const fecha   = `${argTime.getUTCDate().toString().padStart(2,'0')}/${(argTime.getUTCMonth()+1).toString().padStart(2,'0')}/${argTime.getUTCFullYear()}`;
    const hora    = `${argTime.getUTCHours().toString().padStart(2,'0')}:${argTime.getUTCMinutes().toString().padStart(2,'0')}`;
    const antiguo = esAntiguo(fechaZ);
    const tag     = antiguo ? " ⚠️ (Dato viejo)" : " (Fuente: INA)";
    return {
        altura:   parseFloat(prop.valor).toFixed(2),
        horaStr:  hora,
        fechaStr: fecha,
        fuente:   "INA",
        antiguo,
        textoFB:  `${parseFloat(prop.valor).toFixed(2)}m (a las ${hora} hs)${tag}`
    };
}

// --- Plan B opción 1: API a5 por series_id (más directa y estable) ---
async function fetchINA_a5(seriesIds, nombrePuerto) {
    const hoy    = obtenerHoraArgentina();
    // Ventana amplia: 7 días (la serie 26 de La Plata puede tener delay de días)
    const inicio = new Date(hoy); inicio.setDate(hoy.getDate() - 7);
    const fin    = new Date(hoy); fin.setDate(hoy.getDate() + 2);

    for (const sid of seriesIds) {
        try {
            console.log(`  → INA a5 series_id=${sid} para ${nombrePuerto}...`);
            const url = `https://alerta.ina.gob.ar/a5/obs/puntual/series/${sid}/observaciones?timestart=${formatoFechaAPI(inicio)}&timeend=${formatoFechaAPI(fin)}`;
            const res = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
                signal: AbortSignal.timeout(15000)
            });
            if (!res.ok) { console.log(`  ⚠️ a5 series ${sid}: HTTP ${res.status}`); continue; }
            const data = await res.json();
            const arr  = Array.isArray(data) ? data : (data.observaciones || []);
            const obs  = arr.length > 0 ? arr[arr.length - 1] : null;
            if (obs && obs.valor !== null && obs.valor !== undefined) {
                console.log(`  ✅ a5 series_id=${sid}: ${obs.valor}m @ ${obs.timestart}`);
                const fechaZ  = new Date(obs.timestart);
                const argTime = new Date(fechaZ.getTime() - 3 * 3600 * 1000);
                const antiguo = esAntiguo(fechaZ);
                const dd   = argTime.getUTCDate().toString().padStart(2,'0');
                const mm   = (argTime.getUTCMonth()+1).toString().padStart(2,'0');
                const yyyy = argTime.getUTCFullYear();
                const hh   = argTime.getUTCHours().toString().padStart(2,'0');
                const min  = argTime.getUTCMinutes().toString().padStart(2,'0');
                const tag  = antiguo ? " ⚠️ (Dato viejo)" : " (Fuente: INA)";
                return {
                    altura:   parseFloat(obs.valor).toFixed(2),
                    horaStr:  `${hh}:${min}`,
                    fechaStr: `${dd}/${mm}/${yyyy}`,
                    fuente:   "INA",
                    antiguo,
                    textoFB:  `${parseFloat(obs.valor).toFixed(2)}m (a las ${hh}:${min} hs)${tag}`
                };
            }
        } catch(e) { console.log(`  ⚠️ a5 series ${sid} error: ${e.message}`); }
    }
    return null;
}

// --- Plan B opción 2: GeoServer WMS por bbox (fallback geográfico) ---
async function fetchINA_geoserver(bbox, nombrePuerto) {
    try {
        console.log(`  → INA GeoServer bbox para ${nombrePuerto}...`);
        const hoy    = obtenerHoraArgentina();
        const inicio = new Date(hoy); inicio.setDate(hoy.getDate() - 5);
        const fin    = new Date(hoy); fin.setDate(hoy.getDate() + 1);

        const url = `https://alerta.ina.gob.ar/geoserver/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=public2%3Aultimas_alturas_con_timeseries&LAYERS=public2%3Aultimas_alturas_con_timeseries&VIEWPARAMS=timeStart%3A${formatoFechaAPI(inicio)}%3BtimeEnd%3A${formatoFechaAPI(fin)}%3B&STYLES=&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=50&I=50&J=50&CRS=EPSG%3A4326&WIDTH=101&HEIGHT=101&BBOX=${bbox}`;
        const res  = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(15000)
        });
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            return parsearObsINA(data.features[0].properties);
        }
    } catch (e) { console.log(`  ⚠️ GeoServer ${nombrePuerto} error: ${e.message}`); }
    return null;
}

// --- Wrapper unificado ---
async function fetchGeoServerINA(bbox, nombrePuerto, seriesIds = []) {
    if (seriesIds.length > 0) {
        const res = await fetchINA_a5(seriesIds, nombrePuerto);
        if (res) return res;
    }
    return fetchINA_geoserver(bbox, nombrePuerto);
}

// --- PUBLICAR data.json EN EL REPO ---
async function publicarDataJson(datos) {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];
    const repo  = process.env.GITHUB_REPOSITORY?.split('/')[1];

    const fs = require('fs');
    try {
        fs.writeFileSync('data.json', JSON.stringify(datos, null, 2));
        console.log("✅ data.json guardado localmente en disco");
    } catch(e) { console.log("⚠️ Error escribiendo data.json local:", e.message); }

    if (!token || !owner || !repo) {
        console.log("⚠️  Sin GITHUB_TOKEN o GITHUB_REPOSITORY — omitiendo commit a GitHub Repo");
        return;
    }

    const contenido = Buffer.from(JSON.stringify(datos, null, 2)).toString('base64');
    const apiUrl    = `https://api.github.com/repos/${owner}/${repo}/contents/data.json`;

    let sha = undefined;
    try {
        const getRes = await fetch(apiUrl, {
            // Cambiado a Bearer y agregando Accept de la API v3
            headers: { Authorization: `Bearer ${token}`, "User-Agent": "hidrometros-bot", "Accept": "application/vnd.github.v3+json" }
        });
        if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
        } else {
            console.log(`⚠️ No se pudo obtener el SHA anterior (HTTP ${getRes.status})`);
        }
    } catch (e) { console.log(`⚠️ Error red obteniendo SHA: ${e.message}`); }

    const body = {
        message: `datos: actualización ${datos.fechaReporte}`,
        content: contenido,
        ...(sha && { sha })
    };

    const putRes = await fetch(apiUrl, {
        method:  "PUT",
        headers: {
            Authorization:  `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent":   "hidrometros-bot",
            "Accept":       "application/vnd.github.v3+json"
        },
        body: JSON.stringify(body)
    });

    if (putRes.ok) {
        console.log("✅ data.json actualizado en el repo (Página Web al día)");
    } else {
        const err = await putRes.json();
        console.error("❌ Error actualizando data.json:", err.message);
    }
}

// --- ORQUESTADOR PRINCIPAL ---
async function obtenerDatos() {
    try {
        console.log("Iniciando recolección...");
        const ahora        = obtenerHoraArgentina();
        const fechaReporte = `${ahora.getDate().toString().padStart(2,'0')}/${(ahora.getMonth()+1).toString().padStart(2,'0')}/${ahora.getFullYear()} a las ${ahora.getHours().toString().padStart(2,'0')}:${ahora.getMinutes().toString().padStart(2,'0')} hs`;
        const hoy          = `${ahora.getDate().toString().padStart(2,'0')}/${(ahora.getMonth()+1).toString().padStart(2,'0')}/${ahora.getFullYear()}`;

        // 0. OBTENER DATOS HISTÓRICOS ANTERIORES DESDE EL REPO
        let datosAnteriores = {};
        try {
            console.log("  → Obteniendo data.json anterior para conservar historial...");
            const urlDataJson = `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY || 'andresehansen/hidrometros'}/main/data.json?t=${Date.now()}`;
            const resHist = await fetch(urlDataJson);
            if (resHist.ok) {
                datosAnteriores = await resHist.json();
            }
        } catch(e) {
            console.log("  ⚠️ No se pudo obtener el data.json anterior. Se empezará desde cero.");
        }

// Helper para parsear archivos .dat de AGPSE buscando la última lectura válida en v[3]
function parseAGPSE(txtDat) {
    const lines = txtDat.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        const v = line.split(',');
        const cleanV3 = v[3] ? v[3].replace(/['"]/g, '') : '';
        const val3 = parseFloat(cleanV3);
        if (!isNaN(val3)) {
            const cleanDate = v[0].replace(/['"]/g, '');
            const [datePart, timePart] = cleanDate.split(' ');
            const [y, m, d] = datePart.split('-');
            const fechaMed = new Date(cleanDate.replace(' ', 'T') + '-03:00');
            const antiguo  = esAntiguo(fechaMed);
            const hhmm     = timePart.substring(0, 5);
            const fechaStr = `${d}/${m}/${y}`;
            const altStr   = val3.toFixed(2);
            return {
                altura:   altStr,
                horaStr:  hhmm,
                fechaStr: fechaStr,
                fuente:   "AGPSE",
                antiguo,
                textoFB:  `${altStr}m (a las ${hhmm} hs)`
            };
        }
    }
    return null;
}

        // ---- 1. LA PLATA ----
        let lpDatos = null;
        try {
            console.log("  → Fuente primaria AGPSE para La Plata...");
            const txtDat = await new Promise((resolve, reject) => {
                const req = https.request(urlLaPlata, { rejectUnauthorized: false }, (res) => {
                    let buf = '';
                    res.on('data', chunk => buf += chunk);
                    res.on('end', () => resolve(buf));
                });
                req.on('error', reject);
                req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
                req.end();
            });
            lpDatos = parseAGPSE(txtDat);
            if (lpDatos && lpDatos.antiguo) lpDatos = null; 
        } catch (e) { console.log("⚠️ Error La Plata AGPSE:", e.message); }
        
        if (!lpDatos) {
            lpDatos = await fetchGeoServerINA("-35.1,-58.2,-34.5,-57.5", "La Plata");
        }

        // ---- VIENTO ----
        let viento = null;
        try {
            const rc = await fetch(urlClima);
            const dc = await rc.json();
            viento = {
                velocidad:  dc.current_weather.windspeed,
                direccion:  gradosACardinal(dc.current_weather.winddirection),
                temperatura: dc.current_weather.temperature
            };
        } catch (e) { console.log("⚠️ Error clima:", e.message); }

// ---- PRONÓSTICO ----
        let pronostico = null;
        try {
            // Reemplazamos fetch por https.request para bypasear TLS y agregar User-Agent
            const rpText = await new Promise((resolve, reject) => {
                const req = https.request(urlPronostico, { 
                    rejectUnauthorized: false,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
                }, (res) => {
                    let buf = '';
                    res.on('data', chunk => buf += chunk);
                    res.on('end', () => resolve(buf));
                });
                req.on('error', reject);
                req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
                req.end();
            });

            const hp = rpText.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            const mp = hp.match(/PUERTO LA PLATA.*?PLEA-?MAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            const mb = hp.match(/PUERTO LA PLATA.*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            
            pronostico = {
                pleamar: mp ? { hora: mp[1], altura: mp[2], fecha: mp[3].substring(0, 5) } : null,
                bajamar: mb ? { hora: mb[1], altura: mb[2], fecha: mb[3].substring(0, 5) } : null
            };
        } catch (e) { 
            console.log("⚠️ Error pronóstico:", e.message); 
        }

        // ---- 2. IGUAZÚ ----
        let igDatos = null;
        try {
            const r = await fetch(urlIguazu);
            if (!r.ok) throw new Error("HTTP error");
            const t = await r.text();
            igDatos = parseAGPSE(t);
            if (igDatos && igDatos.antiguo) igDatos = null; 
        } catch (e) { console.log("⚠️ Error Iguazú primario:", e.message); }

        if (!igDatos) {
            igDatos = await fetchGeoServerINA("-25.648,-54.64,-25.50,-54.50", "Iguazú");
        }

        // ---- 3. CONCORDIA ----
        let coDatos = null;
        try {
            const r  = await fetch(urlConcordia);
            if (!r.ok) throw new Error("HTTP error");
            const t  = (await r.text()).replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            const idx = t.indexOf("Concordia");
            const blq = t.substring(idx, idx + 150);
            const mA  = blq.match(/(\d+[,.]\d{1,2})/);
            const mH  = blq.match(/(\d{2}:\d{2})/);
            const mF  = blq.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (mA && mH && mF) {
                const [d, m, y] = mF[1].split('/');
                const [hh, mm]  = mH[1].split(':');
                const fechaMed  = new Date(+y, +m - 1, +d, +hh, +mm);
                const antiguo   = esAntiguo(fechaMed);
                if (!antiguo) {
                    coDatos = {
                        altura:   mA[1].replace(',', '.'),
                        horaStr:  mH[1],
                        fechaStr: mF[1],
                        fuente:   "SRH",
                        antiguo:  false,
                        textoFB:  `${mA[1].replace(',','.')}m (a las ${mH[1]} hs)`
                    };
                }
            }
        } catch (e) { console.log("⚠️ Error Concordia primario:", e.message); }

        if (!coDatos) {
            coDatos = await fetchGeoServerINA("-31.41,-58.03,-31.38,-57.99", "Concordia");
        }

// --- Fuente primaria Prefectura Naval Argentina (PNA) ---
async function fetchPrefecturaPNA(nombrePuerto, regexSearch) {
    try {
        console.log(`  → Fuente primaria PNA para ${nombrePuerto}...`);
        const txtDat = await new Promise((resolve, reject) => {
            const req = https.request("https://contenidosweb.prefecturanaval.gob.ar/alturas/", {
                rejectUnauthorized: false,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let buf = '';
                res.on('data', chunk => buf += chunk);
                res.on('end', () => resolve(buf));
            });
            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
            req.end();
        });

        const clean = txtDat.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
        const match = clean.match(regexSearch);
        if (match) {
            const alt = parseFloat(match[1].replace(',', '.')).toFixed(2);
            const rawHora = match[3];
            const horaStr = `${rawHora.substring(0, 2)}:${rawHora.substring(2, 4)}`;

            const parts = match[2].split('/');
            const mesesMap = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
            const day = parts[0].padStart(2, '0');
            const month = mesesMap[parts[1].toUpperCase()] || '08';
            const year = '20' + parts[2];
            const fechaStr = `${day}/${month}/${year}`;

            const fechaMed = new Date(+year, +month - 1, +day, +rawHora.substring(0, 2), +rawHora.substring(2, 4));
            const antiguo = esAntiguo(fechaMed);

            console.log(`  ✅ PNA ${nombrePuerto}: ${alt}m @ ${fechaStr} ${horaStr}`);

            return {
                altura:   alt,
                horaStr:  horaStr,
                fechaStr: fechaStr,
                fuente:   "PNA",
                antiguo,
                textoFB:  `${alt}m (a las ${horaStr} hs)`
            };
        }
    } catch(e) {
        console.log(`⚠️ Error PNA ${nombrePuerto}:`, e.message);
    }
    return null;
}

        // ---- 4. SAN JAVIER ----
        let sjDatos = await fetchPrefecturaPNA('San Javier', /SAN JAVIER\s+URUGUAY\s+(\d+[\.,]\d{1,2})\s+[-+]?\d+[\.,]\d{1,2}\s+\d+\s+(\d{2}\/[A-Z]{3}\/\d{2})\s*-\s*(\d{2}\d{2})/i);
        if (!sjDatos) {
            sjDatos = await fetchGeoServerINA("-27.95,-55.20,-27.80,-55.05", "San Javier", [65]);
        }

        // ---- 5. SANTO TOMÉ ----
        let stDatos = await fetchPrefecturaPNA('Santo Tomé', /SANTO TOME\s+URUGUAY\s+(\d+[\.,]\d{1,2})\s+[-+]?\d+[\.,]\d{1,2}\s+\d+\s+(\d{2}\/[A-Z]{3}\/\d{2})\s*-\s*(\d{2}\d{2})/i);
        if (!stDatos) {
            stDatos = await fetchGeoServerINA("-28.60,-56.10,-28.50,-55.95", "Santo Tomé", [68]);
        }

        // ---- 6. SALTO GRANDE (ARRIBA Y ABAJO) ----
        let sgArribaDatos = null;
        let sgAbajoDatos  = null;

        try {
            console.log("  → Fuente primaria CARU para Salto Grande Arriba y Abajo...");
            const rCARU = await fetch("http://190.0.152.194:8080/alturas/web/user/alturas", { signal: AbortSignal.timeout(10000) });
            if (rCARU.ok) {
                const tCARU = (await rCARU.text()).replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
                const mA = tCARU.match(/Salto Grande Aguas Arriba\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})\s*(\d+[\.,]\d{1,2})/i);
                const mB = tCARU.match(/Salto Grande Aguas Abajo\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})\s*(\d+[\.,]\d{1,2})/i);

                if (mA) {
                    const [d, m, y] = mA[1].split('/');
                    const [hh, mm]  = mA[2].split(':');
                    const fechaMed  = new Date(+y, +m - 1, +d, +hh, +mm);
                    sgArribaDatos = {
                        altura:   mA[3].replace(',', '.'),
                        horaStr:  mA[2],
                        fechaStr: mA[1],
                        fuente:   "CARU",
                        antiguo:  esAntiguo(fechaMed),
                        textoFB:  `${mA[3].replace(',','.')}m (a las ${mA[2]} hs)`
                    };
                }
                if (mB) {
                    const [d, m, y] = mB[1].split('/');
                    const [hh, mm]  = mB[2].split(':');
                    const fechaMed  = new Date(+y, +m - 1, +d, +hh, +mm);
                    sgAbajoDatos = {
                        altura:   mB[3].replace(',', '.'),
                        horaStr:  mB[2],
                        fechaStr: mB[1],
                        fuente:   "CARU",
                        antiguo:  esAntiguo(fechaMed),
                        textoFB:  `${mB[3].replace(',','.')}m (a las ${mB[2]} hs)`
                    };
                }
            }
        } catch (e) {
            console.log("⚠️ Error Salto Grande CARU primario:", e.message);
        }

        if (!sgArribaDatos) {
            sgArribaDatos = await fetchGeoServerINA("-31.32,-57.98,-31.22,-57.88", "Salto Grande Arriba", [77]);
        }
        if (!sgAbajoDatos) {
            sgAbajoDatos  = await fetchGeoServerINA("-31.35,-57.98,-31.25,-57.88", "Salto Grande Abajo", [78]);
        }

        // --- FUNCIÓN PARA CALCULAR TENDENCIA DE UN PUERTO ---
        function calcularTendencia(historico, alturaActual) {
            if (!historico || historico.length < 2 || alturaActual === undefined || alturaActual === null) {
                return { icono: '➡️', estado: 'estacionado', texto: 'Estacionado', diferencia: '0.00' };
            }
            const actual = parseFloat(alturaActual);
            let anterior = parseFloat(historico[historico.length - 2].altura);
            if (isNaN(actual) || isNaN(anterior)) {
                return { icono: '➡️', estado: 'estacionado', texto: 'Estacionado', diferencia: '0.00' };
            }
            const diff = actual - anterior;
            if (Math.abs(diff) < 0.01) {
                return { icono: '➡️', estado: 'estacionado', texto: 'Estacionado', diferencia: '0.00' };
            }
            const sign = diff > 0 ? '+' : '';
            const diffStr = `${sign}${diff.toFixed(2)}`;
            if (diff > 0) {
                return { icono: '⬆️', estado: 'subiendo', texto: `Subiendo (${diffStr}m)`, diferencia: diffStr };
            } else {
                return { icono: '⬇️', estado: 'bajando', texto: `Bajando (${diffStr}m)`, diferencia: diffStr };
            }
        }

        // --- FUNCIÓN PARA PROCESAR EL HISTORIAL DE HASTA 48 REGISTROS ---
        function getHistorico(puertoKey, nuevoDato, subKey = null) {
            let hist = [];
            if (subKey && datosAnteriores[puertoKey] && datosAnteriores[puertoKey][subKey]) {
                hist = datosAnteriores[puertoKey][subKey].historico || [];
            } else if (!subKey && datosAnteriores[puertoKey]) {
                hist = datosAnteriores[puertoKey].historico || [];
            }
            if (nuevoDato && !nuevoDato.antiguo) {
                const ultimo = hist.length > 0 ? hist[hist.length - 1] : null;
                // Evitamos sumar la medición si ya está guardada (misma fecha y hora)
                if (!ultimo || ultimo.fechaStr !== nuevoDato.fechaStr || ultimo.horaStr !== nuevoDato.horaStr) {
                    hist.push({
                        altura: nuevoDato.altura,
                        fechaStr: nuevoDato.fechaStr,
                        horaStr: nuevoDato.horaStr
                    });
                }
            }
            // Retorna hasta los últimos 48 elementos para un historial de 48h
            return hist.slice(-48);
        }

        // ---- ASIGNACIÓN DE NIVELES DE ALERTA / EVACUACIÓN, HISTORIAL Y TENDENCIA ----
        if (lpDatos) { 
            lpDatos.alerta = 2.5; 
            lpDatos.evacuacion = 2.8; 
            lpDatos.historico = getHistorico('laplata', lpDatos);
            lpDatos.tendencia = calcularTendencia(lpDatos.historico, lpDatos.altura);
        } else if (datosAnteriores.laplata) {
            lpDatos = datosAnteriores.laplata;
        }

        if (igDatos) { 
            igDatos.alerta = 25.0; 
            igDatos.evacuacion = 28.0; 
            igDatos.historico = getHistorico('iguazu', igDatos);
            igDatos.tendencia = calcularTendencia(igDatos.historico, igDatos.altura);
        } else if (datosAnteriores.iguazu) {
            igDatos = datosAnteriores.iguazu;
        }

        if (coDatos) { 
            coDatos.alerta = 11.0; 
            coDatos.evacuacion = 12.5; 
            coDatos.historico = getHistorico('concordia', coDatos);
            coDatos.tendencia = calcularTendencia(coDatos.historico, coDatos.altura);
        } else if (datosAnteriores.concordia) {
            coDatos = datosAnteriores.concordia;
        }

        if (sjDatos) {
            sjDatos.alerta = 8.0;
            sjDatos.evacuacion = 10.0;
            sjDatos.historico = getHistorico('sanjavier', sjDatos);
            sjDatos.tendencia = calcularTendencia(sjDatos.historico, sjDatos.altura);
        } else if (datosAnteriores.sanjavier) {
            sjDatos = datosAnteriores.sanjavier;
        }

        if (stDatos) {
            stDatos.alerta = 11.5;
            stDatos.evacuacion = 12.5;
            stDatos.historico = getHistorico('santotome', stDatos);
            stDatos.tendencia = calcularTendencia(stDatos.historico, stDatos.altura);
        } else if (datosAnteriores.santotome) {
            stDatos = datosAnteriores.santotome;
        }

        if (sgArribaDatos) {
            sgArribaDatos.alerta = 35.5;
            sgArribaDatos.evacuacion = 36.0;
            sgArribaDatos.historico = getHistorico('saltogrande', sgArribaDatos, 'arriba');
            sgArribaDatos.tendencia = calcularTendencia(sgArribaDatos.historico, sgArribaDatos.altura);
        } else if (datosAnteriores.saltogrande?.arriba) {
            sgArribaDatos = datosAnteriores.saltogrande.arriba;
        }

        if (sgAbajoDatos) {
            sgAbajoDatos.alerta = 17.3;
            sgAbajoDatos.evacuacion = 17.8;
            sgAbajoDatos.historico = getHistorico('saltogrande', sgAbajoDatos, 'abajo');
            sgAbajoDatos.tendencia = calcularTendencia(sgAbajoDatos.historico, sgAbajoDatos.altura);
        } else if (datosAnteriores.saltogrande?.abajo) {
            sgAbajoDatos = datosAnteriores.saltogrande.abajo;
        }

        const sgDatosCombined = (sgArribaDatos || sgAbajoDatos) ? {
            arriba: sgArribaDatos,
            abajo:  sgAbajoDatos
        } : (datosAnteriores.saltogrande || null);

        // ---- GENERAR data.json PARA EL SITIO WEB ----
        const dataJson = {
            fechaReporte,
            generadoEn: ahora.toISOString(),
            laplata:    lpDatos,
            viento,
            pronostico,
            iguazu:     igDatos,
            sanjavier:  sjDatos,
            santotome:  stDatos,
            concordia:  coDatos,
            saltogrande: sgDatosCombined
        };

        await publicarDataJson(dataJson);

        // ---- PUBLICAR EN FACEBOOK ----
        const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
        const pageId          = process.env.FACEBOOK_PAGE_ID;

        function tagEstadoFB(d) {
            if (!d || d.altura === undefined) return '';
            const alt = parseFloat(d.altura);
            if (alt >= d.evacuacion) return ' 🚨 [EVACUACIÓN]';
            if (alt >= d.alerta) return ' ⚠️ [ALERTA]';
            return '';
        }

        const lpTxt = lpDatos   ? `${lpDatos.textoFB}${tagEstadoFB(lpDatos)}` : "N/D";
        const igTxt = igDatos   ? `${igDatos.textoFB}${tagEstadoFB(igDatos)}` : "N/D";
        const coTxt = coDatos   ? `${coDatos.textoFB}${tagEstadoFB(coDatos)}` : "N/D";
        const sjTxt = sjDatos   ? `${sjDatos.textoFB}${tagEstadoFB(sjDatos)}` : "N/D";
        const stTxt = stDatos   ? `${stDatos.textoFB}${tagEstadoFB(stDatos)}` : "N/D";
        const sgArribaTxt = sgArribaDatos ? `${sgArribaDatos.textoFB}${tagEstadoFB(sgArribaDatos)}` : "N/D";
        const sgAbajoTxt  = sgAbajoDatos  ? `${sgAbajoDatos.textoFB}${tagEstadoFB(sgAbajoDatos)}`  : "N/D";
        const viTxt = viento    ? `${viento.velocidad} km/h ${viento.direccion}` : "N/D";
        const prTxt = pronostico
            ? `📈 Pleamar: ${pronostico.pleamar ? pronostico.pleamar.altura+'m el '+pronostico.pleamar.fecha+' '+pronostico.pleamar.hora : 'S/D'}\n📉 Bajamar: ${pronostico.bajamar ? pronostico.bajamar.altura+'m el '+pronostico.bajamar.fecha+' '+pronostico.bajamar.hora : 'S/D'}`
            : "N/D";

        const msg = `🌊 ${aNegrita("REPORTE FLUVIAL")} 🌊\n📅 ${fechaReporte}\n\n📍 ${aNegrita("LA PLATA")} (${lpDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(lpTxt)}\n🌬️ Viento: ${viTxt}\n\n⚓ ${aNegrita("SHN:")}\n${prTxt}\n\n📍 ${aNegrita("IGUAZÚ")} (${igDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(igTxt)}\n\n📍 ${aNegrita("SAN JAVIER")} (${sjDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(sjTxt)}\n\n📍 ${aNegrita("SANTO TOMÉ")} (${stDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(stTxt)}\n\n📍 ${aNegrita("CONCORDIA")} (${coDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(coTxt)}\n\n⚡ ${aNegrita("EMBALSE SALTO GRANDE")}\n🔼 Cota Embalse (Arriba): ${aNegrita(sgArribaTxt)}\n🔽 Restitución (Abajo): ${aNegrita(sgAbajoTxt)}`;

        console.log("\n📝 PUBLICACIÓN FACEBOOK:\n", msg);

        if (!pageAccessToken || !pageId) {
            console.log("⚠️  Sin credenciales Facebook — saltando publicación.");
            return;
        }

        const fbRes  = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ access_token: pageAccessToken, message: msg })
        });
        const fbData = await fbRes.json();

        if (fbData.error) {
            console.error("❌ Error Facebook:", fbData.error.message);
        } else {
            console.log(`✅ Publicado en Facebook. ID: ${fbData.id}`);
        }

    } catch (e) { console.error("Error fatal:", e.message); }
}

obtenerDatos();
