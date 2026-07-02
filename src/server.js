import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { SmsbowerClient } from './smsbower.js';

const config = loadConfig();
const db = createDatabase(config.databasePath);
const smsClient = new SmsbowerClient({
  apiKey: config.smsBowerApiKey,
  baseUrl: config.smsBowerBaseUrl,
  serviceCode: config.serviceCode,
  country: config.country,
  maxPrice: config.maxPrice,
  minPrice: config.minPrice,
});

const app = createApp({ db, smsClient, config });

app.listen(config.port, () => {
  console.log(`CDKey app listening on http://localhost:${config.port}`);
});
