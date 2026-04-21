// index.js

const url = "https://hidrografia.agpse.gob.ar/histdat/LAPLATA.dat";

async function obtenerAlturaRio() {
    try {
        console.log("Iniciando conexión con el servidor de AGP...");
        
        // 1. Hacemos el fetch al archivo .dat
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        // 2. Obtenemos el texto completo
        const data = await response.text();
        
        // 3. Separamos el archivo por saltos de línea y limpiamos espacios vacíos
        const lineas = data.trim().split('\n');
        
        // 4. Tomamos la última línea del archivo (el dato más reciente)
        const ultimaLinea = lineas[lineas.length - 1];
        
        // 5. Separamos los valores de esa línea por comas
        const valores = ultimaLinea.split(',');
        
        // 6. Extraemos la Fecha (índice 0) y la Altura (índice 3)
        // Usamos una expresión regular para limpiar las comillas de la fecha
        const fechaCruda = valores[0].replace(/['"]/g, ''); 
        const alturaCruda = parseFloat(valores[3]).toFixed(2);
        
        // Mostramos los resultados
        console.log(`\n✅ ¡Datos extraídos con éxito!`);
        console.log(`🌊 Puerto: La Plata`);
        console.log(`📅 Fecha y hora de medición: ${fechaCruda}`);
        console.log(`📏 Altura actual: ${alturaCruda} metros\n`);
        
        // Aquí puedes agregar la lógica para enviar la notificación a tu mamá
        // return { fecha: fechaCruda, altura: alturaCruda };

    } catch (error) {
        console.error("❌ Error al obtener los datos de altura:", error.message);
    }
}

// Ejecutar la función
obtenerAlturaRio();
