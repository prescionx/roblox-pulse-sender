const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk'); // Import chalk
const { AccountManager } = require('./index');

const app = express();
const CONFIG_PATH = path.join(__dirname, 'config.json'); // Standardized path

// Initialize AccountManager:
// Ensure a default config is created if one doesn't exist, before AccountManager tries to load it.
if (!fs.existsSync(CONFIG_PATH)) {
    console.log(chalk.yellow(`Configuration file not found at ${CONFIG_PATH}. Creating a default one.`));
    const defaultConfig = {
        accounts: [{
            username: "DefaultAccount",
            robloxCookie: "YOUR_ROBLOX_COOKIE_HERE",
            pulseInterval: 30000, // This would be for 'full' mode by default
            enableLogging: true,
            mode: "full"
        }],
        globalConfig: {
            retryAttempts: 3,
            retryDelay: 5000,
            defaultPulseIntervalFull: 30000,
            pulseIntervalPartial: 572123
        }
    };
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
        console.log(chalk.green(`Default config.json created. Please edit it with your account details and restart.`));
        // process.exit(0); // Optionally exit to force user to configure first
    } catch (e) {
        console.error(chalk.red('Failed to write default config.json: ', e.message));
        process.exit(1);
    }
}

const manager = new AccountManager(CONFIG_PATH); // Pass config path

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoints

app.get('/api/accounts', async (req, res) => {
    try {
        await manager.fetchAllPresences();
        const status = manager.getStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get account statuses: ' + error.message });
    }
});

app.post('/api/accounts', async (req, res) => {
    try {
        const { username, robloxCookie, pulseInterval, mode } = req.body;
        if (!username || !robloxCookie) {
            return res.status(400).json({ error: 'Username and .ROBLOSECURITY cookie are required.' });
        }
        // Let AccountManager's addAccount handle default pulseInterval based on mode if not provided
        const newAccountConfig = {
            username,
            robloxCookie,
            pulseInterval: pulseInterval ? parseInt(pulseInterval, 10) : undefined, // Pass as number or undefined
            mode: mode || 'full',
            enableLogging: true
        };
        const result = await manager.addAccount(newAccountConfig);
        res.status(201).json(result);
    } catch (error) {
        console.error("Error in POST /api/accounts:", error);
        res.status(500).json({ error: 'Failed to add account: ' + error.message });
    }
});

app.delete('/api/accounts/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const result = await manager.removeAccount(username);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete account: ' + error.message });
    }
});

app.post('/api/accounts/:username/mode', async (req, res) => {
    try {
        const { username } = req.params;
        const { mode } = req.body;
        if (!mode || (mode !== 'full' && mode !== 'partial')) {
            return res.status(400).json({ error: 'Invalid mode specified. Must be "full" or "partial".' });
        }
        const result = await manager.updateAccountMode(username, mode);
        res.json(result);
    } catch (error) {
        console.error("Error in POST /api/accounts/:username/mode:", error);
        res.status(500).json({ error: 'Failed to update account mode: ' + error.message });
    }
});

app.get('/api/logs', (req, res) => {
    try {
        const logFilePath = manager.logPath;
        if (fs.existsSync(logFilePath)) {
            const logContent = fs.readFileSync(logFilePath, 'utf-8');
            res.type('text/plain').send(logContent);
        } else {
            res.status(404).send('Log file not found.');
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve logs: ' + error.message });
    }
});

const findAvailablePort = (startPort, host, callback) => {
    const serverTest = http.createServer();
    serverTest.listen(startPort, host, () => {
        serverTest.once('close', () => {
            callback(startPort);
        });
        serverTest.close();
    });
    serverTest.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(chalk.yellow(`Port ${startPort} on ${host} is in use, trying ${startPort + 1}`));
            findAvailablePort(startPort + 1, host, callback);
        } else {
            callback(null, err);
        }
    });
};

const HOST = '127.0.0.1'; // Listen only on localhost for security
const START_PORT = 13370;

findAvailablePort(START_PORT, HOST, (port, err) => {
    if (err) {
        console.error(chalk.red('Failed to find an available port:'), err);
        process.exit(1);
    }
    if (port) {
        app.listen(port, HOST, () => {
            console.log(chalk.greenBright(`Server running on http://${HOST}:${port}`));
            console.log(chalk.yellow('Web UI is for local management only and does not accept external connections.'));

            manager.startAll().then(() => {
                console.log(chalk.cyan('Account manager started successfully after server.'));
            }).catch(error => {
                console.error(chalk.red('Failed to start account manager after server:'), error.message);
            });
        });
    } else {
        console.error(chalk.red('No available port found.'));
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log(chalk.magenta('\nSIGINT received. Shutting down server and stopping monitors...'));
    await manager.stopAll();
    console.log(chalk.magenta('All monitors stopped. Server shutting down.'));
    process.exit(0);
});