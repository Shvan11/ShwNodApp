import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SSL Configuration for HTTPS server
 * Manages SSL certificate paths and options for LAN use
 */

const sslConfig = {
    // SSL certificate paths
    certPath: path.join(__dirname, '../ssl/cert.pem'),
    keyPath: path.join(__dirname, '../ssl/key.pem'),
    
    // HTTPS server options
    getOptions() {
        try {
            return {
                key: fs.readFileSync(this.keyPath),
                cert: fs.readFileSync(this.certPath)
            };
        } catch (error) {
            console.error('SSL certificate files not found:', error.message);
            return null;
        }
    },
    
    // Check if SSL certificates exist
    isAvailable() {
        try {
            return fs.existsSync(this.certPath) && fs.existsSync(this.keyPath);
        } catch (error) {
            return false;
        }
    }
};

export default sslConfig;