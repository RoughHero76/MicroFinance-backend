//Index.js
const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');

// Cron jobs
const { pendingToOverdue } = require('./src/crone/RepaymentScheduleCron');
const { updateLoanStatuses } = require('./src/crone/LoanStatusCron');

const connectDB = require('./src/config/databaseConfig');
const routes = require('./src');


dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

const MAX_RETRIES = 5;
const RETRY_INTERVAL = 5000; // 5 seconds

function startServer(retryCount = 0) {
  connectDB().then(() => {
    console.log('Connected to MongoDB');


    cron.schedule('0 23 * * *', async () => {
      console.log('Starting cron jobs at 11 PM');
      await pendingToOverdue();
      console.log('Pending to Overdue cron job completed');
      await updateLoanStatuses();
      console.log('Loan Status update cron job completed');
    });
    
    app.use('/api', routes);

    app.use(express.static(path.join(__dirname, 'public')));

    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.get('/download', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'download.html'));
    });


    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }).catch((error) => {
    console.error('Failed to connect to MongoDB:', error);

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying connection in ${RETRY_INTERVAL / 1000} seconds...`);
      setTimeout(() => startServer(retryCount + 1), RETRY_INTERVAL);
    } else {
      console.error('Max retries reached. Exiting...');
      process.exit(1);
    }
  });
}

startServer();