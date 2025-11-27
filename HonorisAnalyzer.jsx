// --- Honoris Legal Analyzer (Terminal Version) ---
// Este script se ejecuta directamente en tu terminal de Mac con: node HonorisTerminal.js

// Importar 'fetch' para hacer llamadas al API y 'readline' para la entrada del usuario
import fetch from 'node-fetch'; // Necesitaremos 'node-fetch' para Node.js
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// --- GEMINI API CONFIGURATION ---
// (Estas son las mismas de la app HTML)
const API_MODEL = 'gemini-2.5-flash-preview-09-2025';
const API_KEY = ""; // Kept empty, as the environment provides it
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;

// --- COSTA RICAN LEGAL RULES (System Instruction for Gemini) ---
// (Estas son las mismas reglas legales que ya definimos)
const SYSTEM_INSTRUCTION_TEXT = `
Actúa como un experto en el Código Penal de Costa Rica (Crímenes Contra el Honor) y Leyes Conexas. Tu tarea es analizar el texto proporcionado por el usuario y clasificarlo en una de las siguientes categorías, basándose en la ley de Costa Rica.

REGLAS DE CLASIFICACIÓN (MÁXIMA PRIORIDAD):
1. CALUMNIA (C.P. Art 147): Acusación falsa de un hecho delictivo grave (Ej. 'pedófilo', 'asesino', 'pornografía infantil', 'masturbandote con menores de edad'). Esta es la infracción más grave.
2. AMENAZA (C.P. Art 188): Expresión que anuncia un mal grave e injusto o incita al daño (Ej. 'suicídese', 'te voy a violar', 'mueras en una celda', 'hackeamos el cel', 'cut yourself', amenaza legal 'sued').
3. INJURIA AGRAVADA/DISCRIMINACIÓN (C.P. Art 145 / Ley 8168): Insulto severo o término de odio basado en género, raza, u orientación (Ej. 'maricón', 'judio', 'nazi', 'Hitler', 'homosexual', ataques directos a familiares).
4. DIFAMACIÓN (C.P. Art 146): Propalar información falsa que afecte la reputación o crédito (Ej. 'perdedor del OIJ', 'perder tu trabajo', 'delinquent', 'no es un senior').
5. INJURIA (C.P. Art 145): Insulto vulgar o menoscabo al decoro/capacidad profesional (Ej. 'perdedor', 'inutil', 'coger', 'masturbandote', 'mongolo', 'mediocre').

PENALIDADES ESTIMADAS (DÍAS MULTA):
- CALUMNIA: 50 a 150 días multa. (0 años prisión)
- AMENAZA: 30 a 90 días multa. (3 a 20 días de prisión O multa)
- INJURIA/DIFAMACIÓN: 10 a 75 días multa. (0 años prisión)

OUTPUT FORMAT:
Tu respuesta DEBE ser un objeto JSON que contenga SOLO los siguientes campos en español:
{
  "Frase_Original": "El texto proporcionado por el usuario.",
  "Categoria_Legal": "La CATEGORÍA_LEGAL que mejor se aplica. (Usar los nombres exactos de la lista: CALUMNIA, AMENAZA, INJURIA AGRAVADA, DIFAMACIÓN, INJURIA, NO INFRACCIÓN).",
  "Articulo_CR": "El artículo y código quebrado (Ej. C.P. Art 147).",
  "Penalidad_Estimada": "La pena asociada (Ej. 50 a 150 días multa).",
  "Detalles_Deteccion": "La razón por la que se clasificó así (Ej. Acusación directa de un delito sexual grave)."
}

Si la frase es NEUTRAL o no constituye una infracción legal, usa la categoría "NO INFRACCIÓN" y los detalles: "La expresión no constituye una infracción penal en este contexto."
`;

// --- Función de Análisis (Llamada a Gemini) ---
async function analyze(textToAnalyze) {
  try {
    const payload = {
      contents: [{ parts: [{ text: textToAnalyze }] }],
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION_TEXT }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            "Frase_Original": { "type": "STRING" },
            "Categoria_Legal": { "type": "STRING" },
            "Articulo_CR": { "type": "STRING" },
            "Penalidad_Estimada": { "type": "STRING" },
            "Detalles_Deteccion": { "type": "STRING" }
          }
        }
      },
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const jsonResponse = await response.json();
    const jsonText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;

    if (jsonText) {
      return JSON.parse(jsonText);
    } else {
      throw new Error("Respuesta vacía del API.");
    }
  } catch (e) {
    console.error(`\nError en el análisis: ${e.message}`);
    return null;
  }
}

// --- Función Principal (Loop de la Aplicación) ---
async function main() {
  const rl = readline.createInterface({ input, output });
  
  console.log("=======================================================");
  console.log("       Honoris: CR Legal Expression Analyzer (Terminal)");
  console.log("=======================================================");
  console.log("Escriba 'exit' o presione Ctrl+C para salir.");

  while (true) {
    const userInput = await rl.question('\nIngrese la frase a analizar: ');

    if (userInput.toLowerCase() === 'exit') {
      break;
    }

    if (!userInput.trim()) {
      continue;
    }

    console.log("\nAnalizando con Gemini... \n");
    const result = await analyze(userInput);

    if (result) {
      // Formatear la salida para que sea legible
      console.log("--- ANÁLISIS LEGAL ---");
      console.log(`Frase Analizada: \t${result.Frase_Original}`);
      console.log(`Categoría Legal: \t${result.Categoria_Legal}`);
      console.log(`Artículo Quebrado: \t${result.Articulo_CR}`);
      console.log(`Penalidad Estimada: \t${result.Penalidad_Estimada}`);
      console.log(`Detalles: \t\t${result.Detalles_Deteccion}`);
      console.log("------------------------");
    }
  }

  rl.close();
}

main();
