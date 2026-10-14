/**
 * index.js - Worker / Backend Bot para GitHub Actions (Reporte Fluvial)
 * ---------------------------------------------------------------------
 * Este archivo NO es parte del frontend del navegador.
 * Es ejecutado automáticamente cada hora por GitHub Actions (.github/workflows/reporte.yml).
 * Responsabilidades:
 *  1. Consultar APIs oficiales (AGPSE, INA, CARU, PNA, SHN, Open-Meteo).
 *  2. Consolidar el historial de lecturas y calcular tendencias.
 *  3. Generar y commitear data.json (schemaVersion 1.0.0).
 *  4. Opcionalmente publicar el reporte en Facebook si existen credenciales.
 */
const https = require('https');  // necesario para TLS inválido en AGPSE
const http  = require('http');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const urlLaPlata    = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";
const urlClima      = "https://api.open-meteo.com/v1/forecast?latitude=-34.8339&longitude=-57.8803&current_weather=true&timezone=America/Argentina/Buenos_Aires";
const urlPronostico = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";
// Nota: hidrografia2 presenta timeouts en TLS/HTTPS, usamos HTTP primario con fallback
const urlIguazu     = "http://hidrografia2.agpse.gob.ar/histdat/PUERTO_IGUAZU.dat";
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
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
}

function formatoFechaAPI(fecha) {
    return `${fecha.getFullYear()}-${(fecha.getMonth()+1).toString().padStart(2,'0')}-${fecha.getDate().toString().padStart(2,'0')}`;
}

function esAntiguo(fechaMedicion, maxHoras = 24) {
    if (!fechaMedicion) return false;
    const t = fechaMedicion instanceof Date ? fechaMedicion.getTime() : new Date(fechaMedicion).getTime();
    if (isNaN(t)) return false;
    return Math.abs(Date.now() - t) / 36e5 > maxHoras;
}

// --- HELPER SHN (SERVICIO DE HIDROGRAFÍA NAVAL - ALTURAS HORARIAS) ---
async function fetchSHN_AlturasHorarias(cod = 'LPLA', nombrePuerto = 'La Plata') {
    const ahora = obtenerHoraArgentina();
    const pad = v => v.toString().padStart(2, '0');
    const fechaReq = `${ahora.getFullYear()}${pad(ahora.getMonth() + 1)}${pad(ahora.getDate())}${pad(ahora.getHours())}${pad(ahora.getMinutes())}`;
    
    // 1. Intentar API REST v1
    try {
        console.log(`  → SHN API v1 para ${cod} (${fechaReq})...`);
        const url = `https://www.hidro.gob.ar/api/v1/AlturasHorarias/${cod}/${fechaReq}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
            const data = await res.json();
            const lecturas = data.lecturas || [];
            if (lecturas.length > 0) {
                const ult = lecturas[lecturas.length - 1];
                const fechaMed = new Date(`${ult.fecha}-03:00`);
                const [dPart, tPart] = ult.fecha.split('T');
                const [y, m, d] = dPart.split('-');
                const hhmm = tPart.substring(0, 5);
                const fechaStr = `${d}/${m}/${y}`;
                const altStr = parseFloat(ult.altura).toFixed(2);
                const antiguo = esAntiguo(fechaMed, 3);
                
                const historial = lecturas.map(l => {
                    const [dp, tp] = l.fecha.split('T');
                    const [ly, lm, ld] = dp.split('-');
                    return {
                        altura: parseFloat(l.altura).toFixed(2),
                        fechaStr: `${ld}/${lm}/${ly}`,
                        horaStr: tp.substring(0, 5)
                    };
                });
                
                console.log(`  ✅ SHN API ${nombrePuerto}: ${altStr}m @ ${fechaStr} ${hhmm}`);
                return {
                    altura: altStr,
                    horaStr: hhmm,
                    fechaStr: fechaStr,
                    fuente: 'SHN',
                    antiguo,
                    textoFB: `${altStr}m (a las ${hhmm} hs) (Fuente: SHN)`,
                    historialLecturas: historial
                };
            }
        }
    } catch(e) { console.log(`  ⚠️ Aviso API SHN ${cod}: ${e.message}`); }

    // 2. Fallback a tabla HTML de alturashorarias.asp
    try {
        console.log(`  → SHN HTML fallback para ${nombrePuerto}...`);
        const url = 'https://www.hidro.gob.ar/oceanografia/alturashorarias.asp';
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
        if (res.ok) {
            const html = await res.text();
            const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/i);
            const headers = [];
            if (headerMatch) {
                const thRegex = /<th[^>]*>\s*(\d{2}\/\d{2}\/\d{4})<br>(\d{2}:\d{2})\s*<\/th>/gi;
                let m;
                while ((m = thRegex.exec(headerMatch[0])) !== null) {
                    headers.push({ fechaStr: m[1], horaStr: m[2] });
                }
            }
            const rowRegex = new RegExp(`data-estacion=['"]${cod}['"][\\s\\S]*?<\\/tr>`, 'i');
            const rowMatch = html.match(rowRegex);
            if (rowMatch && headers.length > 0) {
                const tdRegex = /<td[^>]*>\s*(\d+[\.,]\d{1,2})\s*<\/td>/gi;
                const lecturas = [];
                let m;
                let i = 0;
                while ((m = tdRegex.exec(rowMatch[0])) !== null && i < headers.length) {
                    lecturas.push({
                        altura: parseFloat(m[1].replace(',', '.')).toFixed(2),
                        fechaStr: headers[i].fechaStr,
                        horaStr: headers[i].horaStr
                    });
                    i++;
                }
                if (lecturas.length > 0) {
                    const ult = lecturas[0];
                    const [d, m, y] = ult.fechaStr.split('/');
                    const [hh, mm] = ult.horaStr.split(':');
                    const fechaMed = new Date(+y, +m - 1, +d, +hh, +mm);
                    const antiguo = esAntiguo(fechaMed, 3);
                    console.log(`  ✅ SHN HTML ${nombrePuerto}: ${ult.altura}m @ ${ult.fechaStr} ${ult.horaStr}`);
                    return {
                        altura: ult.altura,
                        horaStr: ult.horaStr,
                        fechaStr: ult.fechaStr,
                        fuente: 'SHN',
                        antiguo,
                        textoFB: `${ult.altura}m (a las ${ult.horaStr} hs) (Fuente: SHN)`,
                        historialLecturas: lecturas.reverse()
                    };
                }
            }
        }
    } catch(e) { console.log(`  ⚠️ Aviso HTML SHN ${cod}: ${e.message}`); }

    return null;
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

// Detecta si un sensor electrónico está trabado/saturado con múltiples lecturas idénticas
function sensorEstaTrabado(arr) {
    if (!arr || arr.length < 6) return false;
    const ultimas = arr.slice(-6);
    const primerValor = ultimas[0]?.valor;
    if (primerValor === null || primerValor === undefined || isNaN(primerValor)) return false;
    return ultimas.every(o => Math.abs(o.valor - primerValor) < 0.001);
}

// --- Plan B opción 1: API a5 por series_id (más directa y estable) ---
async function fetchINA_a5(seriesIds, nombrePuerto) {
    const hoy    = obtenerHoraArgentina();
    // Ventana amplia: 7 días
    const inicio = new Date(hoy); inicio.setDate(hoy.getDate() - 7);
    const fin    = new Date(hoy); fin.setDate(hoy.getDate() + 2);

    let mejorOpcion = null;

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
                const trabado = sensorEstaTrabado(arr);
                if (trabado) {
                    console.log(`  ⚠️ a5 series_id=${sid}: Sensor trabado/saturado en ${obs.valor}m con múltiples lecturas idénticas.`);
                    // Si hay más de una serie para probar, saltamos a la siguiente alternativa
                    if (seriesIds.length > 1) {
                        continue;
                    }
                }

                console.log(`  ✅ a5 series_id=${sid}: ${obs.valor}m @ ${obs.timestart}${trabado ? ' ⚠️ [TRABADO/SATURADO]' : ''}`);
                const fechaZ  = new Date(obs.timestart);
                const argTime = new Date(fechaZ.getTime() - 3 * 3600 * 1000);
                const antiguo = esAntiguo(fechaZ);
                const dd   = argTime.getUTCDate().toString().padStart(2,'0');
                const mm   = (argTime.getUTCMonth()+1).toString().padStart(2,'0');
                const yyyy = argTime.getUTCFullYear();
                const hh   = argTime.getUTCHours().toString().padStart(2,'0');
                const min  = argTime.getUTCMinutes().toString().padStart(2,'0');

                // Las series 9 (Pto Iguazú id 20), 65 (San Javier) y 68 (Santo Tomé) son escalas oficiales de Prefectura (PNA)
                const esPNA = (sid === 9 || sid === 65 || sid === 68);
                const fuente = esPNA ? "PNA" : "INA";
                const tag  = antiguo ? " ⚠️ (Dato viejo)" : ` (Fuente: ${fuente})`;

                // Construir lote histórico de la serie (permite poblar curvas y gráficos)
                const historialLecturas = [];
                for (const item of arr) {
                    if (item && item.valor !== null && item.valor !== undefined && !isNaN(parseFloat(item.valor))) {
                        const fZ = new Date(item.timestart);
                        const aT = new Date(fZ.getTime() - 3 * 3600 * 1000);
                        const dStr = `${aT.getUTCDate().toString().padStart(2,'0')}/${(aT.getUTCMonth()+1).toString().padStart(2,'0')}/${aT.getUTCFullYear()}`;
                        const hStr = `${aT.getUTCHours().toString().padStart(2,'0')}:${aT.getUTCMinutes().toString().padStart(2,'0')}`;
                        historialLecturas.push({
                            altura: parseFloat(item.valor).toFixed(2),
                            fechaStr: dStr,
                            horaStr: hStr
                        });
                    }
                }

                const resultado = {
                    altura:   parseFloat(obs.valor).toFixed(2),
                    horaStr:  `${hh}:${min}`,
                    fechaStr: `${dd}/${mm}/${yyyy}`,
                    fuente:   fuente,
                    antiguo,
                    ts:       fechaZ.getTime(),
                    trabado,
                    historialLecturas,
                    textoFB:  `${parseFloat(obs.valor).toFixed(2)}m (a las ${hh}:${min} hs)${tag}`
                };

                // Si encontramos un dato reciente no antiguo y no trabado, lo retornamos de inmediato
                if (!antiguo && !trabado) {
                    return resultado;
                }

                // Si es antiguo o trabado, lo guardamos como candidato por si ninguna otra serie tiene dato nuevo
                if (!mejorOpcion) {
                    mejorOpcion = resultado;
                }
            }
        } catch(e) { console.log(`  ⚠️ a5 series ${sid} error: ${e.message}`); }
    }
    return mejorOpcion;
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

// --- Fuente primaria / respaldo Prefectura Naval Argentina (PNA) ---
let cachePNAHtml = null;
let pnaConsultado = false;

async function obtenerHtmlPNA() {
    if (pnaConsultado) return cachePNAHtml;
    pnaConsultado = true;
    try {
        console.log(`  → Consultando tabla general de alturas de PNA...`);
        cachePNAHtml = await new Promise((resolve, reject) => {
            const req = https.request("https://contenidosweb.prefecturanaval.gob.ar/alturas/", {
                rejectUnauthorized: false,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
            }, (res) => {
                let buf = '';
                res.on('data', chunk => buf += chunk);
                res.on('end', () => resolve(buf));
            });
            req.on('error', reject);
            req.setTimeout(25000, () => { req.destroy(new Error('timeout')); });
            req.end();
        });
    } catch(e) {
        console.log(`⚠️ Error conexión PNA:`, e.message);
        cachePNAHtml = null;
    }
    return cachePNAHtml;
}

async function fetchPrefecturaPNA(nombrePuerto, regexSearch) {
    try {
        const txtDat = await obtenerHtmlPNA();
        if (!txtDat) return null;

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
                ts:       fechaMed.getTime(),
                textoFB:  `${alt}m (a las ${horaStr} hs)`
            };
        }
    } catch(e) {
        console.log(`⚠️ Error procesando PNA ${nombrePuerto}:`, e.message);
    }
    return null;
}

// --- HELPER PRONÓSTICOS OFICIALES INA (CUENCA DEL PLATA) ---
async function fetchPronosticosINA(datosAnteriores = null) {
    try {
        console.log("  → Consultando catálogo de pronósticos INA (seriesProno)...");
        const resCat = await fetch("https://alerta.ina.gob.ar/pub/datos/seriesProno&format=json", {
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(15000)
        });
        if (!resCat.ok) throw new Error(`HTTP ${resCat.status} en seriesProno`);
        const catJson = await resCat.json();
        const lista = catJson.data || [];
        if (lista.length === 0) throw new Error("Listado seriesProno vacío");

        const estacionesObjetivo = [
            { key: 'iguazu',     nombre: 'Puerto Iguazú', cuenca: 'Río Iguazú / Alto Paraná', var: 'Altura hidrométrica media semanal' },
            { key: 'corrientes', nombre: 'Corrientes',     cuenca: 'Río Paraná (Confluencia)', var: 'Altura hidrométrica media semanal' },
            { key: 'parana',     nombre: 'Paraná',         cuenca: 'Río Paraná Medio',         var: 'Altura hidrométrica media semanal' },
            { key: 'rosario',    nombre: 'Rosario',        cuenca: 'Río Paraná Inferior',      var: 'Altura hidrométrica media semanal' }
        ];

        const hoy = new Date();
        const timeStart = hoy.toISOString().split('T')[0];
        const futuro = new Date(hoy.getTime() + 25 * 86400000);
        const timeEnd = futuro.toISOString().split('T')[0];

        const resultado = {
            fuente: "Instituto Nacional del Agua (INA - SIyAH)",
            actualizadoEn: hoy.toISOString(),
            estaciones: {}
        };

        for (const est of estacionesObjetivo) {
            const s = lista.find(x => x.estacion_nombre === est.nombre && x.var_nombre === est.var);
            if (!s) {
                console.log(`  ⚠️ Serie no encontrada para ${est.nombre}`);
                continue;
            }

            try {
                const url = `https://alerta.ina.gob.ar/pub/datos/datosProno&seriesId=${s.seriesid}&corId=${s.corid}&timeStart=${timeStart}&timeEnd=${timeEnd}&format=json`;
                const rData = await fetch(url, {
                    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
                    signal: AbortSignal.timeout(12000)
                }).then(r => r.json());

                if (rData.data && rData.data.length > 0) {
                    const porFecha = {};
                    rData.data.forEach(p => {
                        const f = p.timestart.split('T')[0];
                        if (!porFecha[f]) porFecha[f] = [];
                        porFecha[f].push(parseFloat(p.valor));
                    });

                    const proyecciones = Object.entries(porFecha).map(([f, vals]) => {
                        vals.sort((a, b) => a - b);
                        const [yyyy, mm, dd] = f.split('-');
                        return {
                            fechaIso: f,
                            fechaStr: `${dd}/${mm}/${yyyy}`,
                            min: parseFloat(vals[0].toFixed(2)),
                            esperado: parseFloat((vals.length === 3 ? vals[1] : vals[0]).toFixed(2)),
                            max: parseFloat(vals[vals.length - 1].toFixed(2))
                        };
                    });

                    // Ordenar por fecha cronológicamente
                    proyecciones.sort((a, b) => new Date(a.fechaIso) - new Date(b.fechaIso));

                    // Calcular tendencia general entre la primera y última proyección
                    let tendencia = "estable";
                    if (proyecciones.length >= 2) {
                        const dif = proyecciones[proyecciones.length - 1].esperado - proyecciones[0].esperado;
                        if (dif > 0.15) tendencia = "crecida";
                        else if (dif < -0.15) tendencia = "bajante";
                    }

                    resultado.estaciones[est.key] = {
                        nombre: est.nombre,
                        cuenca: est.cuenca,
                        fechaEmision: s.forecastdate,
                        tendencia,
                        proyecciones
                    };
                    console.log(`  ✅ Pronóstico INA ${est.nombre}: ${proyecciones.length} semanas procesadas`);
                }
            } catch (e) {
                console.log(`  ⚠️ Error datosProno ${est.nombre}: ${e.message}`);
            }
        }

        if (Object.keys(resultado.estaciones).length > 0) {
            return resultado;
        }
    } catch (e) {
        console.log(`⚠️ Error general en pronósticos INA: ${e.message}`);
    }

    if (datosAnteriores?.pronosticosINA) {
        console.log("  ↩️ Manteniendo pronósticos INA anteriores.");
        return datosAnteriores.pronosticosINA;
    }
    return null;
}

// --- HELPER PRONÓSTICO DE SUDESTADA (RÍO DE LA PLATA) ---
function calcularPronosticoSudestada(lpDatos, pronostico, viento) {
    const alturaActual = lpDatos ? parseFloat(lpDatos.altura) : 0;
    const pleamar = pronostico?.pleamar;
    const pleamarAlt = pleamar ? parseFloat(pleamar.altura) : 0;
    const velViento = viento ? parseFloat(viento.velocidad) : 0;
    const dirViento = viento?.direccion || "";

    // Viento del Sureste favorable a sudestada (SE, SSE, S, ESE)
    const esVientoSudeste = /SE|Sureste|Sur|SSE|ESE/i.test(dirViento) && velViento >= 20;
    const esVientoFuerte = esVientoSudeste && velViento >= 35;

    // Altura crítica proyectada (considera la próxima pleamar o el nivel actual)
    const alturaProyectada = Math.max(alturaActual, pleamarAlt);

    let estado = "sin_riesgo";
    let nivelAlerta = "verde";
    let titulo = "🟢 Sin previsión de sudestada para las próximas 24 hs";
    let mensaje = pleamar
        ? `Pleamar máxima prevista: ${pleamarAlt.toFixed(2)}m (${pleamar.fecha} a las ${pleamar.hora} hs). Viento: ${velViento} km/h ${dirViento}. Condiciones habituales de marea.`
        : "Nivel de marea dentro de parámetros habituales.";

    if (alturaProyectada >= 2.80) {
        estado = "alerta_critica";
        nivelAlerta = "rojo";
        titulo = "🚨 ALERTA ROJA: PREVISIÓN DE SUDESTADA CRÍTICA";
        mensaje = `Se prevé pleamar de ${alturaProyectada.toFixed(2)}m (supera umbral de evacuación de 2.80m)${pleamar ? ` hacia las ${pleamar.hora} hs del ${pleamar.fecha}` : ''}. Viento del ${dirViento} a ${velViento} km/h. Riesgo de anegamiento costero en Ensenada, Berisso, Quilmes y Tigre.`;
    } else if (alturaProyectada >= 2.50) {
        estado = "alerta_preventiva";
        nivelAlerta = "naranja";
        titulo = "⚠️ ALERTA NARANJA: PREVISIÓN DE SUDESTADA";
        mensaje = `Se prevé pleamar de ${alturaProyectada.toFixed(2)}m (supera umbral de alerta de 2.50m)${pleamar ? ` hacia las ${pleamar.hora} hs del ${pleamar.fecha}` : ''}. Viento del ${dirViento} a ${velViento} km/h. Se recomienda precaución en zonas bajas ribereñas.`;
    } else if (esVientoFuerte && alturaProyectada >= 2.10) {
        estado = "precaucion";
        nivelAlerta = "amarillo";
        titulo = "🟡 AVISO PREVENTIVO: VIENTO FUERTE DEL SE CON RÍO EN ASCENSO";
        mensaje = `Viento sostenido del ${dirViento} (${velViento} km/h) con pleamar esperada de ${alturaProyectada.toFixed(2)}m. Posible represamiento de aguas en la costa rioplatense.`;
    }

    return {
        estado,
        nivelAlerta,
        titulo,
        mensaje,
        alturaActual: alturaActual > 0 ? alturaActual.toFixed(2) : null,
        alturaProyectada: alturaProyectada > 0 ? alturaProyectada.toFixed(2) : null,
        proximaPleamar: pleamar || null,
        viento: viento ? { velocidad: velViento, direccion: dirViento, esSudeste: esVientoSudeste } : null,
        actualizadoEn: new Date().toISOString()
    };
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
                ts:       fechaMed.getTime(),
                textoFB:  `${altStr}m (a las ${hhmm} hs)`
            };
        }
    }
    return null;
}

        // ---- 1. LA PLATA ----
        let lpDatos = null;

        // 1. Fuente Primaria: AGPSE (lecturas cada 10 minutos cuando funciona con normalidad)
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
            // Si AGPSE no actualiza hace más de 75 minutos, se conmuta a SHN para no demorar datos frescos
            if (lpDatos) {
                const [d, m, y] = lpDatos.fechaStr.split('/');
                const [hh, mm]  = lpDatos.horaStr.split(':');
                const fechaMed  = new Date(+y, +m - 1, +d, +hh, +mm);
                if (esAntiguo(fechaMed, 1.25)) {
                    console.log(`  ⚠️ AGPSE La Plata sin actualizar (${lpDatos.fechaStr} ${lpDatos.horaStr} - >75 min). Conmutando a SHN...`);
                    lpDatos = null;
                }
            }
        } catch (e) { console.log("⚠️ Error La Plata AGPSE:", e.message); }

        // 2. Fuente Secundaria / Fallback activo: SHN Alturas Horarias (horario oficial con historial)
        if (!lpDatos) {
            try {
                console.log("  → Conmutando a SHN Alturas Horarias para La Plata...");
                lpDatos = await fetchSHN_AlturasHorarias('LPLA', 'La Plata');
                if (lpDatos && lpDatos.antiguo) lpDatos = null;
            } catch (e) {
                console.log("⚠️ Error La Plata SHN:", e.message);
            }
        }
        
        // 3. Fallback terciario: INA API a5 (Serie 3314) / GeoServer
        if (!lpDatos) {
            lpDatos = await fetchGeoServerINA("-35.1,-58.2,-34.5,-57.5", "La Plata", [3314]);
        }

        // ---- VIENTO ----
        let viento = null;
        try {
            const rc = await fetch(urlClima);
            const dc = await rc.json();
            viento = {
                velocidad:   dc.current_weather.windspeed,
                direccion:   gradosACardinal(dc.current_weather.winddirection),
                temperatura: dc.current_weather.temperature
            };
        } catch (e) { console.log("⚠️ Error clima:", e.message); }

        // ---- PRONÓSTICO ----
        let pronostico = null;
        try {
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
            console.log("  → Fuente primaria AGPSE para Iguazú...");
            // Intentar HTTP primero con timeout acotado de 5s para conmutar rápido si AGPSE está bloqueado
            const resAgpse = await fetch(urlIguazu, { signal: AbortSignal.timeout(5000) })
                .catch(() => fetch("https://hidrografia2.agpse.gob.ar/histdat/PUERTO_IGUAZU.dat", { signal: AbortSignal.timeout(5000) }));
            if (resAgpse && resAgpse.ok) {
                const t = await resAgpse.text();
                igDatos = parseAGPSE(t);
            }
        } catch (e) { console.log("⚠️ Error Iguazú primario AGPSE:", e.message); }

        // Si AGPSE falló o el dato es antiguo (>24h), arbitrar entre Telemetría INA y Escala Prefectura (PNA)
        // Regla: La telemetría INA (Serie 36964, cadencia 30 min) tiene prioridad por defecto debido a su
        // menor período de actualización.
        // Excepción: Si Prefectura (PNA) informa una altura superior y más actualizada (o si la telemetría
        // automática está trabada/saturada), se le asigna prioridad a la altura de Prefectura.
        if (!igDatos || igDatos.antiguo) {
            let inaAuto = null;
            let pnaOficial = null;

            // 1. Telemetría automática INA (Serie 36964: RHN-SAT estación 7277, cada 30 min)
            try {
                console.log("  → Consultando telemetría automática INA para Iguazú (Serie 36964)...");
                inaAuto = await fetchINA_a5([36964], "Iguazú (Telemetría INA 30m)");
            } catch (e) { console.log("  ⚠️ Error telemetría INA 36964:", e.message); }

            // 2. Escala oficial de Prefectura (PNA) vía Serie 9 de INA (tabla alturas_prefe id 20)
            try {
                console.log("  → Consultando escala oficial PNA para Iguazú (Serie 9)...");
                pnaOficial = await fetchINA_a5([9], "Iguazú (Escala PNA Serie 9)");
            } catch (e) { console.log("  ⚠️ Error escala PNA Serie 9:", e.message); }

            // 3. Respaldo directo: Web oficial de Prefectura Naval Argentina (PNA)
            try {
                console.log("  → Consultando web de Prefectura (PNA) para Iguazú...");
                const pnaWeb = await fetchPrefecturaPNA('Puerto Iguazú', /PUERTO IGUAZU\b[^\d]*(\d+[\.,]\d{1,2})\s+[-+]?\d+[\.,]\d{1,2}\s+\d+\s+(\d{2}\/[A-Z]{3}\/\d{2})\s*-\s*(\d{2}\d{2})/i);
                if (pnaWeb) {
                    if (!pnaOficial || (pnaWeb.ts || 0) >= (pnaOficial.ts || 0)) {
                        pnaOficial = pnaWeb;
                    }
                }
            } catch (e) { console.log("  ⚠️ Error Iguazú PNA web:", e.message); }

            // 4. Arbitraje inteligente según la regla establecida
            if (inaAuto && pnaOficial) {
                const altINA = parseFloat(inaAuto.altura);
                const altPNA = parseFloat(pnaOficial.altura);
                const tsINA  = inaAuto.ts || 0;
                const tsPNA  = pnaOficial.ts || 0;

                const pnaEsSuperior      = !isNaN(altPNA) && !isNaN(altINA) && (altPNA > altINA);
                const pnaEsMasNueva      = tsPNA >= tsINA;
                const pnaReciente        = !pnaOficial.antiguo;
                const pnaDiferenciaMayor = pnaEsSuperior && (altPNA - altINA >= 0.5);

                if (inaAuto.trabado) {
                    console.log(`  🚨 Telemetría INA trabada/saturada en ${altINA}m. Se asigna prioridad a Prefectura (${altPNA}m @ ${pnaOficial.horaStr} hs).`);
                    igDatos = pnaOficial;
                } else if (pnaEsSuperior && (pnaEsMasNueva || inaAuto.antiguo)) {
                    console.log(`  🚨 PNA informa altura SUPERIOR (${altPNA}m @ ${pnaOficial.horaStr} hs) y MÁS ACTUALIZADA que telemetría INA (${altINA}m @ ${inaAuto.horaStr} hs). Se asigna prioridad a Prefectura.`);
                    igDatos = pnaOficial;
                } else if (pnaDiferenciaMayor && pnaReciente) {
                    console.log(`  🚨 PNA informa altura significativamente SUPERIOR (+${(altPNA - altINA).toFixed(2)}m: ${altPNA}m vs ${altINA}m) y vigente. Sensor automático posiblemente saturado/sumergido. Se asigna prioridad a Prefectura.`);
                    igDatos = pnaOficial;
                } else if (!inaAuto.antiguo) {
                    console.log(`  ✅ Telemetría INA priorizada por cadencia corta (30 min): ${altINA}m @ ${inaAuto.horaStr} hs (PNA informó ${altPNA}m @ ${pnaOficial.horaStr} hs).`);
                    igDatos = inaAuto;
                } else {
                    igDatos = pnaReciente ? pnaOficial : inaAuto;
                }
            } else if (inaAuto && !inaAuto.trabado && !inaAuto.antiguo) {
                console.log(`  ✅ Telemetría INA seleccionada: ${inaAuto.altura}m @ ${inaAuto.horaStr} hs.`);
                igDatos = inaAuto;
            } else if (pnaOficial) {
                console.log(`  ✅ Escala Prefectura (PNA) seleccionada: ${pnaOficial.altura}m @ ${pnaOficial.horaStr} hs.`);
                igDatos = pnaOficial;
            } else if (inaAuto) {
                igDatos = inaAuto;
            }
        }

        // ---- 3. CONCORDIA ----
        let coDatos = null;
        try {
            const r  = await fetch(urlConcordia);
            if (!r.ok) throw new Error("HTTP error");
            const t  = (await r.text()).replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            const idx = t.indexOf("Concordia");
            const blq = t.substring(idx, idx + 150);
            const mA  = blq.match(/(\d+[.,]\d{1,2})/);
            const mH  = blq.match(/(\d{2}:\d{2})/);
            const mF  = blq.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (mA && mH && mF) {
                const altVal = parseFloat(mA[1].replace(',', '.'));
                const [d, m, y] = mF[1].split('/');
                const [hh, mm]  = mH[1].split(':');
                const fechaMed  = new Date(+y, +m - 1, +d, +hh, +mm);
                const antiguo   = esAntiguo(fechaMed);
                if (!antiguo && !isNaN(altVal) && altVal > 0.5) {
                    coDatos = {
                        altura:   altVal.toFixed(2),
                        horaStr:  mH[1],
                        fechaStr: mF[1],
                        fuente:   "SRH",
                        antiguo:  false,
                        textoFB:  `${altVal.toFixed(2)}m (a las ${mH[1]} hs)`
                    };
                }
            }
        } catch (e) { console.log("⚠️ Error Concordia primario:", e.message); }

        if (!coDatos) {
            coDatos = await fetchGeoServerINA("-31.41,-58.03,-31.38,-57.99", "Concordia", [79]);
            if (coDatos && parseFloat(coDatos.altura) <= 0.5) coDatos = null;
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
                const mA = tCARU.match(/Salto Grande Aguas Arriba\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})\s*(\d+[.,]\d{1,2})/i);
                const mB = tCARU.match(/Salto Grande Aguas Abajo\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})\s*(\d+[.,]\d{1,2})/i);

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
                        textoFB:  `${mA[3].replace(',', '.')}m (a las ${mA[2]} hs)`
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
                        textoFB:  `${mB[3].replace(',', '.')}m (a las ${mB[2]} hs)`
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

            // Salvaguarda: si la diferencia excede un umbral físicamente anómalo para una hora (> 4.0m),
            // indica cambio de escala/estación o discrepancia entre fuentes dispares.
            if (Math.abs(diff) > 4.0) {
                return { icono: '⚠️', estado: 'discrepancia', texto: `Discrepancia de fuente (${diffStr}m)`, diferencia: diffStr };
            }

            if (diff > 0) {
                return { icono: '⬆️', estado: 'subiendo', texto: `Subiendo (${diffStr}m)`, diferencia: diffStr };
            } else {
                return { icono: '⬇️', estado: 'bajando', texto: `Bajando (${diffStr}m)`, diferencia: diffStr };
            }
        }

        // --- FUNCIÓN PARA PROCESAR EL HISTORIAL DE HASTA 48 REGISTROS ---
        function getHistorico(puertoKey, nuevoDato, subKey = null, minAlturaValida = -5.0) {
            let hist = [];
            if (subKey && datosAnteriores[puertoKey] && datosAnteriores[puertoKey][subKey]) {
                hist = datosAnteriores[puertoKey][subKey].historico || [];
            } else if (!subKey && datosAnteriores[puertoKey]) {
                hist = datosAnteriores[puertoKey].historico || [];
            }
            // Filtrar lecturas corruptas o inválidas del historial
            hist = hist.filter(h => h && !isNaN(parseFloat(h.altura)) && parseFloat(h.altura) > minAlturaValida);

            // Depuración de lecturas espurias en Iguazú:
            // Si la fuente activa es PNA (o hay lecturas oficiales de Prefectura), limpiar del historial
            // las lecturas repetitivas de 28.52m generadas mientras el sensor satelital estuvo trabado/saturado
            if (puertoKey === 'iguazu' && nuevoDato && nuevoDato.fuente === 'PNA') {
                hist = hist.filter(h => h.altura !== '28.52');
            }

            // Incorporar lote histórico si nuevoDato lo provee (ej. SHN o INA API a5)
            if (nuevoDato && Array.isArray(nuevoDato.historialLecturas)) {
                for (const l of nuevoDato.historialLecturas) {
                    if (l && !isNaN(parseFloat(l.altura)) && parseFloat(l.altura) > minAlturaValida) {
                        const yaExiste = hist.some(h => h.fechaStr === l.fechaStr && h.horaStr === l.horaStr);
                        if (!yaExiste) {
                            hist.push({
                                altura: l.altura,
                                fechaStr: l.fechaStr,
                                horaStr: l.horaStr
                            });
                        }
                    }
                }
            }

            if (nuevoDato && !nuevoDato.antiguo && parseFloat(nuevoDato.altura) > minAlturaValida) {
                const ultimo = hist.length > 0 ? hist[hist.length - 1] : null;
                // Evitamos sumar la medición si ya está guardada (misma fecha y hora)
                if (!ultimo || ultimo.fechaStr !== nuevoDato.fechaStr || ultimo.horaStr !== nuevoDato.horaStr) {
                    const yaExiste = hist.some(h => h.fechaStr === nuevoDato.fechaStr && h.horaStr === nuevoDato.horaStr);
                    if (!yaExiste) {
                        hist.push({
                            altura: nuevoDato.altura,
                            fechaStr: nuevoDato.fechaStr,
                            horaStr: nuevoDato.horaStr
                        });
                    }
                }
            }

            // Ordenar cronológicamente para garantizar consistencia tras backfills
            hist.sort((a, b) => {
                const [da, ma, ya] = a.fechaStr.split('/');
                const [ha, mina] = a.horaStr.split(':');
                const [db, mb, yb] = b.fechaStr.split('/');
                const [hb, minb] = b.horaStr.split(':');
                return new Date(+ya, +ma - 1, +da, +ha, +mina) - new Date(+yb, +mb - 1, +db, +hb, +minb);
            });

            // Retorna hasta los últimos 48 elementos para un historial de 48h
            return hist.slice(-48);
        }

        // ---- ASIGNACIÓN DE NIVELES DE ALERTA / EVACUACIÓN, HISTORIAL Y TENDENCIA ----
        if (lpDatos) { 
            lpDatos.alerta = 2.5; 
            lpDatos.evacuacion = 2.8; 
            lpDatos.historico = getHistorico('laplata', lpDatos);
            delete lpDatos.historialLecturas;
            lpDatos.tendencia = calcularTendencia(lpDatos.historico, lpDatos.altura);
        } else if (datosAnteriores.laplata) {
            lpDatos = datosAnteriores.laplata;
        }

        if (igDatos) { 
            igDatos.alerta = 25.0; 
            igDatos.evacuacion = 28.0; 
            igDatos.historico = getHistorico('iguazu', igDatos);
            delete igDatos.historialLecturas;
            igDatos.tendencia = calcularTendencia(igDatos.historico, igDatos.altura);
        } else if (datosAnteriores.iguazu) {
            igDatos = datosAnteriores.iguazu;
        }

        if (coDatos) { 
            coDatos.alerta = 11.0; 
            coDatos.evacuacion = 12.5; 
            coDatos.historico = getHistorico('concordia', coDatos, null, 0.5);
            delete coDatos.historialLecturas;
            coDatos.tendencia = calcularTendencia(coDatos.historico, coDatos.altura);
        } else if (datosAnteriores.concordia && parseFloat(datosAnteriores.concordia.altura) > 0.5) {
            coDatos = datosAnteriores.concordia;
            coDatos.historico = getHistorico('concordia', null, null, 0.5);
        }

        if (sjDatos) {
            sjDatos.alerta = 8.0;
            sjDatos.evacuacion = 10.0;
            sjDatos.historico = getHistorico('sanjavier', sjDatos);
            delete sjDatos.historialLecturas;
            sjDatos.tendencia = calcularTendencia(sjDatos.historico, sjDatos.altura);
        } else if (datosAnteriores.sanjavier) {
            sjDatos = datosAnteriores.sanjavier;
        }

        if (stDatos) {
            stDatos.alerta = 11.5;
            stDatos.evacuacion = 12.5;
            stDatos.historico = getHistorico('santotome', stDatos);
            delete stDatos.historialLecturas;
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

        // ---- 7. PRONÓSTICOS HIDROLÓGICOS INA Y PREVISIÓN DE SUDESTADA ----
        console.log("\n[INA] Obteniendo Pronósticos Hidrológicos Oficiales del INA...");
        const pronosticosINA = await fetchPronosticosINA(datosAnteriores);
        const pronosticoSudestada = calcularPronosticoSudestada(lpDatos, pronostico, viento);

        // ---- GENERAR data.json PARA EL SITIO WEB ----
        const dataJson = {
            schemaVersion: "1.0.0",
            fechaReporte,
            generadoEn: ahora.toISOString(),
            laplata:    lpDatos,
            viento,
            pronostico,
            pronosticoSudestada,
            pronosticosINA,
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
        const sudTxt = (pronosticoSudestada && pronosticoSudestada.estado !== 'sin_riesgo')
            ? `\n\n${aNegrita("AVISO:")} ${pronosticoSudestada.titulo}\n${pronosticoSudestada.mensaje}`
            : "";

        const msg = `🌊 ${aNegrita("REPORTE FLUVIAL")} 🌊
📅 ${fechaReporte}

📍 ${aNegrita("LA PLATA")} (${lpDatos?.fechaStr ?? hoy})
📏 Altura: ${aNegrita(lpTxt)}
🌬️ Viento: ${viTxt}

⚓ ${aNegrita("SHN:")}
${prTxt}${sudTxt}

📍 ${aNegrita("IGUAZÚ")} (${igDatos?.fechaStr ?? hoy})
📏 Altura: ${aNegrita(igTxt)}

📍 ${aNegrita("SAN JAVIER")} (${sjDatos?.fechaStr ?? hoy})
📏 Altura: ${aNegrita(sjTxt)}

📍 ${aNegrita("SANTO TOMÉ")} (${stDatos?.fechaStr ?? hoy})
📏 Altura: ${aNegrita(stTxt)}

📍 ${aNegrita("CONCORDIA")} (${coDatos?.fechaStr ?? hoy})
📏 Altura: ${aNegrita(coTxt)}

⚠️ ${aNegrita("EMBALSE SALTO GRANDE")}
🔽 Cota Embalse (Arriba): ${aNegrita(sgArribaTxt)}
🔼 Restitución (Abajo): ${aNegrita(sgAbajoTxt)}`;

        console.log("\n📄 PUBLICACIÓN FACEBOOK:\n", msg);

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

    } catch (e) {
        console.error("Error fatal:", e.message);
    }
}

obtenerDatos();
