const express = require('express');
const path = require('path');
const app = express();
const whatsappHandler = require('./api/whatsapp');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WhatsApp API route
app.post('/api/whatsapp', whatsappHandler);

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
