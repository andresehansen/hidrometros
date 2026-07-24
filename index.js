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
    return Math.abs(obtenerHoraArgentina() - fechaMedicion) / 36e5 > 24;
}

// --- HELPERS INA ---

// Convierte una observación INA a nuestro formato estándar
function parsearObsINA(prop) {
    const fechaZ  = new Date(prop.fecha);
    const argTime = new Date(fechaZ.getTime() - 3 * 3600 * 1000);
    const fecha   = `${argTime.getUTCDate().toString().padStart(2,'0')}/${(argTime.getUTCMonth()+1).toString().padStart(2,'0')}/${argTime.getUTCFullYear()}`;
    const hora    = `${argTime.getUTCHours().toString().padStart(2,'0')}:${argTime.getUTCMinutes().toString().padStart(2,'0')}`;
    const antiguo = esAntiguo(argTime);
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
    const fin    = new Date(hoy); fin.setDate(hoy.getDate() + 1);

    for (const sid of seriesIds) {
        try {
            console.log(`  → INA a5 series_id=${sid} para ${nombrePuerto}...`);
            const url = `https://alerta.ina.gob.ar/a5/obs/puntual/series/${sid}/observaciones?timestart=${formatoFechaAPI(inicio)}&timeend=${formatoFechaAPI(fin)}&order=desc&limit=1`;
            const res = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
                signal: AbortSignal.timeout(15000)
            });
            if (!res.ok) { console.log(`  ⚠️ a5 series ${sid}: HTTP ${res.status}`); continue; }
            const data = await res.json();
            const obs = Array.isArray(data) ? data[0] : (data.observaciones || [])[0];
            if (obs && obs.valor !== null && obs.valor !== undefined) {
                console.log(`  ✅ a5 series_id=${sid}: ${obs.valor}m @ ${obs.timestart}`);
                const fechaLocal = new Date(obs.timestart);
                const antiguo = esAntiguo(fechaLocal);
                const dd   = fechaLocal.getDate().toString().padStart(2,'0');
                const mm   = (fechaLocal.getMonth()+1).toString().padStart(2,'0');
                const yyyy = fechaLocal.getFullYear();
                const hh   = fechaLocal.getHours().toString().padStart(2,'0');
                const min  = fechaLocal.getMinutes().toString().padStart(2,'0');
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

    if (!token || !owner || !repo) {
        console.log("⚠️  Sin GITHUB_TOKEN o GITHUB_REPOSITORY — no se genera data.json");
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
            const v = txtDat.trim().split('\n').pop().split(',');
            const [y, m, d] = v[0].replace(/['"]/g, '').split(' ')[0].split('-');
            const fechaMed = new Date(v[0].replace(/['"]/g, '').replace(' ', 'T') + '-03:00');
            const antiguo  = esAntiguo(fechaMed);
            lpDatos = {
                altura:   parseFloat(v[3]).toFixed(2),
                horaStr:  v[0].replace(/['"]/g, '').split(' ')[1].substring(0, 5),
                fechaStr: `${d}/${m}/${y}`,
                fuente:   "AGPSE",
                antiguo,
                textoFB:  `${parseFloat(v[3]).toFixed(2)}m (a las ${v[0].replace(/['"]/g, '').split(' ')[1].substring(0, 5)} hs)`
            };
            if (antiguo) lpDatos = null; 
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
            const v = t.trim().split('\n').pop().split(',');
            const [y, m, d] = v[0].replace(/['"]/g, '').split(' ')[0].split('-');
            const fechaMed = new Date(v[0].replace(/['"]/g, ''));
            const antiguo  = esAntiguo(fechaMed);
            igDatos = {
                altura:   parseFloat(v[3]).toFixed(2),
                horaStr:  v[0].replace(/['"]/g, '').split(' ')[1].substring(0, 5),
                fechaStr: `${d}/${m}/${y}`,
                fuente:   "AGPSE",
                antiguo,
                textoFB:  `${parseFloat(v[3]).toFixed(2)}m (a las ${v[0].replace(/['"]/g, '').split(' ')[1].substring(0, 5)} hs)`
            };
            if (antiguo) igDatos = null; 
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
                const fechaMed  = new Date(y, m - 1, d);
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

        // --- FUNCIÓN PARA PROCESAR EL HISTORIAL DE 20 REGISTROS ---
        function getHistorico(puertoKey, nuevoDato) {
            let hist = (datosAnteriores[puertoKey] && datosAnteriores[puertoKey].historico) ? datosAnteriores[puertoKey].historico : [];
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
            // Retorna solo los últimos 20 elementos
            return hist.slice(-20);
        }

        // ---- ASIGNACIÓN DE NIVELES DE ALERTA / EVACUACIÓN Y HISTORIAL ----
        if (lpDatos) { 
            lpDatos.alerta = 2.5; 
            lpDatos.evacuacion = 2.8; 
            lpDatos.historico = getHistorico('laplata', lpDatos);
        } else if (datosAnteriores.laplata) {
            lpDatos = datosAnteriores.laplata;
        }

        if (igDatos) { 
            igDatos.alerta = 25.0; 
            igDatos.evacuacion = 28.0; 
            igDatos.historico = getHistorico('iguazu', igDatos);
        } else if (datosAnteriores.iguazu) {
            igDatos = datosAnteriores.iguazu;
        }

        if (coDatos) { 
            coDatos.alerta = 11.0; 
            coDatos.evacuacion = 12.5; 
            coDatos.historico = getHistorico('concordia', coDatos);
        } else if (datosAnteriores.concordia) {
            coDatos = datosAnteriores.concordia;
        }

        // ---- GENERAR data.json PARA EL SITIO WEB ----
        const dataJson = {
            fechaReporte,
            generadoEn: ahora.toISOString(),
            laplata:    lpDatos,
            viento,
            pronostico,
            iguazu:     igDatos,
            concordia:  coDatos
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
        const viTxt = viento    ? `${viento.velocidad} km/h ${viento.direccion}` : "N/D";
        const prTxt = pronostico
            ? `📈 Pleamar: ${pronostico.pleamar ? pronostico.pleamar.altura+'m el '+pronostico.pleamar.fecha+' '+pronostico.pleamar.hora : 'S/D'}\n📉 Bajamar: ${pronostico.bajamar ? pronostico.bajamar.altura+'m el '+pronostico.bajamar.fecha+' '+pronostico.bajamar.hora : 'S/D'}`
            : "N/D";

        const msg = `🌊 ${aNegrita("REPORTE FLUVIAL")} 🌊\n📅 ${fechaReporte}\n\n📍 ${aNegrita("LA PLATA")} (${lpDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(lpTxt)}\n🌬️ Viento: ${viTxt}\n\n⚓ ${aNegrita("SHN:")}\n${prTxt}\n\n📍 ${aNegrita("IGUAZÚ")} (${igDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(igTxt)}\n\n📍 ${aNegrita("CONCORDIA")} (${coDatos?.fechaStr ?? hoy})\n📏 Altura: ${aNegrita(coTxt)}`;

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
