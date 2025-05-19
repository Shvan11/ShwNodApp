// routes/web.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);


const router = express.Router();

// Serve the main page
router.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), './public/index.html'));
});

// WhatsApp related pages
router.get('/wa', (req, res) => {
    res.sendFile(path.join(process.cwd(), './public/send.html'));
});

router.get('/wareport', (req, res) => {
    res.sendFile(path.join(process.cwd(), './public/report.html'));
});

router.get('/clear', (req, res) => {
    res.sendFile(path.join(process.cwd(), './public/clear.html'));
});

export default router;
