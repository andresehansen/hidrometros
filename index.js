// index.js

const url = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";

async function obtenerAlturaRio() {
    try {
        console.log("Iniciando conexión con el servidor de AGP...");
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.text();
        const lineas = data.trim().split('\n');
        const ultimaLinea = lineas[lineas.length - 1];
        const valores = ultimaLinea.split(',');
        
        const fechaCruda = valores[0].replace(/['"]/g, ''); 
        const alturaCruda = parseFloat(valores[3]).toFixed(2);
        
        console.log(`✅ Datos extraídos: Fecha ${fechaCruda} | Altura: ${alturaCruda}m`);

        // --- SECCIÓN: ENVÍO POR WHATSAPP ---
        
        const telefono = process.env.TELEFONO; 
        const apiKey = process.env.API_KEY;

        if (!telefono || !apiKey) {
            console.log("⚠️ Faltan configurar el teléfono o la API Key en GitHub.");
            return;
        }

        const mensaje = `🌊 *Puerto La Plata*\n📅 Fecha: ${fechaCruda}\n📏 Altura actual: *${alturaCruda} metros*`;
        const textoCodificado = encodeURIComponent(mensaje);
        const callMeBotUrl = `https://api.callmebot.com/whatsapp.php?phone=${telefono}&text=${textoCodificado}&apikey=${apiKey}`;
        
        console.log("Enviando mensaje de WhatsApp...");
        const botResponse = await fetch(callMeBotUrl);
        
        if (botResponse.ok) {
            console.log("✅ ¡Mensaje de WhatsApp enviado con éxito!");
        } else {
            console.log("❌ Error al enviar el mensaje de WhatsApp.");
        }

    } catch (error) {
        console.error("❌ Error en el proceso:", error.message);
    }
}

obtenerAlturaRio();
