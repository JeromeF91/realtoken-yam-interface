# Deployment Guide for RealToken YAM Interface

## Option 1: systemd Service (Recommended for Linux servers)

### Setup Instructions:

1. **Copy the service file:**
   ```bash
   sudo cp deployment/systemd/realtoken-yam.service /etc/systemd/system/
   ```

2. **Edit the service file:**
   ```bash
   sudo nano /etc/systemd/system/realtoken-yam.service
   ```
   
   Update these paths:
   - `WorkingDirectory`: Path to your application directory
   - `User`: Your Linux user (or `www-data`, `nginx`, etc.)
   - `ExecStart`: Path to npm (usually `/usr/bin/npm` or `/usr/local/bin/npm`)

3. **Reload systemd and start the service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable realtoken-yam.service
   sudo systemctl start realtoken-yam.service
   ```

4. **Check status:**
   ```bash
   sudo systemctl status realtoken-yam.service
   ```

5. **View logs:**
   ```bash
   sudo journalctl -u realtoken-yam.service -f
   ```

### Useful Commands:
- `sudo systemctl start realtoken-yam` - Start service
- `sudo systemctl stop realtoken-yam` - Stop service
- `sudo systemctl restart realtoken-yam` - Restart service
- `sudo systemctl status realtoken-yam` - Check status

---

## Option 2: PM2 Process Manager (Popular for Node.js)

### Installation:
```bash
npm install -g pm2
```

### Setup Instructions:

1. **Edit ecosystem.config.js:**
   - Update `cwd` path to your application directory
   - Adjust `PORT` and environment variables as needed

2. **Start the application:**
   ```bash
   pm2 start deployment/pm2/ecosystem.config.js
   ```

3. **Save PM2 configuration:**
   ```bash
   pm2 save
   ```

4. **Setup PM2 to start on boot:**
   ```bash
   pm2 startup
   # Follow the instructions it provides
   ```

### Useful Commands:
- `pm2 list` - List all processes
- `pm2 logs realtoken-yam` - View logs
- `pm2 restart realtoken-yam` - Restart
- `pm2 stop realtoken-yam` - Stop
- `pm2 monit` - Monitor resources

---

## Option 3: Docker (Containerized)

### Build and Run:
```bash
# Build the image
docker build -t realtoken-yam -f deployment/Dockerfile .

# Run the container
docker run -d \
  --name realtoken-yam \
  -p 3000:3000 \
  --restart unless-stopped \
  -e NODE_ENV=production \
  realtoken-yam
```

### With Docker Compose:
Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  app:
    build:
      context: .
      dockerfile: deployment/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

Then run:
```bash
docker-compose up -d
```

---

## Environment Variables

Make sure to set these environment variables (in systemd service file, PM2 config, or Docker):

- `NODE_ENV=production`
- `PORT=3000` (or your desired port)
- `GNOSIS_RPC_URL=...`
- `ETHEREUM_RPC_URL=...`
- `COMMUNITY_API_KEY=...`
- `NEXT_PUBLIC_API_KEY=...`
- Any other required environment variables

---

## Reverse Proxy Setup (Nginx)

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Recommendation

- **systemd**: Best for traditional Linux servers, most control, integrates with system
- **PM2**: Best for Node.js-specific features, easy to use, good monitoring
- **Docker**: Best for containerized deployments, easy scaling, consistent environments

For most Linux servers, **systemd** is the standard and recommended approach.

