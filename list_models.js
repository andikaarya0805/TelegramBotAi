const axios = require('axios');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LIST_MODELS_URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

const fs = require('fs');

async function listModels() {
  try {
    const response = await axios.get(LIST_MODELS_URL);
    fs.writeFileSync('models.json', JSON.stringify(response.data, null, 2));
    console.log('Models saved to models.json');
  } catch (error) {
    console.error('Failed to list models:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
  }
}

listModels();
