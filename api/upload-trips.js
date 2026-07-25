import { put } from '@vercel/blob';

const BLOB_PATH = 'trips.json';

// Nessun bodyParser: leggiamo il body grezzo per passarlo intatto a Blob
export const config = {
  api: { bodyParser: false }
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Usa POST' });
  }

  const authHeader = req.headers['authorization'] || '';
  const expected = `Bearer ${process.env.ADMIN_UPLOAD_SECRET}`;

  if (!process.env.ADMIN_UPLOAD_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'Impossibile leggere il body', details: err.message });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return res.status(400).json({ error: 'JSON non valido', details: err.message });
  }

  if (!parsed || !Array.isArray(parsed.trips)) {
    return res.status(400).json({ error: 'Il JSON deve avere la forma { "trips": [...] }' });
  }

  try {
    const blob = await put(BLOB_PATH, raw, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json'
    });

    res.status(200).json({
      ok: true,
      trips: parsed.trips.length,
      pathname: blob.pathname,
      uploadedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Upload su Blob fallito', details: err.message });
  }
}