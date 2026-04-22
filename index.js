// index.js

const urlLaPlata = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";
const urlClima = "https://api.open-meteo.com/v1/forecast?latitude=-34.8339&longitude=-57.8803&current_weather=true&timezone=America/Argentina/Buenos_Aires";
const urlPronostico = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";

// Nuevas URLs
const urlIguazu = "https://hidrografia2.agpse.gob.ar/histdat/PUERTOIGUAZU.dat"; // Podría llamarse IGUAZU.dat, a confirmar
const urlConcordia = "http://190.0.152.194:8080/alturas/web/user/alturas";

function gradosACardinal(grados) {
    const direcciones = ['Norte (N)', 'Noreste (NE)', 'Este (E)', 'Sureste (SE)', 'Sur (S)', 'Suroeste (SW)', 'Oeste (W)', 'Noroeste (NW)'];
    return direcciones[Math.round(grados / 45) % 8];
}

async function obtenerDatos() {
    try {
        console.log("Iniciando recolección masiva de datos fluviales...");

        // --- 1. LA PLATA ---
        const resAltura = await fetch(urlLaPlata);
        const dataAltura = await resAltura.text();
        const valoresLP = dataAltura.trim().split('\n').pop().split(',');
        const fechaCruda = valoresLP[0].replace(/['"]/g, ''); 
        const alturaLP = parseFloat(valoresLP[3]).toFixed(2);
        
        const [fechaParte, horaParte] = fechaCruda.split(' ');
        const [anio, mes, dia] = fechaParte.split('-');
        const fechaFormateada = `${dia}/${mes}/${anio} a las ${horaParte.substring(0,5)}`;

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
            const matchMarea = htmlPronostico.match(/PUERTO LA PLATA\s*PLEAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2}).*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})/i);
            if (matchMarea) infoPronostico = `📈 Pleamar: ${matchMarea[2]}m a las ${matchMarea[1]} hs\n📉 Bajamar: ${matchMarea[4]}m a las ${matchMarea[3]} hs`;
        } catch (e) {}

        // --- 2. IGUAZÚ ---
        let alturaIguazu = "N/D";
        try {
            const resIguazu = await fetch(urlIguazu);
            if (resIguazu.ok) {
                const dataIguazu = await resIguazu.text();
                const valoresIg = dataIguazu.trim().split('\n').pop().split(',');
                alturaIguazu = parseFloat(valoresIg[3]).toFixed(2) + "m";
            } else {
                alturaIguazu = "Error de URL (Revisar F12)";
            }
        } catch (e) {}

        // --- 3. CONCORDIA ---
        let alturaConcordia = "N/D";
        try {
            const resConcordia = await fetch(urlConcordia);
            const htmlConcordia = await resConcordia.text();
            const textoLimpioCo = htmlConcordia.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            
            // Buscamos "Concordia" y capturamos el primer número con decimales que le siga
            const regexConcordia = /Concordia.*?(\d+[,.]\d{1,2})/i;
            const matchCo = textoLimpioCo.match(regexConcordia);
            
            if (matchCo) {
                alturaConcordia = matchCo[1].replace(',', '.') + "m";
            } else {
                alturaConcordia = "Dato no encontrado en la tabla";
            }
        } catch (e) {
            alturaConcordia = "Error de conexión";
        }

        // --- 4. ARMADO Y ENVÍO DEL MENSAJE ---
        const telefono = process.env.TELEFONO; 
        const apiKey = process.env.API_KEY;

        if (!telefono || !apiKey) return console.log("⚠️ Faltan Secrets en GitHub.");

        // Diseñamos un reporte limpio y ordenado
        const mensaje = `🌊 *REPORTE FLUVIAL* 🌊\n📅 ${fechaFormateada} hs\n\n📍 *Puerto La Plata*\n📏 Altura: *${alturaLP}m*\n🌬️ Viento: ${infoViento}\n*Pronóstico SHN:*\n${infoPronostico}\n\n📍 *Puerto Iguazú*\n📏 Altura: *${alturaIguazu}*\n\n📍 *Concordia*\n📏 Altura: *${alturaConcordia}*`;
        
        const textoCodificado = encodeURIComponent(mensaje);
        const callMeBotUrl = `https://api.callmebot.com/whatsapp.php?phone=${telefono}&text=${textoCodificado}&apikey=${apiKey}`;
        
        const botResponse = await fetch(callMeBotUrl);
        if (botResponse.ok) console.log("✅ ¡Reporte masivo enviado con éxito!");

    } catch (error) {
        console.error("❌ Error general:", error.message);
    }
}

obtenerDatos();
