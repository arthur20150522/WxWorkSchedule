import 'dotenv/config'; // Load .env file
import { app } from './api.js';
import { startScheduler } from './scheduler.js';

const PORT = process.env.PORT || 3000;

const main = async () => {
  // Start Express API
  app.listen(PORT, () => {
    console.log(`API Server running at http://localhost:${PORT}`);
  });

  // Start Scheduler
  startScheduler();
};

main().catch(console.error);
