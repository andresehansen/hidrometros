// index.js - Reporte Fluvial
// Publica en Facebook Y genera data.json para el sitio web
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

// --- LÓGICA DE RESPALDO INA ---
async function fetchGeoServerINA(bbox, nombrePuerto) {
    try {
        console.log(`  → Plan B INA para ${nombrePuerto}...`);
        const hoy    = obtenerHoraArgentina();
        const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
        const inicio = new Date(hoy); inicio.setDate(hoy.getDate() - 5);

        const url = `https://alerta.ina.gob.ar/geoserver/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&FORMAT=image%2Fpng&TRANSPARENT=true&QUERY_LAYERS=public2%3Aultimas_alturas_con_timeseries&LAYERS=public2%3Aultimas_alturas_con_timeseries&VIEWPARAMS=timeStart%3A${formatoFechaAPI(inicio)}%3BtimeEnd%3A${formatoFechaAPI(manana)}%3B&STYLES=&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=150&I=50&J=50&CRS=EPSG%3A4326&WIDTH=101&HEIGHT=101&BBOX=${bbox}`;

        const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" } });
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            const prop    = data.features[0].properties;
            const fechaZ  = new Date(prop.fecha);
            const argTime = new Date(fechaZ.getTime() - 3 * 3600 * 1000);
            const fecha   = `${argTime.getUTCDate().toString().padStart(2,'0')}/${(argTime.getUTCMonth()+1).toString().padStart(2,'0')}/${argTime.getUTCFullYear()}`;
            const hora    = `${argTime.getUTCHours().toString().padStart(2,'0')}:${argTime.getUTCMinutes().toString().padStart(2,'0')}`;
            const tag     = esAntiguo(argTime) ? " ⚠️ (Dato viejo)" : " (Fuente: INA)";
            return {
                altura:    parseFloat(prop.valor).toFixed(2),
                horaStr:   hora,
                fechaStr:  fecha,
                fuente:    "INA",
                antiguo:   esAntiguo(argTime),
                textoFB:   `${parseFloat(prop.valor).toFixed(2)}m (a las ${hora} hs)${tag}`
            };
        }
    } catch (e) { console.log(`  ⚠️ Error INA ${nombrePuerto}:`, e.message); }
    return null;
}

// --- PUBLICAR data.json EN EL REPO (para que el sitio web lo lea) ---
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

    // Obtener SHA del archivo actual (necesario para actualizar)
    let sha = undefined;
    try {
        const getRes = await fetch(apiUrl, {
            headers: { Authorization: `token ${token}`, "User-Agent": "hidrometros-bot" }
        });
        if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
        }
    } catch (e) { /* Primera vez, no hay SHA */ }

    const body = {
        message: `datos: actualización ${datos.fechaReporte}`,
        content: contenido,
        ...(sha && { sha })
    };

    const putRes = await fetch(apiUrl, {
        method:  "PUT",
        headers: {
            Authorization:  `token ${token}`,
            "Content-Type": "application/json",
            "User-Agent":   "hidrometros-bot"
        },
        body: JSON.stringify(body)
    });

    if (putRes.ok) {
        console.log("✅ data.json actualizado en el repo");
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

        // ---- 1. LA PLATA ----
        // Bbox para Puerto La Plata: -34.92,-57.93 a -34.83,-57.86
        const BBOX_LA_PLATA = "-34.92,-57.93,-34.83,-57.86";
        let lpDatos = null;
        try {
            console.log("  → Fuente primaria AGPSE para La Plata...");
            const r = await fetch(urlLaPlata, { signal: AbortSignal.timeout(12000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const t = await r.text();
            const v = t.trim().split('\n').pop().split(',');
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
            if (antiguo) lpDatos = null; // fuerza fallback si el dato es viejo
        } catch (e) { console.log("⚠️ Error La Plata AGPSE:", e.message); }

        if (!lpDatos) {
            lpDatos = await fetchGeoServerINA(BBOX_LA_PLATA, "La Plata");
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
            const rp = await fetch(urlPronostico);
            const hp = (await rp.text()).replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            const mp = hp.match(/PUERTO LA PLATA.*?PLEA-?MAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            const mb = hp.match(/PUERTO LA PLATA.*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            pronostico = {
                pleamar: mp ? { hora: mp[1], altura: mp[2], fecha: mp[3].substring(0, 5) } : null,
                bajamar: mb ? { hora: mb[1], altura: mb[2], fecha: mb[3].substring(0, 5) } : null
            };
        } catch (e) { console.log("⚠️ Error pronóstico:", e.message); }

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
            if (antiguo) igDatos = null; // fuerza fallback a INA si es viejo
        } catch (e) { console.log("⚠️ Error Iguazú primario:", e.message); }

        if (!igDatos) {
            igDatos = await fetchGeoServerINA(
                "-25.648033618927002,-54.64118957519531,-25.509331226348877,-54.50248718261719",
                "Iguazú"
            );
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
            coDatos = await fetchGeoServerINA(
                "-31.41860783100128,-58.03407669067383,-31.38393223285675,-57.9994010925293",
                "Concordia"
            );
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

        console.log("\n📊 DATOS RECOLECTADOS:");
        console.log(JSON.stringify(dataJson, null, 2));

        await publicarDataJson(dataJson);

        // ---- PUBLICAR EN FACEBOOK ----
        const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
        const pageId          = process.env.FACEBOOK_PAGE_ID;

        const lpTxt = lpDatos   ? lpDatos.textoFB   : "N/D";
        const igTxt = igDatos   ? igDatos.textoFB   : "N/D";
        const coTxt = coDatos   ? coDatos.textoFB   : "N/D";
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
