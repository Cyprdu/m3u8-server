import express from "express";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fetch from "node-fetch";

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

// --- Fonction : extrait une URL m3u8 ---
async function extractM3U8(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  let foundUrl = null;

  page.on("response", async (response) => {
    const reqUrl = response.url();
    if (reqUrl.includes(".m3u8") && !foundUrl) {
      foundUrl = reqUrl;
    }
  });

  console.log(`🔍 Extraction du flux pour ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  await new Promise((r) => setTimeout(r, 5000));

  await browser.close();
  return foundUrl;
}

// --- Cache simple pour éviter de relancer Puppeteer à chaque fragment ---
const cache = new Map();

// --- Route principale : /hls?url=... ---
app.get("/hls", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("URL manquante");

  try {
    // Vérifie si le lien m3u8 est déjà en cache
    let directUrl = cache.get(url);
    if (!directUrl) {
      directUrl = await extractM3U8(url);
      if (!directUrl) return res.status(404).send("Aucun flux m3u8 trouvé");
      cache.set(url, directUrl);
      console.log(`✅ Lien m3u8 extrait : ${directUrl}`);
    }

    // Si la requête demande la playlist (pas un fragment .ts)
    if (!req.path.endsWith(".ts")) {
      console.log(`📡 Proxying M3U8 depuis ${directUrl}`);

      const response = await fetch(directUrl);
      const text = await response.text();

      // Remplace les URLs internes par des routes proxy locales
      const proxied = text.replace(
        /(https?:\/\/[^\s"']+)/g,
        (match) => `/hls/segment?src=${encodeURIComponent(match)}`
      );

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(proxied);
    }
  } catch (err) {
    console.error("❌ Erreur /hls :", err);
    res.status(500).send("Erreur interne : " + err.message);
  }
});

// --- Route proxy pour les segments .ts ---
app.get("/hls/segment", async (req, res) => {
  const { src } = req.query;
  if (!src) return res.status(400).send("Segment manquant");

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Erreur " + response.status);

    res.setHeader("Content-Type", "video/mp2t");
    response.body.pipe(res);
  } catch (err) {
    console.error("⚠️ Erreur segment :", err);
    res.status(500).send("Erreur segment : " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Serveur proxy M3U8 prêt sur http://localhost:${PORT}`);
});
