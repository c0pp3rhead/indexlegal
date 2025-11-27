// --- Honoris Legal Analyzer (Terminal Version) ---
// Este script se ejecuta directamente en tu terminal de Mac con: node HonorisTerminal.js

// STEP 1: Load the 'dotenv' package to read the .env file
import 'dotenv/config'; 
// STEP 2: Load 'fetch' for API calls and 'readline' for user input
import fetch from 'node-fetch';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as admin from 'firebase-admin'; // NUEVA DEPENDENCIA: Firebase Admin

// Importar 'fs' y 'path' para leer el JSON de forma segura
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- FIREBASE CONFIGURATION (Requires service key file) ---

try {
  // CORRECCIÓN: Usar 'fs' (File System) para leer el archivo JSON
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'honoris-key.json');
  
  // Verificar si existe el archivo antes de leerlo para evitar crash feo
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      const serviceAccountRaw = fs.readFileSync(SERVICE_ACCOUNT_PATH);
      const serviceAccount = JSON.parse(serviceAccountRaw);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
  } else {
      console.warn("[ADVERTENCIA] No se encontró 'honoris-key.json'. El guardado en base de datos estará desactivado.");
  }
} catch (e) {
  console.error(`[ADVERTENCIA] Error iniciando Firebase: ${e.message}`);
}

// Obtener instancia de Firestore solo si Firebase se inició correctamente
const db = admin.apps.length ? admin.firestore() : null;

// --- GEMINI CONFIGURATION ---
const API_MODEL = 'gemini-2.5-flash'; 
const API_KEY = process.env.GEMINI_API_KEY; 

if (!API_KEY) {
    console.error("ERROR CRÍTICO: No se encontró la GEMINI_API_KEY en el archivo .env");
    console.log("Por favor, cree un archivo .env en esta carpeta con su clave.");
    process.exit(1);
}

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;

// --- COSTA RICAN LEGAL RULES (System Instruction for Gemini) ---
// ACTUALIZACIÓN MAYOR: Alcance ampliado para clasificar CUALQUIER delito basado en descripción.
const SYSTEM_INSTRUCTION_TEXT = `
Actúa como un experto penalista y asesor legal en Costa Rica. Tu tarea es analizar el texto proporcionado por el usuario. Este texto puede ser una frase ofensiva (insulto) O una descripción narrativa de una situación de hecho.

TU OBJETIVO: Identificar si el texto constituye, describe o implica una infracción a las leyes de Costa Rica (Código Penal, Ley de Delitos Informáticos, Ley de Derechos de Autor, Código Civil, etc.) y clasificarlo.

REGLAS DE CLASIFICACIÓN Y JERARQUÍA:

1. DELITOS GRAVES Y SEXUALES (C.P. Art 110+, 156+):
   - Descripción de homicidio, agresión física, abuso sexual, violación o producción/posesión de pornografía infantil.
   - PRIORIDAD MÁXIMA.

2. CALUMNIA (C.P. Art 147):
   - Atribución falsa de un delito a una persona (ej. "sos un violador", "ladrón", "narco").

3. AMENAZA (C.P. Art 188):
   - Anuncio de un mal grave e injusto (físico, patrimonial o moral). Incluye instigación al suicidio ("suicídese").

4. DELITOS CONTRA LA INTIMIDAD, IMAGEN Y VOZ (C.P. Art 196+, Código Civil Art 47):
   - Violación de Domicilio.
   - Captación indebida de manifestaciones verbales (grabar sin consentimiento en privado).
   - Uso no autorizado de imagen o voz (especialmente si se usa para describir falsamente a alguien o en contextos comerciales/difamatorios).
   - Violación de comunicaciones electrónicas.

5. DELITOS INFORMÁTICOS (Ley 8148):
   - Hackeo, espionaje informático, suplantación de identidad digital.

6. INJURIA AGRAVADA / DISCRIMINACIÓN (C.P. Art 145 / Ley 8168):
   - Insultos basados en odio, raza, género, orientación sexual o discapacidad.

7. DIFAMACIÓN (C.P. Art 146) e INJURIA SIMPLE (C.P. Art 145):
   - Ataques a la reputación (no delictivos) o insultos vulgares contra el decoro.

OUTPUT FORMAT:
Tu respuesta DEBE ser un objeto JSON estrictamente válido con estos campos:
{
  "Frase_Original": "El texto del usuario.",
  "Categoria_Legal": "El nombre técnico del delito o infracción (ej. VIOLACIÓN DE DERECHO DE IMAGEN, USURPACIÓN, AMENAZA).",
  "Articulo_CR": "La normativa aplicable (ej. Código Penal Art. 198, Código Civil Art. 47).",
  "Penalidad_Estimada": "La sanción asociada (Prisión, Días Multa o Indemnización Civil).",
  "Detalles_Deteccion": "Explicación jurídica breve de por qué los hechos descritos encajan en este tipo penal."
}

Si la frase es NEUTRAL y no describe ninguna infracción, usa "NO INFRACCIÓN".

IMPORTANTE: Responde SOLO con el JSON. No uses bloques de código markdown (\`\`\`json).
`;

// --- Analysis Function (Gemini API Call) ---
async function analyze(textToAnalyze) {
  try {
    const payload = {
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION_TEXT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: textToAnalyze }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': `application/json` },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
        let errorBody = await response.text();
        try {
            const errorJson = JSON.parse(errorBody);
            errorBody = errorJson.error.message || errorBody;
        } catch (e) {}
        throw new Error(`API Error: ${response.status} ${response.statusText} | ${errorBody}`);
    }

    const jsonResponse = await response.json();
    
    if (jsonResponse.promptFeedback && jsonResponse.promptFeedback.blockReason) {
        throw new Error(`Respuesta bloqueada por Gemini. Razón: ${jsonResponse.promptFeedback.blockReason}`);
    }

    const jsonText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;

    if (jsonText) {
      // Limpieza extra por si el modelo ignora la instrucción de no usar markdown
      const cleanJsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
      const result = JSON.parse(cleanJsonText);
      
      await saveAnalysis(result);
      
      return result;
    } else {
      throw new Error("Respuesta vacía del API.");
    }
  } catch (e) {
    console.error(`\nError en el análisis: ${e.message}`);
    return null;
  }
}

// --- Función: Guardar en Firestore ---
async function saveAnalysis(analysisResult) {
  if (!db) return; // Si no hay DB configurada, no hacer nada

  try {
    const docToSave = {
        ...analysisResult,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        searchDate: new Date().toISOString(),
        userId: 'terminal-user',
    };

    const docRef = await db.collection('legal_analysis_logs').add(docToSave);
    console.log(`[LOG] Análisis guardado en Firestore con ID: ${docRef.id}`);
  } catch (e) {
    console.error(`[ERROR] Fallo al guardar en Firestore: ${e.message}`);
  }
}

// --- Main Application Loop ---
async function main() {
  const rl = readline.createInterface({ input, output });
  
  console.log("=======================================================");
  console.log("       Honoris: CR Legal Expression Analyzer (Terminal)");
  console.log("       SCOPE: Análisis Penal Completo (Honor, Privacidad, etc.)");
  console.log("=======================================================");
  console.log("Escriba 'exit' o presione Ctrl+C para salir.");

  if (db) {
      console.log("[STATUS] Integración con Firestore: ACTIVA.");
  } else {
      console.log("[STATUS] Integración con Firestore: INACTIVA (Modo local).");
  }

  while (true) {
    const currentDateTime = new Date();
    const formattedDate = currentDateTime.toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'medium' });
    
    const userInput = await rl.question('\nIngrese la frase o descripción a analizar: ');

    if (userInput.toLowerCase() === 'exit') {
      break;
    }

    if (!userInput.trim()) {
      continue;
    }

    console.log(`[FECHA/HORA BÚSQUEDA]: ${formattedDate}`);
    console.log("\nAnalizando con Gemini... \n");
    const result = await analyze(userInput);

    if (result) {
      console.log("--- ANÁLISIS LEGAL ---");
      console.log(`Frase/Hecho: \t\t${result.Frase_Original}`);
      console.log(`Categoría Legal: \t${result.Categoria_Legal}`);
      console.log(`Normativa: \t\t${result.Articulo_CR}`);
      console.log(`Penalidad Estimada: \t${result.Penalidad_Estimada}`);
      console.log(`Detalles: \t\t${result.Detalles_Deteccion}`);
      console.log("------------------------");
    }
  }

  rl.close();
}

main();