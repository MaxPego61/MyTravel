export default function handler(req, res) {
  res.status(200).json({
    msClientId: process.env.MS_CLIENT_ID,
    msTenantId: process.env.MS_TENANT_ID,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY
  });
}