//src/database/databaseConfig.js
const mongoose = require("mongoose");
const dotenv = require('dotenv');

dotenv.config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err; // Rethrow the error to be caught in the main server file
      }
};

module.exports = connectDB;
