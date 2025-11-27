// --- Honoris Legal Server (Backend) ---
// Ejecutar con: node server.js

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// Importaciones modernas de Firebase Admin
import { initializeApp, cert, getApps } from 'firebase-admin/app';
// CORRECCIÓN CLAVE: Importamos FieldValue para usarlo directamente.
import { getFirestore, FieldValue } from 'firebase-admin/firestore'; 

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURACIÓN ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- FIREBASE CONFIGURATION ---
let db = null;

try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'honoris-key.json');
  
  let serviceAccount;

  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      const serviceAccountRaw = fs.readFileSync(SERVICE_ACCOUNT_PATH);
      serviceAccount = JSON.parse(serviceAccountRaw);
  } 
  else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (serviceAccount) {
      if (getApps().length === 0) {
        initializeApp({
            credential: cert(serviceAccount)
        });
      }
      
      db = getFirestore();
      console.log("[SERVER] Firebase conectado exitosamente.");
  } else {
      console.warn("[ADVERTENCIA] No se encontraron credenciales de Firebase. El guardado estará desactivado.");
  }
} catch (e) {
  console.error(`[ERROR] Fallo al iniciar Firebase: ${e.message}`);
}

// --- GEMINI CONFIGURATION ---
const API_MODEL = 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;

// --- SYSTEM PROMPT ---
const SYSTEM_INSTRUCTION_TEXT = `
Actúa como un experto penalista y asesor legal en Costa Rica para "IndexLegal". Analiza el texto y clasifícalo.

REGLAS DE CLASIFICACIÓN:
1. DELITOS GRAVES Y SEXUALES (C.P. Art 110+, 156+): Homicidio, agresión, abuso sexual, pornografía infantil.
2. CALUMNIA (C.P. Art 147): Falsa atribución de un delito.
3. AMENAZA (C.P. Art 188): Anuncio de mal grave o injusto, incitación al suicidio.
4. DELITOS CONTRA LA INTIMIDAD/IMAGEN (C.P. Art 196+, Civil Art 47): Violación de domicilio, grabación sin consentimiento, uso no autorizado de voz/imagen.
5. DELITOS INFORMÁTICOS (Ley 8148): Hackeo, espionaje.
6. INJURIA AGRAVADA/DISCRIMINACIÓN (Ley 8168).
7. DIFAMACIÓN (C.P. Art 146) e INJURIA SIMPLE (C.P. Art 145).

OUTPUT FORMAT (JSON):
{
  "Frase_Original": "Texto del usuario.",
  "Categoria_Legal": "Nombre técnico del delito.",
  "Articulo_CR": "Normativa aplicable.",
  "Penalidad_Estimada": "Sanción asociada.",
  "Detalles_Deteccion": "Explicación jurídica."
}
Si es NEUTRAL, usa "NO INFRACCIÓN". SOLO JSON.
`;

// --- FUNCIÓN DE ANÁLISIS ---
async function analyzeWithGemini(text) {
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

    // CORRECCIÓN DE SINTAXIS AQUÍ:
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Gemini API Error: ${response.statusText}`);
    
    const jsonResponse = await response.json();
    if (jsonResponse.promptFeedback?.blockReason) throw new Error("Bloqueado por seguridad.");

    const jsonText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("Respuesta vacía.");

    return JSON.parse(jsonText.replace(/^```json\n/, '').replace(/\n```$/, ''));
}

// --- ENDPOINT API ---
app.post('/api/analyze', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "Texto requerido" });

        console.log(`[SOLICITUD] Analizando: "${text.substring(0, 30)}..."`);
        
        // 1. Analizar
        const result = await analyzeWithGemini(text);

        // 2. Guardar (si DB existe)
        // Usamos .then() y .catch() para que el servidor NO espere a que termine de guardar
        if (db) {
            db.collection('legal_analysis_logs').add({
                ...result,
                timestamp: FieldValue.serverTimestamp(), // CORRECCIÓN: Usamos FieldValue directamente
                searchDate: new Date().toISOString(),
                source: 'web-indexlegal'
            }).then(() => {
                console.log("[DB] Guardado exitoso.");
            }).catch(err => {
                console.error("[DB ERROR - PERO CONTINUAMOS] No se pudo guardar:", err.message);
            });
        }

        // 3. Responder INMEDIATAMENTE al usuario con el resultado
        res.json(result);

    } catch (error) {
        console.error("[ERROR SERVIDOR]", error.message);
        res.status(500).json({ error: "Error procesando la solicitud legal." });
    }
});

// Servir archivos estáticos
app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`\n--- SERVIDOR HONORIS ACTIVO ---`);
    console.log(`Escuchando en: http://localhost:${PORT}`);
});