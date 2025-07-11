# Caddy Setup for Shwan Orthodontics Application

## Overview
This document provides complete setup instructions for implementing Caddy as a reverse proxy for the Shwan Orthodontics application, enabling proper HTTPS for LAN use without browser warnings.

## Why Caddy?
- **No browser warnings**: Caddy generates proper certificates for LAN use
- **Automatic HTTPS**: Handles SSL termination and certificate management
- **Phone-friendly**: Eliminates HTTP to HTTPS auto-redirect issues
- **Cross-platform**: Works on both Ubuntu (development) and Windows (production)
- **WebSocket support**: Maintains real-time messaging functionality

## Ubuntu Development Setup

### 1. Install Caddy
```bash
# Install Caddy using official repository
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 2. Configure Domain Resolution
```bash
# Add to /etc/hosts for local resolution
echo "127.0.0.1 clinic.local" | sudo tee -a /etc/hosts
echo "192.168.100.2 clinic.local" | sudo tee -a /etc/hosts
```

### 3. Setup Caddy Configuration
```bash
# Copy the Caddyfile to Caddy's config directory
sudo cp /home/administrator/projects/ShwNodApp/Caddyfile /etc/caddy/Caddyfile

# Create log directory
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy

# Validate configuration
caddy validate --config /etc/caddy/Caddyfile
```

### 4. Start Services
```bash
# Start your Node.js application (HTTP on port 3000)
cd /home/administrator/projects/ShwNodApp
node index.js &

# Start Caddy service
sudo systemctl enable caddy
sudo systemctl start caddy
sudo systemctl status caddy
```

### 5. Install Root Certificate (Ubuntu)
```bash
# Trust Caddy's root certificate
caddy trust

# Verify certificate installation
caddy list-certificates
```

### 6. Test Configuration
```bash
# Test HTTPS access
curl -v https://clinic.local
curl -v https://192.168.100.2

# Test WebSocket (if applicable)
curl -v -H "Connection: Upgrade" -H "Upgrade: websocket" https://clinic.local
```

## Windows Production Setup

### 1. Download and Install Caddy
```powershell
# Download Caddy for Windows
# Go to https://caddyserver.com/download
# Download Windows x64 version

# Extract to C:\caddy\
# Add C:\caddy to PATH environment variable
```

### 2. Alternative: Install via Chocolatey
```powershell
# Install Chocolatey if not installed
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Caddy
choco install caddy
```

### 3. Configure Windows Hosts File
```powershell
# Run as Administrator
# Edit C:\Windows\System32\drivers\etc\hosts
# Add these lines:
192.168.100.2 clinic.local
127.0.0.1 clinic.local
```

### 4. Setup Caddy as Windows Service
```powershell
# Navigate to your application directory
cd "C:\path\to\ShwNodApp"

# Copy Caddyfile to Caddy config location
copy Caddyfile "C:\caddy\Caddyfile"

# Create Windows service
sc create CaddyService binpath="C:\caddy\caddy.exe run --config C:\caddy\Caddyfile" start=auto
sc description CaddyService "Caddy web server for Shwan Orthodontics"

# Start the service
sc start CaddyService
```

### 5. Alternative: Run Caddy Manually
```powershell
# Navigate to application directory
cd "C:\path\to\ShwNodApp"

# Start Caddy with the configuration
caddy run --config Caddyfile
```

### 6. Install Root Certificate (Windows)
```powershell
# Run as Administrator
# Install Caddy's root certificate to Windows certificate store
caddy trust

# Verify installation
caddy list-certificates
```

### 7. Configure Windows Firewall
```powershell
# Allow HTTPS traffic
netsh advfirewall firewall add rule name="Caddy HTTPS" dir=in action=allow protocol=TCP localport=443
netsh advfirewall firewall add rule name="Caddy HTTP" dir=in action=allow protocol=TCP localport=80
```

## Network Configuration

### For LAN Access from Other Devices

#### Option 1: mDNS (Bonjour) - Recommended
```bash
# Ubuntu: Install Avahi
sudo apt install avahi-daemon avahi-utils

# Windows: Install Bonjour Print Services
# Download from Apple's website
```

#### Option 2: DNS Server Configuration
```bash
# Configure your router's DNS to resolve clinic.local to 192.168.100.2
# Or use Pi-hole/AdGuard with custom DNS entries
```

#### Option 3: Individual Device Configuration
```bash
# Add to each device's hosts file:
# Android: Requires root access
# iOS: Use DNS override apps
# Windows/Mac: Edit hosts file as shown above
```

## Service Management

### Ubuntu Commands
```bash
# Start/Stop/Restart Caddy
sudo systemctl start caddy
sudo systemctl stop caddy
sudo systemctl restart caddy

# Check status and logs
sudo systemctl status caddy
sudo journalctl -u caddy -f

# Reload configuration without restart
sudo systemctl reload caddy
```

### Windows Commands
```powershell
# Start/Stop Windows service
sc start CaddyService
sc stop CaddyService

# Check service status
sc query CaddyService

# View logs (Event Viewer or Caddy logs)
Get-EventLog -LogName Application -Source CaddyService
```

## Accessing Your Application

### Development (Ubuntu)
- **HTTPS**: `https://clinic.local` or `https://192.168.100.2`
- **Development Alt**: `https://localhost:8443`

### Production (Windows)
- **HTTPS**: `https://clinic.local` or `https://192.168.100.2`
- **From other devices**: `https://clinic.local` (if mDNS configured)

## Troubleshooting

### Common Issues

#### 1. Certificate Errors
```bash
# Regenerate certificates
caddy trust
sudo systemctl restart caddy
```

#### 2. Port Conflicts
```bash
# Check what's using port 443
sudo netstat -tulpn | grep :443
# or
sudo lsof -i :443
```

#### 3. DNS Resolution Issues
```bash
# Test DNS resolution
nslookup clinic.local
dig clinic.local

# Check hosts file
cat /etc/hosts | grep clinic
```

#### 4. Caddy Configuration Errors
```bash
# Validate configuration
caddy validate --config /etc/caddy/Caddyfile

# Test configuration
caddy run --config /etc/caddy/Caddyfile
```

### Log Locations
- **Ubuntu**: `/var/log/caddy/` and `journalctl -u caddy`
- **Windows**: `C:\caddy\logs\` and Windows Event Viewer

## Security Considerations

### Advantages
- **Proper certificates**: No browser warnings
- **Automatic renewal**: Caddy handles certificate lifecycle
- **Security headers**: Built-in security enhancements
- **LAN isolation**: Certificates only valid for local network

### Best Practices
- Keep Caddy updated
- Monitor certificate expiration
- Use strong firewall rules
- Regular security audits of configuration

## Maintenance

### Regular Tasks
1. **Update Caddy** monthly
2. **Monitor certificates** (Caddy handles this automatically)
3. **Check logs** for errors
4. **Test HTTPS access** from various devices

### Backup
```bash
# Backup important files
cp /etc/caddy/Caddyfile ~/backup/
cp -r /var/lib/caddy ~/backup/caddy-data/
```

## Migration from Previous HTTPS Setup

### What Changes
1. **Application runs HTTP** (port 3000) behind Caddy
2. **Caddy terminates HTTPS** (port 443)
3. **No more self-signed certificates** in application
4. **No browser warnings** for users

### Files Modified
- `Caddyfile` - New reverse proxy configuration
- `.env` - Updated HTTPS settings and QR_HOST_URL
- `ENABLE_HTTPS=false` - Application runs HTTP behind proxy

### Files No Longer Needed
- `ssl/cert.pem` - Replaced by Caddy's certificates
- `ssl/key.pem` - Replaced by Caddy's certificates
- `config/ssl.js` - No longer needed

## Certificate Installation for Client Devices

### Overview
Since Caddy uses its internal CA for local HTTPS, each device accessing the application needs to trust Caddy's root certificate to avoid browser warnings.

### 1. Export Caddy's Root Certificate
```bash
# Export the root certificate
caddy trust export

# This creates a certificate file (usually pem format)
# Location varies by OS:
# - Ubuntu: ~/.local/share/caddy/pki/authorities/local/root.crt
# - Windows: %APPDATA%\Caddy\pki\authorities\local\root.crt
```

### 2. Install on Desktop Devices

#### Ubuntu/Linux
```bash
# Copy certificate to system trust store
sudo cp ~/.local/share/caddy/pki/authorities/local/root.crt /usr/local/share/ca-certificates/caddy-root.crt
sudo update-ca-certificates

# Verify installation
curl -v https://clinic.local
```

#### Windows
```powershell
# Import certificate to Windows certificate store
certlm.msc
# Navigate to Trusted Root Certification Authorities > Certificates
# Right-click > All Tasks > Import
# Select the exported root.crt file
```

#### macOS
```bash
# Add to system keychain
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain root.crt

# Or use GUI: Double-click the certificate > Always Trust
```

### 3. Install on Mobile Devices

#### Method 1: Direct Download (Recommended)
```bash
# Create a simple web server to serve the certificate
cd ~/.local/share/caddy/pki/authorities/local/
python3 -m http.server 8080

# Access from mobile device: http://192.168.100.2:8080/root.crt
# Device will prompt to install the certificate
```

#### Method 2: QR Code for Easy Mobile Installation
```bash
# Create QR code containing certificate download URL
# Install qrencode if not available
sudo apt install qrencode

# Generate QR code for certificate download
echo "http://192.168.100.2:8080/root.crt" | qrencode -t ansiutf8

# Or save as PNG for sharing
echo "http://192.168.100.2:8080/root.crt" | qrencode -o caddy-cert-qr.png
```

#### Method 3: Email/AirDrop
```bash
# Email the certificate file to mobile devices
# Or use AirDrop on iOS/macOS
```

### 4. Mobile Device Certificate Installation Steps

#### Android
1. Download `root.crt` from the QR code or direct link
2. Go to Settings > Security > Encryption & credentials
3. Select "Install a certificate" > "CA certificate"
4. Choose the downloaded certificate file
5. Name it "Caddy Local CA" and install

#### iOS
1. Download `root.crt` from Safari
2. Go to Settings > General > VPN & Device Management
3. Find "Downloaded Profile" and tap "Install"
4. Go to Settings > General > About > Certificate Trust Settings
5. Enable full trust for "Caddy Local CA"

### 5. Automated Certificate Distribution
```bash
# Create a script to automate certificate sharing
cat > distribute-cert.sh << 'EOF'
#!/bin/bash
# Distribute Caddy certificate for easy mobile installation

CERT_PATH="$HOME/.local/share/caddy/pki/authorities/local/root.crt"
SHARE_DIR="/tmp/caddy-cert-share"
PORT=8080

# Create sharing directory
mkdir -p "$SHARE_DIR"
cp "$CERT_PATH" "$SHARE_DIR/"

# Create simple HTML page with instructions
cat > "$SHARE_DIR/index.html" << 'HTML'
<!DOCTYPE html>
<html>
<head>
    <title>Caddy Certificate Installation</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .qr-code { text-align: center; margin: 20px 0; }
        .instructions { background: #f5f5f5; padding: 15px; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>Install Caddy Certificate</h1>
    <p>To access <strong>https://clinic.local</strong> without warnings, install this certificate:</p>
    
    <div class="qr-code">
        <img src="data:image/png;base64,$(base64 -w 0 /tmp/caddy-cert-qr.png)" alt="QR Code">
        <p><a href="root.crt" download>Download Certificate</a></p>
    </div>
    
    <div class="instructions">
        <h3>Installation Instructions:</h3>
        <p><strong>Android:</strong> Settings > Security > Install CA certificate</p>
        <p><strong>iOS:</strong> Download, then Settings > General > VPN & Device Management</p>
        <p><strong>Windows:</strong> Double-click and install to "Trusted Root"</p>
        <p><strong>macOS:</strong> Double-click and "Always Trust"</p>
    </div>
</body>
</html>
HTML

# Generate QR code for the certificate download
echo "http://$(hostname -I | cut -d' ' -f1):$PORT/root.crt" | qrencode -o /tmp/caddy-cert-qr.png

echo "Certificate sharing server starting..."
echo "Access from mobile devices: http://$(hostname -I | cut -d' ' -f1):$PORT"
echo "Certificate direct download: http://$(hostname -I | cut -d' ' -f1):$PORT/root.crt"
echo "Press Ctrl+C to stop"

# Start simple web server
cd "$SHARE_DIR"
python3 -m http.server $PORT
EOF

chmod +x distribute-cert.sh
```

### 6. Verification
```bash
# Test certificate installation on each device
# Visit https://clinic.local
# Should show "Secure" with no warnings

# Check certificate details in browser
# Should show "Issued by: Caddy Local CA"
```

## Support

### Testing Checklist
- [ ] Node.js app starts on HTTP port 3000
- [ ] Caddy starts and binds to port 443
- [ ] `https://clinic.local` accessible
- [ ] No browser certificate warnings
- [ ] WebSocket connections work
- [ ] QR codes generate with HTTPS URLs
- [ ] Mobile devices can access without issues
- [ ] **Certificate installed on all client devices**
- [ ] **Mobile devices show "Secure" connection**

### Performance Notes
- Caddy adds minimal overhead (~1ms)
- Supports HTTP/2 automatically
- Efficient reverse proxy with connection pooling
- Built-in compression enabled