const express = require('express');
const app = express();
const whatsappHandler = require('./api/whatsapp');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/api/whatsapp', whatsappHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
