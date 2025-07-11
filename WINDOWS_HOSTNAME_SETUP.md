# Windows Hostname Setup for `https://clinic` Access

## Overview
This guide configures Windows computers to access the Shwan Orthodontics application using the simple hostname `https://clinic` instead of IP addresses.

## Prerequisites
- HTTPS implementation completed in the application
- Administrative access to Windows computers
- Application server running on network computer named "Clinic"

## Step-by-Step Configuration

### 1. Windows Hosts File Configuration

**Location:** `C:\Windows\System32\drivers\etc\hosts`

**Required:** Administrator privileges

**Steps:**
1. Open Command Prompt as Administrator
2. Edit the hosts file:
   ```cmd
   notepad C:\Windows\System32\drivers\etc\hosts
   ```
3. Add this line at the end:
   ```
   192.168.100.2  clinic
   ```
4. Save and close the file

### 2. Application Port Configuration

For standard HTTPS access without port numbers:

**Option A: Use Port 443 (Standard HTTPS)**
1. Edit `.env` file on server:
   ```bash
   PORT=443
   ENABLE_HTTPS=true
   ```
2. Access via: `https://clinic`

**Option B: Use Port 80 with HTTPS**
1. Edit `.env` file on server:
   ```bash
   PORT=80
   ENABLE_HTTPS=true
   ```
2. Access via: `https://clinic:80` or `https://clinic`

### 3. Windows Firewall Configuration

**On the server computer (Clinic):**
1. Open Windows Defender Firewall
2. Click "Advanced settings"
3. Create new Inbound Rule:
   - Rule Type: Port
   - Protocol: TCP
   - Port: 443 (or your chosen port)
   - Action: Allow the connection
   - Profile: All profiles
   - Name: "Shwan Orthodontics HTTPS"

### 4. Network Discovery Settings

**On all computers:**
1. Open Settings → Network & Internet
2. Click "Network and Sharing Center"
3. Click "Change advanced sharing settings"
4. Enable:
   - Network discovery
   - File and printer sharing

## SSL Certificate Verification

The SSL certificate has been updated to include the hostname:
- **Primary name:** clinic
- **Alternative names:** 192.168.100.2
- **IP address:** 192.168.100.2

This allows access via both:
- `https://clinic`
- `https://192.168.100.2`

## Testing the Configuration

### 1. DNS Resolution Test
```cmd
ping clinic
```
**Expected result:** Resolves to 192.168.100.2

### 2. HTTPS Connection Test
```cmd
curl -k https://clinic/health/basic
```
**Expected result:** JSON health response

### 3. Browser Test
1. Open browser
2. Navigate to `https://clinic`
3. Accept the security certificate (self-signed)
4. Application should load normally

## Troubleshooting

### Common Issues

**1. "clinic" hostname not resolving**
- Verify hosts file entry: `192.168.100.2  clinic`
- Flush DNS cache: `ipconfig /flushdns`
- Check file permissions on hosts file

**2. Connection refused**
- Verify application is running with HTTPS enabled
- Check Windows Firewall on server
- Ensure correct port configuration

**3. Certificate warnings**
- Normal for self-signed certificates
- Click "Advanced" → "Proceed to clinic (unsafe)"
- Consider installing certificate in Windows certificate store

**4. Port conflicts**
- Check if port 443/80 is already in use
- Use different port and include in URL: `https://clinic:3000`

### Advanced Certificate Installation

To eliminate browser warnings:

**1. Export certificate from browser:**
- Visit `https://clinic`
- Click certificate warning → View certificate
- Download certificate file

**2. Install in Windows Certificate Store:**
- Run `certmgr.msc` as Administrator
- Navigate to "Trusted Root Certification Authorities"
- Import downloaded certificate

## Multiple Computer Setup

**For each Windows computer in the office:**

1. **Edit hosts file** (requires admin on each machine):
   ```
   192.168.100.2  clinic
   ```

2. **Alternative: Active Directory** (if domain environment):
   - Add DNS entry in Domain Controller
   - Automatically applies to all domain computers

3. **Router DNS** (if supported):
   - Add hostname entry in router configuration
   - Applies to all network devices

## Security Considerations

### Self-Signed Certificate
- **Secure for LAN use:** Traffic is encrypted
- **Browser warnings:** Users must accept certificate
- **Annual renewal:** Certificate expires in 365 days

### Network Security
- **Internal use only:** Certificate not valid for internet access
- **Firewall rules:** Only allow necessary ports
- **Access control:** Consider application-level authentication

## Maintenance

### Annual Tasks
1. **Renew SSL certificate:**
   ```bash
   cd ssl/
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
     -subj "/C=US/ST=State/L=City/O=ShwanOrthodontics/OU=IT/CN=clinic" \
     -addext "subjectAltName=DNS:clinic,DNS:192.168.100.2,IP:192.168.100.2"
   ```

2. **Update certificate on all computers** (if manually installed)

### Adding New Computers
1. Edit hosts file: `192.168.100.2  clinic`
2. Configure firewall if needed
3. Test access: `https://clinic`

## Quick Reference

### Server Configuration
```bash
# .env file
ENABLE_HTTPS=true
PORT=443  # or 80
```

### Client Configuration
```
# C:\Windows\System32\drivers\etc\hosts
192.168.100.2  clinic
```

### Access URLs
- Primary: `https://clinic`
- Fallback: `https://192.168.100.2`
- With port: `https://clinic:3000` (if using non-standard port)

## Benefits of Hostname Setup
- ✅ **User-friendly:** Simple `https://clinic` URL
- ✅ **Professional:** No IP addresses for staff to remember
- ✅ **Consistent:** Same URL across all office computers
- ✅ **Flexible:** Easy to change server IP without updating bookmarks
- ✅ **Branded:** Uses practice-relevant hostname