// index.js - Versión Multireceptor con Fecha SHN

const urlLaPlata = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";
const urlClima = "https://api.open-meteo.com/v1/forecast?latitude=-34.8339&longitude=-57.8803&current_weather=true&timezone=America/Argentina/Buenos_Aires";
const urlPronostico = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";
const urlIguazu = "https://hidrografia2.agpse.gob.ar/histdat/PUERTO_IGUAZU.dat";
const urlConcordia = "http://190.0.152.194:8080/alturas/web/user/alturas";

function gradosACardinal(grados) {
    const direcciones = ['Norte (N)', 'Noreste (NE)', 'Este (E)', 'Sureste (SE)', 'Sur (S)', 'Suroeste (SW)', 'Oeste (W)', 'Noroeste (NW)'];
    return direcciones[Math.round(grados / 45) % 8];
}

async function obtenerDatos() {
    try {
        console.log("Iniciando recolección masiva de datos fluviales...");

        const ahora = new Date();
        const fechaReporte = `${ahora.getDate().toString().padStart(2, '0')}/${(ahora.getMonth()+1).toString().padStart(2, '0')}/${ahora.getFullYear()} a las ${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')} hs`;

        // --- 1. LA PLATA ---
        let alturaLP = "N/D";
        let fechaFormateada = fechaReporte;
        try {
            const resAltura = await fetch(urlLaPlata);
            if (resAltura.ok) {
                const dataAltura = await resAltura.text();
                const valoresLP = dataAltura.trim().split('\n').pop().split(',');
                const fechaCruda = valoresLP[0].replace(/['"]/g, ''); 
                alturaLP = parseFloat(valoresLP[3]).toFixed(2) + "m";
                
                const [fechaParte, horaParte] = fechaCruda.split(' ');
                const [anio, mes, dia] = fechaParte.split('-');
                fechaFormateada = `${dia}/${mes}/${anio} a las ${horaParte.substring(0,5)} hs (medición)`;
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

        // Pronóstico La Plata (AHORA CON FECHA)
        let infoPronostico = "N/D";
        try {
            const resPronostico = await fetch(urlPronostico);
            // Limpiamos el HTML para que quede como texto plano separado por espacios
            const htmlPronostico = await resPronostico.text().then(t => t.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' '));
            
            // Buscamos: Estado -> Hora (Grupo 1) -> Altura (Grupo 2) -> Fecha (Grupo 3)
            // Usamos PLEA-?MAR por si el gobierno a veces le pone el guion y a veces no
            const matchPleamar = htmlPronostico.match(/PUERTO LA PLATA.*?PLEA-?MAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            const matchBajamar = htmlPronostico.match(/PUERTO LA PLATA.*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})\s*(\d{2}\/\d{2}\/\d{4})/i);
            
            // Armamos el texto cortando el año para que quede más prolijo (ej. 22/04)
            const txtPleamar = matchPleamar ? `${matchPleamar[2]}m el ${matchPleamar[3].substring(0,5)} a las ${matchPleamar[1]} hs` : "Sin datos";
            const txtBajamar = matchBajamar ? `${matchBajamar[2]}m el ${matchBajamar[3].substring(0,5)} a las ${matchBajamar[1]} hs` : "Sin datos";
            
            infoPronostico = `📈 Pleamar: ${txtPleamar}\n📉 Bajamar: ${txtBajamar}`;
        } catch (e) {}

        // --- 2. IGUAZÚ ---
        let alturaIguazu = "N/D";
        try {
            const resIguazu = await fetch(urlIguazu);
            if (resIguazu.ok) {
                const dataIguazu = await resIguazu.text();
                const valoresIg = dataIguazu.trim().split('\n').pop().split(',');
                const fechaCrudaIg = valoresIg[0].replace(/['"]/g, '');
                const horaIg = fechaCrudaIg.split(' ')[1].substring(0,5);
                alturaIguazu = `${parseFloat(valoresIg[3]).toFixed(2)}m (a las ${horaIg} hs)`;
            }
        } catch (e) {}

        // --- 3. CONCORDIA ---
        let alturaConcordia = "N/D";
        try {
            const resConcordia = await fetch(urlConcordia);
            const htmlConcordia = await resConcordia.text();
            const textoLimpioCo = htmlConcordia.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            const indexCo = textoLimpioCo.indexOf("Concordia");
            if (indexCo !== -1) {
                const bloqueConcordia = textoLimpioCo.substring(indexCo, indexCo + 150);
                const matchAltura = bloqueConcordia.match(/(\d+[,.]\d{1,2})/);
                const matchHora = bloqueConcordia.match(/(\d{2}:\d{2})/);
                const altCo = matchAltura ? matchAltura[1].replace(',', '.') + "m" : "N/D";
                const horaCo = matchHora ? ` (a las ${matchHora[1]} hs)` : "";
                alturaConcordia = altCo + horaCo;
            }
        } catch (e) {}

        // --- 4. ENVÍO MULTI-RECEPTOR ---
        const listaTelefonos = process.env.TELEFONO ? process.env.TELEFONO.split(',') : [];
        const apiKey = process.env.API_KEY;

        if (listaTelefonos.length === 0 || !apiKey) return console.log("⚠️ Faltan Secrets (TELEFONO o API_KEY).");

        const mensaje = `🌊 *REPORTE FLUVIAL* 🌊\n📅 ${fechaFormateada}\n\n📍 *Puerto La Plata*\n📏 Altura: *${alturaLP}*\n🌬️ Viento: ${infoViento}\n*Pronóstico SHN:*\n${infoPronostico}\n\n📍 *Puerto Iguazú*\n📏 Altura: *${alturaIguazu}*\n\n📍 *Concordia*\n📏 Altura: *${alturaConcordia}*`;
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
