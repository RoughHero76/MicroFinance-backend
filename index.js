const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');




const connectDB = require('./src/config/databaseConfig');


dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

connectDB();

//Admin
const adminRoutes = require('./src/routes/admin/authRoutes');
const customerCRUD = require('./src/routes/admin/customer/customerCRUD');
const loanRoutes = require('./src/routes/admin/loan/loanRoutes');

//Admin Routes

app.use('/api/admin', adminRoutes);
app.use('/api/admin/customer', customerCRUD);
app.use('/api/admin/loan', loanRoutes);

//Employee Routes


app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});


