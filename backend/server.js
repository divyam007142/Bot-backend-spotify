try { require('dotenv').config(); } catch (_) {}

const express   = require('express');
const mongoose  = require('mongoose');
const axios     = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('• MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

// ─── SpotifyUser model ────────────────────────────────────────────────────────
const spotifyUserSchema = new mongoose.Schema({
  discordId:    { type: String, required: true, unique: true },
  spotifyId:    { type: String, required: true },
  displayName:  { type: String, default: null },
  accessToken:  { type: String, required: true },
  refreshToken: { type: String, required: true },
  expiresAt:    { type: Date,   required: true },
  createdAt:    { type: Date,   default: Date.now },
  updatedAt:    { type: Date,   default: Date.now },
});
const SpotifyUser = mongoose.model('SpotifyUser', spotifyUserSchema);

// ─── Spotify config ───────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRETS;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI;

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.send('ok'));

app.get('/callback', async (req, res) => {
  const { code, state: discordId, error } = req.query;

  if (error || !code || !discordId) {
    return res.send(htmlPage(
      '❌ Authorization Failed',
      'You denied access or something went wrong. You can close this tab.',
      '#e74c3c',
    ));
  }

  try {
    // Exchange code → tokens
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
      {
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Fetch Spotify profile
    const profileRes = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = profileRes.data;

    // Upsert into MongoDB
    await SpotifyUser.findOneAndUpdate(
      { discordId },
      {
        discordId,
        spotifyId:    profile.id,
        displayName:  profile.display_name || profile.id,
        accessToken:  access_token,
        refreshToken: refresh_token,
        expiresAt,
        updatedAt:    new Date(),
      },
      { upsert: true, new: true },
    );

    console.log(`✔ Spotify linked for Discord user ${discordId} (${profile.display_name || profile.id})`);

    return res.send(htmlPage(
      '✅ Spotify Connected!',
      `Your Spotify account (<strong>${profile.display_name || profile.id}</strong>) is now linked. ` +
      `You can close this tab and go back to Discord — type <strong>UPC</strong> to show your now-playing track.`,
      '#1db954',
    ));
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    return res.send(htmlPage(
      '❌ Something went wrong',
      'Failed to link your Spotify account. Please try again with /connect in Discord.',
      '#e74c3c',
    ));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`• Spotify OAuth backend running on port ${PORT}`);
  console.log(`• Redirect URI: ${REDIRECT_URI || '(SPOTIFY_REDIRECT_URI not set)'}`);
});

// ─── HTML helper ─────────────────────────────────────────────────────────────
function htmlPage(title, body, accent = '#1db954') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#121212;font-family:'Segoe UI',system-ui,sans-serif;color:#fff}
    .card{background:#1e1e1e;border-radius:16px;padding:40px 48px;max-width:480px;
          text-align:center;border:2px solid ${accent};box-shadow:0 0 40px ${accent}33}
    h1{font-size:2rem;margin-bottom:16px;color:${accent}}
    p{color:#aaa;line-height:1.6;font-size:1.05rem}
    strong{color:#fff}
  </style>
</head>
<body>
  <div class="card"><h1>${title}</h1><p>${body}</p></div>
</body>
</html>`;
}
