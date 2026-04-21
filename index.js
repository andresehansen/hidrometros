// index.js

const urlAltura = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";
const urlClima = "https://api.open-meteo.com/v1/forecast?latitude=-34.8339&longitude=-57.8803&current_weather=true";
const urlPronostico = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";

// Convierte los grados del viento en puntos cardinales
function gradosACardinal(grados) {
    const direcciones = ['Norte (N)', 'Noreste (NE)', 'Este (E)', 'Sureste (SE)', 'Sur (S)', 'Suroeste (SW)', 'Oeste (W)', 'Noroeste (NW)'];
    return direcciones[Math.round(grados / 45) % 8];
}

async function obtenerDatos() {
    try {
        console.log("Iniciando recolección de datos...");

        // --- 1. OBTENER ALTURA Y FORMATEAR FECHA ---
        const resAltura = await fetch(urlAltura);
        const dataAltura = await resAltura.text();
        const lineas = dataAltura.trim().split('\n');
        const valores = lineas[lineas.length - 1].split(',');
        
        const fechaCruda = valores[0].replace(/['"]/g, ''); 
        const alturaCruda = parseFloat(valores[3]).toFixed(2);
        
        // Transformamos: "2026-04-21 19:50:00" -> "21/04/2026 a las 19:50"
        const [fechaParte, horaParte] = fechaCruda.split(' ');
        const [anio, mes, dia] = fechaParte.split('-');
        const fechaFormateada = `${dia}/${mes}/${anio} a las ${horaParte.substring(0,5)}`;
        console.log(`✅ Altura extraída: ${alturaCruda}m`);

        // --- 2. OBTENER VIENTO (Vía Open-Meteo) ---
        let infoViento = "No disponible";
        try {
            const resClima = await fetch(urlClima);
            const dataClima = await resClima.json();
            const velViento = dataClima.current_weather.windspeed;
            const dirViento = gradosACardinal(dataClima.current_weather.winddirection);
            infoViento = `${velViento} km/h desde el ${dirViento}`;
            console.log(`✅ Viento extraído: ${infoViento}`);
        } catch (e) {
            console.log("⚠️ No se pudo obtener el viento.");
        }

        // --- 3. OBTENER PRONÓSTICO ESPECÍFICO (Pleamar/Bajamar) ---
        let infoPronostico = "Datos de marea no disponibles.";
        try {
            const resPronostico = await fetch(urlPronostico);
            const htmlPronostico = await resPronostico.text();
            
            // Limpiamos etiquetas HTML y reducimos múltiples espacios a uno solo
            const textoLimpio = htmlPronostico.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            
            // Buscamos los datos exactos de La Plata usando una Expresión Regular
            // Capturamos: Hora Pleamar, Altura Pleamar, Hora Bajamar, Altura Bajamar
            const regexMarea = /PUERTO LA PLATA\s*PLEAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2}).*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})/i;
            const match = textoLimpio.match(regexMarea);
            
            if (match) {
                infoPronostico = `📈 Pleamar: *${match[2]}m* a las ${match[1]} hs\n📉 Bajamar: *${match[4]}m* a las ${match[3]} hs`;
                console.log(`✅ Pronóstico extraído correctamente.`);
            } else {
                infoPronostico = "No se encontró la tabla en SHN.";
                console.log("⚠️ No hizo match la Regex del pronóstico.");
            }
        } catch (e) {
            console.log("⚠️ Error al obtener el pronóstico del SHN.");
        }

        // --- 4. ENVIAR SÚPER MENSAJE POR WHATSAPP ---
        const telefono = process.env.TELEFONO; 
        const apiKey = process.env.API_KEY;

        if (!telefono || !apiKey) {
            console.log("⚠️ Faltan configurar el teléfono o la API Key en GitHub.");
            return;
        }

        // Armamos el mensaje final estructurado
        const mensaje = `🌊 *Puerto La Plata*\n📅 ${fechaFormateada} hs\n📏 Altura actual: *${alturaCruda} metros*\n🌬️ Viento: ${infoViento}\n\n*Pronóstico SHN:*\n${infoPronostico}`;
        
        const textoCodificado = encodeURIComponent(mensaje);
        const callMeBotUrl = `https://api.callmebot.com/whatsapp.php?phone=${telefono}&text=${textoCodificado}&apikey=${apiKey}`;
        
        console.log("Enviando mensaje de WhatsApp...");
        const botResponse = await fetch(callMeBotUrl);
        
        if (botResponse.ok) {
            console.log("✅ ¡Súper mensaje enviado con éxito!");
        } else {
            console.log("❌ Error al enviar el mensaje de WhatsApp.");
        }

    } catch (error) {
        console.error("❌ Error general:", error.message);
    }
}

obtenerDatos();
