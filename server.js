// --- Honoris Legal Server (Backend Integrado) ---
// Ejecutar con: node server.js

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// Firebase Imports
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore'; 

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURACIÓN ---
const app = express();
const PORT = process.env.PORT || 3000;
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'https://lawcrawler-api-production.up.railway.app';

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
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (serviceAccount) {
      if (getApps().length === 0) initializeApp({ credential: cert(serviceAccount) });
      db = getFirestore();
      console.log("[SERVER] Firebase conectado exitosamente.");
  }
} catch (e) {
  console.error(`[ERROR] Fallo al iniciar Firebase: ${e.message}`);
}

// --- GEMINI CONFIGURATION ---
const API_MODEL = 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;

const SYSTEM_INSTRUCTION_TEXT = `
Actúa como un experto penalista y asesor legal en Costa Rica para "IndexLegal". 
Analiza el texto y clasifícalo en delitos según el Código Penal de Costa Rica.
OUTPUT FORMAT (JSON):
{
  "Frase_Original": "Cita textual...",
  "Categoria_Legal": "Nombre técnico del delito (ej. AMENAZA, HOMICIDIO, ESTAFA).",
  "Articulo_CR": "Normativa aplicable.",
  "Penalidad_Estimada": "Sanción asociada.",
  "Detalles_Deteccion": "Explicación jurídica."
}
Si es neutral, usa "NO INFRACCIÓN".
`;

// --- FUNCIÓN HELPER: Consultar Gemini ---
async function analyzeWithGemini(text) {
    const payload = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION_TEXT }] },
      contents: [{ role: "user", parts: [{ text: text }] }],
      generationConfig: { responseMimeType: "application/json" }
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Gemini API Error: ${response.statusText}`);
    const jsonResponse = await response.json();
    const jsonText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("Respuesta vacía de IA.");
    return JSON.parse(jsonText.replace(/^```json\n/, '').replace(/\n```$/, ''));
}

// --- FUNCIÓN MEJORADA: Consultar LawCrawler Local ---
async function searchLocalLaws(query) {
    try {
        // FIX: Usamos solo la primera palabra clave para garantizar resultados
        // Ej: "HOMICIDIO SIMPLE" -> busca "HOMICIDIO"
        const cleanQuery = query.split(' ')[0].trim(); 
        
        console.log(`[LAWCRAWLER] Buscando evidencia para: "${cleanQuery}"...`);
        
        const response = await fetch(`${PYTHON_API_URL}/search?q=${encodeURIComponent(cleanQuery)}`);
        
        if (!response.ok) {
            console.warn(`[LAWCRAWLER] API Local no responde (Status: ${response.status})`);
            return [];
        }
        
        const data = await response.json();
        const resultados = data.resultados || [];
        
        // LOG NUEVO: Confirmar cuántas encontró
        console.log(`[LAWCRAWLER] ¡Éxito! Se encontraron ${resultados.length} leyes.`);
        
        return resultados; 
    } catch (e) {
        console.error(`[LAWCRAWLER ERROR] Fallo de conexión: ${e.message}`);
        return []; 
    }
}

// --- ENDPOINT PRINCIPAL (ANÁLISIS) ---
app.post('/api/analyze', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "Texto requerido" });

        console.log(`[SOLICITUD] Analizando: "${text.substring(0, 30)}..."`);
        
        // 1. Análisis de IA (Gemini)
        const aiResult = await analyzeWithGemini(text);

        // 2. Búsqueda de Evidencia Legal (LawCrawler)
        let legalEvidence = [];
        if (aiResult.Categoria_Legal && aiResult.Categoria_Legal !== "NO INFRACCIÓN") {
            legalEvidence = await searchLocalLaws(aiResult.Categoria_Legal);
        }

        // 3. Unificar Respuesta
        const finalResponse = {
            ...aiResult,
            Evidencia_Crawler: legalEvidence.slice(0, 3) 
        };

        // 4. Guardar en Firebase
        if (db) {
            db.collection('legal_analysis_logs').add({
                ...finalResponse,
                timestamp: FieldValue.serverTimestamp(),
                source: 'web-indexlegal-integrated'
            }).catch(e => console.error("[DB LOG ERROR]", e.message));
        }

        res.json(finalResponse);

    } catch (error) {
        console.error("[ERROR SERVIDOR]", error.message);
        res.status(500).json({ error: "Error procesando la solicitud." });
    }
});

// --- NUEVO: PROXY PARA LEER LEYES (Aquí es donde se pega) ---
app.get('/api/law/:id', async (req, res) => {
    try {
        // Redirige la petición al servidor Python
        const response = await fetch(`${PYTHON_API_URL}/law/${req.params.id}`);
        
        if (!response.ok) return res.status(404).json({ error: "Ley no encontrada" });
        
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error("[PROXY ERROR]", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`\n--- SERVIDOR HONORIS + LAWCRAWLER ACTIVO ---`);
    console.log(`Escuchando en: http://localhost:${PORT}`);
    console.log(`Conectando a LawCrawler en: ${PYTHON_API_URL}`);
});