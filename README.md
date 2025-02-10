# Roblox Pulse Sender 🤖

A robust Node.js application to appear online in Roblox for preventing Tools like 'AgentBlox Bot', spying on you. Can handle multiple Roblox accounts through automated heartbeat monitoring and pulse sending.


## ✨ Features

- 👥 Multi-account management
- 🔄 Automated session maintenance
- ⚡ Configurable pulse intervals
- 📝 Detailed logging system
- 🔁 Retry mechanism with configurable attempts
- ❌ Graceful error handling
- 🎨 Color-coded console output
- 📂 File-based logging

## 🚀 Prerequisites

- Node.js (v12 or higher)
- NPM or Yarn package manager

# 💕 Getting started

## 📦 Installation

1. Clone the repository:

```bash
git clone https://github.com/prescionx/roblox-pulse-sender.git
cd roblox-pulse-sender
```


2. Install required packages:
```bash
npm install axios chalk@3 moment path 
```

#### 🔐 How to Get Your Cookie

1. Log in to Roblox.com
2. Open Developer Tools in your browser (F12)
3. Go to Application/Storage/Cookies tab
4. Copy the value of .ROBLOSECURITY cookie

## 📦 Required Dependencies

```json
{
  "dependencies": {
    "axios": "^0.21.1",
    "chalk": "3.0.0",
    "moment": "^2.29.1",
    "path": "^0.12.7"
  }
}
```

## ⚙️ Configuration Examples

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `pulseInterval` | Time between heartbeats (ms) | 30000 |
| `retryAttempts` | Number of retry attempts | 3 |
| `retryDelay` | Delay between retries (ms) | 5000 |
| `enableLogging` | Enable/disable logging | true |


### Single Account Configuration
```json
{
  "accounts": [
    {
      "username": "Account1",
      "robloxCookie": "cookie1",
      "pulseInterval": 30000,
      "enableLogging": true
    }
  ],
  "globalConfig": {

    "retryAttempts": 3,
    "retryDelay": 5000
  }
}
```

### Multi-Account Configuration
```json
{
  "accounts": [
    {
      "username": "Account1",
      "robloxCookie": "cookie1",
      "pulseInterval": 30000,
      "enableLogging": true
    },
    {
      "username": "Account2",
      "robloxCookie": "cookie2",
      "pulseInterval": 45000,
      "enableLogging": true
    }
  ],
  "globalConfig": {
    "retryAttempts": 3,
    "retryDelay": 5000
  }
}
```

### Configuration Priority Table

| Setting | Priority Order | Description |
|---------|---------------|-------------|
| 1. Account-specific | Highest | Settings defined in individual account objects |
| 2. Global Config | Medium | Settings defined in globalConfig object |
| 3. Default Values | Lowest | Hardcoded defaults in the application |

## 🏗️ Core Components

### AccountManager

The `AccountManager` class serves as the main controller for managing multiple Roblox accounts. It handles:

- Account initialization
- Staggered start of monitors
- Global configuration
- Status tracking
- Graceful shutdown

### RobloxHeartbeatMonitor

The `RobloxHeartbeatMonitor` class handles individual account monitoring with features:

- Session management
- CSRF token handling
- User information retrieval
- Heartbeat pulse sending
- Detailed logging
- Error handling and retries

## 🔧 Usage

```javascript
const config = require('./config.json');
const manager = new AccountManager(config);

// Start all account monitors
manager.startAll().then(() => {
  // Log status every minute
  setInterval(() => {
    const status = manager.getStatus();
    console.log('Account Status:', status);
  }, 60000);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await manager.stopAll();
  process.exit(0);
});
```

## 📝 Logging Types

| Type | Emoji | Description | Color |
|------|-------|-------------|--------|
| INFO | ℹ️ | General information | White |
| ERROR | ❌ | Error messages | Red |
| SUCCESS | ✅ | Successful operations | Green |
| WARNING | ⚠️ | Warning messages | Yellow |
| USER | 👤 | User-related information | Blue |
| SYSTEM | 🔧 | System-related messages | Magenta |

## 🔐 Security Features

- 🔒 Secure cookie handling
- 🔑 Session ID management
- 🛡️ CSRF token protection
- 👤 User agent simulation
- ⏱️ Rate limiting through staggered starts

## ❌ Error Handling

The application includes comprehensive error handling:

- 🔄 Automatic retry mechanism for failed requests
- ⚙️ Configurable retry attempts and delays
- 📝 Detailed error logging
- 🛡️ Graceful degradation

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## ⚠️ Disclaimer

This tool is for educational purposes only. Make sure to comply with Roblox's terms of service when using this application.