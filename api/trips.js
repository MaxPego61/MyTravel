import { list, get } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    // Trova qualsiasi blob il cui nome inizi con "trips" (tollerante a suffissi
    // casuali aggiunti dalla UI di Vercel, es. trips-a1b2c3.json)
    const { blobs } = await list({ prefix: 'trips', limit: 20 });

    if (!blobs || blobs.length === 0) {
      return res.status(404).json({
        error: 'Nessun file trips*.json trovato nel Blob Store'
      });
    }

    const latest = blobs.sort(
      (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
    )[0];

    // get() funziona sia per blob privati che pubblici, e legge sempre
    // l'ultima versione senza passare dalla cache CDN
    const result = await get(latest.pathname, { access: 'private' });

    if (!result || result.statusCode !== 200 || !result.stream) {
      return res.status(404).json({ error: 'Blob non leggibile' });
    }

    const text = await new Response(result.stream).text();
    const data = JSON.parse(text);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({
      error: 'Impossibile leggere i dati dei viaggi',
      details: err.message
    });
  }
}