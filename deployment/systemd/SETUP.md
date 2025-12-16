# systemd Service Setup Guide

## Step 1: Find Your Paths

Run these commands on your Linux server to find the correct paths:

```bash
# Find npm path
which npm

# Find node path (if needed)
which node

# Find your username
whoami

# Find your current directory (where you cloned the repo)
pwd
```

Common npm paths:
- `/usr/bin/npm` - System-wide npm (installed via package manager)
- `/usr/local/bin/npm` - Local npm installation
- `/home/username/.nvm/versions/node/v20.x.x/bin/npm` - npm via nvm (Node Version Manager)
- `/opt/nodejs/bin/npm` - Custom installation

## Step 2: Update the Service File

Edit the service file with your actual paths:

```bash
nano deployment/systemd/realtoken-yam.service
```

Update these values:

1. **User**: Change `www-data` to your username (from `whoami` command)
2. **WorkingDirectory**: Change `/path/to/realtoken-yam-interface` to your actual project path (from `pwd` command)
3. **ExecStart**: Change `/usr/bin/npm` to the npm path (from `which npm` command)

### Example:

If your setup is:
- Username: `deploy`
- Project path: `/home/deploy/realtoken-yam-interface`
- npm path: `/usr/local/bin/npm`

Then your service file should have:
```ini
User=deploy
WorkingDirectory=/home/deploy/realtoken-yam-interface
ExecStart=/usr/local/bin/npm start
```

## Step 3: If Using nvm (Node Version Manager)

If you're using nvm, you have two options:

### Option A: Use full path to npm in nvm
```ini
ExecStart=/home/username/.nvm/versions/node/v20.12.0/bin/npm start
```

### Option B: Source nvm in the service (more flexible)
```ini
ExecStart=/bin/bash -c 'source /home/username/.nvm/nvm.sh && npm start'
```

Or create a wrapper script:

Create `start.sh`:
```bash
#!/bin/bash
source /home/username/.nvm/nvm.sh
cd /path/to/realtoken-yam-interface
npm start
```

Then in service file:
```ini
ExecStart=/path/to/start.sh
```

## Step 4: Install and Start

```bash
# Copy service file
sudo cp deployment/systemd/realtoken-yam.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable on boot
sudo systemctl enable realtoken-yam.service

# Start the service
sudo systemctl start realtoken-yam.service

# Check status
sudo systemctl status realtoken-yam.service

# View logs
sudo journalctl -u realtoken-yam.service -f
```

## Troubleshooting

### If service fails to start:

1. **Check logs:**
   ```bash
   sudo journalctl -u realtoken-yam.service -n 50
   ```

2. **Test npm manually:**
   ```bash
   cd /path/to/realtoken-yam-interface
   npm start
   ```

3. **Check permissions:**
   ```bash
   # Make sure the user has access to the directory
   sudo chown -R username:username /path/to/realtoken-yam-interface
   ```

4. **Check if npm is accessible:**
   ```bash
   # As the service user
   sudo -u username /usr/bin/npm --version
   ```

5. **If using nvm, ensure PATH is set:**
   ```bash
   # Add to service file Environment section:
   Environment="PATH=/home/username/.nvm/versions/node/v20.12.0/bin:/usr/local/bin:/usr/bin:/bin"
   ```

