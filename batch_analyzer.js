// --- Honoris Batch CSV Analyzer (Safe Version) ---
// This version waits 4 seconds between requests to avoid Error 429 (Rate Limit).
// Usage: node batch_analyzer.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// --- CONFIGURATION ---
const INPUT_FILE = 'searches_rows-3.csv';
const OUTPUT_FILE = 'completed_searches.csv';
const API_MODEL = 'gemini-2.5-flash'; 
const API_KEY = process.env.GEMINI_API_KEY;

// DELAY CONFIGURATION (SAFE MODE)
// 4500ms = 4.5 seconds. 
// Free tier allows ~15 requests per minute. 60s / 15 = 4s.
// We use 4.5s to be safe.
const REQUEST_DELAY_MS = 4500; 

if (!API_KEY) {
    console.error("ERROR: GEMINI_API_KEY not found in .env file.");
    process.exit(1);
}

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;

// --- SYSTEM PROMPT ---
const SYSTEM_INSTRUCTION_TEXT = `
Actúa como un experto penalista y asesor legal en Costa Rica. Tu tarea es analizar el texto proporcionado por el usuario.

TU OBJETIVO: Identificar si el texto describe hechos que podrían constituir CUALQUIER infracción a las leyes de Costa Rica.

REGLAS DE CLASIFICACIÓN Y JERARQUÍA:
1. DELITOS GRAVES Y SEXUALES (C.P. Art 110+).
2. CALUMNIA (C.P. Art 147).
3. AMENAZA (C.P. Art 188).
4. DELITOS CONTRA LA INTIMIDAD (C.P. Art 196+).
5. DERECHOS DE IMAGEN Y VOZ.
6. DELITOS INFORMÁTICOS (Ley 8148).
7. INJURIA/DIFAMACIÓN.

OUTPUT FORMAT (JSON):
{
  "Categoria_Legal": "El nombre técnico del delito.",
  "Articulo_CR": "La normativa aplicable.",
  "Penalidad_Estimada": "La sanción asociada.",
  "Detalles_Deteccion": "Explicación jurídica breve."
}
Si es NEUTRAL, usa "NO INFRACCIÓN".
`;

// Helper: Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Analysis Function with Retry Logic ---
async function analyzeTextWithRetry(text, retries = 0) {
    try {
        const payload = {
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION_TEXT }] },
            contents: [{ role: "user", parts: [{ text: text }] }],
            generationConfig: { responseMimeType: "application/json" },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        // Si encontramos un error 429, esperamos 30 segundos y reintentamos
        if (response.status === 429) {
            console.warn(`⚠️ Límite alcanzado (429). Esperando 30 segundos...`);
            await sleep(30000);
            return analyzeTextWithRetry(text, retries + 1);
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const jsonResponse = await response.json();
        const jsonText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonText) return null;

        const cleanJsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
        return JSON.parse(cleanJsonText);

    } catch (error) {
        console.error(`Error analyzing: ${error.message}`);
        return null;
    }
}

// --- Main Script ---
async function processCsv() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const inputPath = path.join(__dirname, INPUT_FILE);
    const outputPath = path.join(__dirname, OUTPUT_FILE);

    console.log(`Leyendo archivo: ${inputPath}`);
    
    try {
        const fileContent = fs.readFileSync(inputPath, 'utf-8');
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            relax_quotes: true 
        });

        console.log(`Encontrados ${records.length} registros. Iniciando análisis SEGURO (Lento)...`);

        const updatedRecords = [];
        let processedCount = 0;

        for (const record of records) {
            // Buscar la columna correcta
            let catKey = Object.keys(record).find(k => k.includes('Categor') || k.includes('Legal'));
            if (!catKey) catKey = 'Categoría Legal'; 

            // Verificar si necesita análisis (si está vacío)
            const currentVal = record[catKey];
            const needsAnalysis = !currentVal || currentVal.trim() === '';

            if (needsAnalysis && record.user_text) {
                const snippet = record.user_text.replace(/\n/g, ' ').substring(0, 30);
                process.stdout.write(`Fila ${record.id} [${snippet}...] `);
                
                // PAUSA DE SEGURIDAD: 4.5 segundos entre cada petición
                await sleep(REQUEST_DELAY_MS);

                const analysis = await analyzeTextWithRetry(record.user_text);

                if (analysis) {
                    record[catKey] = analysis.Categoria_Legal;
                    record['Normativa'] = analysis.Articulo_CR;
                    record['Penalidad Estimada'] = analysis.Penalidad_Estimada;
                    record['Detalles'] = analysis.Detalles_Deteccion;
                    console.log(`✅`);
                } else {
                    console.log(`❌ Falló`);
                }
                processedCount++;
            }
            updatedRecords.push(record);
            
            // Guardar progreso cada 10 filas
            if (processedCount % 10 === 0 && processedCount > 0) {
                 const csvString = stringify(updatedRecords, { header: true });
                 fs.writeFileSync(outputPath, csvString);
            }
        }

        // Guardado Final
        const csvString = stringify(updatedRecords, { header: true });
        fs.writeFileSync(outputPath, csvString);
        console.log(`\n🎉 Éxito! ${processedCount} filas procesadas.`);
        console.log(`Resultados guardados en: ${outputPath}`);

    } catch (err) {
        console.error("Error Fatal:", err);
    }
}

processCsv();