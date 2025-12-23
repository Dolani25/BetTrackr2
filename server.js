import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// --- HELPER FUNCTION ---
async function runScraper(scraperName, scriptPath, envVars = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running ${scraperName} scraper...`);

    const scraper = spawn('node', [scriptPath], {
      env: { ...process.env, ...envVars }
    });

    let output = '';
    let errorOutput = '';

    // Collect standard logs (console.log)
    scraper.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      // Optional: Stream logs to Render console in real-time
      console.log(`[${scraperName}] ${chunk.trim()}`);
    });

    // Collect error logs (console.error)
    scraper.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    scraper.on('close', (code) => {
      if (code !== 0) {
        console.error(`\n❌ ${scraperName} FAILED (Exit Code: ${code})`);
        console.error(`--- SCAPER STDOUT ---`);
        console.log(output);
        console.error(`--- SCAPER STDERR ---`);
        console.error(errorOutput);
        console.error(`--- END LOGS ---\n`);

        reject(new Error(`${scraperName} scraper failed with code ${code}. Check server logs for details.`));
        return;
      }

      // Parse the JSON output file
      let jsonFile;
      switch (scraperName) {
        case 'BC.Game': jsonFile = 'bc_game_bets.json'; break;
        case 'SportyBet': jsonFile = 'my_bets.json'; break;
        case 'MSport': jsonFile = 'msport_bets_axios.json'; break;
        case 'Football.com': jsonFile = 'my_bets.json'; break;
        default: jsonFile = 'my_bets.json';
      }

      // Robust Path Checking: Check both root and scrapers/ folder
      // This supports the fix we made to fetchF.js
      let jsonPath = path.join(__dirname, 'scrapers', jsonFile); // Try scrapers folder first (Best practice)

      if (!fs.existsSync(jsonPath)) {
        // Fallback to root
        jsonPath = path.join(__dirname, jsonFile);
      }

      if (!fs.existsSync(jsonPath)) {
        reject(new Error(`JSON output file not found at: ${jsonPath}`));
        return;
      }

      try {
        const jsonData = fs.readFileSync(jsonPath, 'utf8');
        const bets = JSON.parse(jsonData);
        resolve(bets);
      } catch (err) {
        reject(new Error(`Failed to parse JSON for ${scraperName}: ${err.message}`));
      }
    });
  });
}

// --- REAL LOGIN ENDPOINT ---
app.post('/api/login', async (req, res) => {
  const { bookie, username, password } = req.body;
  console.log(`Login attempt for ${bookie}: ${username}`);

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }

  // Map bookie to script
  let scriptPath;
  let scraperName;

  switch (bookie.toLowerCase()) {
    case 'bcgame':
    case 'bc.game':
    case 'fetchbcgame':
      scriptPath = path.join(__dirname, 'scrapers', 'fetchBCgame.js');
      scraperName = 'BC.Game';
      break;
    case 'sportybet':
    case 'fetchf':
      scriptPath = path.join(__dirname, 'scrapers', 'fetchF.js');
      scraperName = 'SportyBet';
      break;
    case 'msport':
    case 'fetchmsportaxios':
      scriptPath = path.join(__dirname, 'scrapers', 'fetchMsportAxios.js');
      scraperName = 'MSport';
      break;
    case 'football.com':
    case 'football':
    case 'fetchfootball':
      scriptPath = path.join(__dirname, 'scrapers', 'fetchFootball.js');
      scraperName = 'Football.com';
      break;
    default:
      return res.status(400).json({ success: false, message: 'Unsupported bookie' });
  }

  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ success: false, message: 'Scraper script not found' });
  }

  try {
    console.log(`Starting ${scraperName} scraper...`);

    const bets = await runScraper(scraperName, scriptPath, {
      SCRAPER_USERNAME: username,
      SCRAPER_PASSWORD: password
    });

    res.json({ success: true, message: 'Login and sync successful', count: bets.length });

  } catch (error) {
    console.error(`Login failed for ${bookie}:`, error.message);
    res.status(401).json({ success: false, message: `Login failed: ${error.message}` });
  }
});

// --- MANUAL SCRAPE ENDPOINT ---
app.get('/api/scrape/:bookie', async (req, res) => {
  const { bookie } = req.params;

  try {
    let scriptPath;
    let scraperName;

    switch (bookie.toLowerCase()) {
      case 'bcgame':
      case 'bc.game':
        scriptPath = path.join(__dirname, 'scrapers', 'fetchBCgame.js');
        scraperName = 'BC.Game';
        break;
      case 'sportybet':
        scriptPath = path.join(__dirname, 'scrapers', 'fetchF.js');
        scraperName = 'SportyBet';
        break;
      case 'msport':
        scriptPath = path.join(__dirname, 'scrapers', 'fetchMsportAxios.js');
        scraperName = 'MSport';
        break;
      default:
        return res.status(400).json({ error: `Unsupported bookie: ${bookie}` });
    }

    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: `Scraper not found: ${scriptPath}` });
    }

    const bets = await runScraper(scraperName, scriptPath);
    res.json({ success: true, bookie: scraperName, count: bets.length, data: bets });

  } catch (error) {
    console.error(`Error scraping ${bookie}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- GET EXISTING BETS ---
app.get('/api/bets/:bookie', (req, res) => {
  const { bookie } = req.params;
  let jsonFile;

  switch (bookie.toLowerCase()) {
    case 'bcgame': jsonFile = 'bc_game_bets.json'; break;
    case 'sportybet': jsonFile = 'my_bets.json'; break;
    case 'msport': jsonFile = 'msport_bets_axios.json'; break;
    case 'football': jsonFile = 'my_bets.json'; break;
    default: return res.status(400).json({ error: 'Unsupported bookie' });
  }

  // Check scrapers folder first, then root
  let jsonPath = path.join(__dirname, 'scrapers', jsonFile);
  if (!fs.existsSync(jsonPath)) {
    jsonPath = path.join(__dirname, jsonFile);
  }

  if (!fs.existsSync(jsonPath)) {
    return res.json({ success: true, count: 0, data: [] });
  }

  try {
    const bets = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    res.json({ success: true, count: bets.length, data: bets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- LIST SCRAPERS ---
app.get('/api/scrapers', (req, res) => {
  const scrapersDir = path.join(__dirname, 'scrapers');
  const scrapers = [];

  if (fs.existsSync(scrapersDir)) {
    const files = fs.readdirSync(scrapersDir);
    files.forEach(file => {
      if (file.endsWith('.js')) {
        scrapers.push({
          name: file.replace('.js', ''),
          file: file,
          supported: ['fetchBCgame.js', 'fetchF.js', 'fetchMsportAxios.js', 'fetchFootball.js'].includes(file)
        });
      }
    });
  }
  res.json({ scrapers });
});

// --- SERVE REACT FRONTEND ---
app.use(express.static(path.join(__dirname, 'dist')));
app.get('/api/health', (req, res) => res.json({ status: 'Server running' }));
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT,'0.0.0.0' , () => {
  console.log(`Scraper API server running on http://localhost:${PORT}`);
});
