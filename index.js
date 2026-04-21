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
        
        const [fechaParte, horaParte] = fechaCruda.split(' ');
        const [anio, mes, dia] = fechaParte.split('-');
        const fechaFormateada = `${dia}/${mes}/${anio} a las ${horaParte.substring(0,5)}`;
        console.log(`✅ Altura extraída: ${alturaCruda}m`);

        // --- 2. OBTENER VIENTO CON SU HORA EXACTA ---
        let infoViento = "No disponible";
        try {
            const resClima = await fetch(urlClima);
            const dataClima = await resClima.json();
            const velViento = dataClima.current_weather.windspeed;
            const dirViento = gradosACardinal(dataClima.current_weather.winddirection);
            
            // Extraemos la hora del reporte (Viene como "YYYY-MM-DDTHH:MM")
            const horaVientoIso = dataClima.current_weather.time; 
            const horaViento = horaVientoIso.split('T')[1]; // Nos quedamos con "HH:MM"
            
            infoViento = `${velViento} km/h desde el ${dirViento} (Medido a las ${horaViento} hs)`;
            console.log(`✅ Viento extraído: ${infoViento}`);
        } catch (e) {
            console.log("⚠️ No se pudo obtener el viento.");
        }

        // --- 3. OBTENER PRONÓSTICO ESPECÍFICO ---
        let infoPronostico = "Datos de marea no disponibles.";
        try {
            const resPronostico = await fetch(urlPronostico);
            const htmlPronostico = await resPronostico.text();
            const textoLimpio = htmlPronostico.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');
            
            const regexMarea = /PUERTO LA PLATA\s*PLEAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2}).*?BAJAMAR\s*(\d{2}:\d{2})\s*(\d+\.\d{2})/i;
            const match = textoLimpio.match(regexMarea);
            
            if (match) {
                infoPronostico = `📈 Pleamar: *${match[2]}m* a las ${match[1]} hs\n📉 Bajamar: *${match[4]}m* a las ${match[3]} hs`;
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

        const mensaje = `🌊 *Puerto La Plata*\n📅 ${fechaFormateada} hs\n📏 Altura actual: *${alturaCruda} metros*\n🌬️ Viento: ${infoViento}\n\n*Pronóstico SHN:*\n${infoPronostico}`;
        
        const textoCodificado = encodeURIComponent(mensaje);
        const callMeBotUrl = `https://api.callmebot.com/whatsapp.php?phone=${telefono}&text=${textoCodificado}&apikey=${apiKey}`;
        
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
