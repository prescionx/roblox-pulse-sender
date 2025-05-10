document.addEventListener('DOMContentLoaded', () => {
    fetchAccounts();
    fetchLogs(); 

    const addAccountForm = document.getElementById('addAccountForm');
    if(addAccountForm) {
        addAccountForm.addEventListener('submit', handleAddAccount);
    }
    // Auto-refresh logs and accounts periodically
    setInterval(fetchLogs, 30000); // Refresh logs every 30 seconds
    setInterval(fetchAccounts, 60000); // Refresh accounts every 60 seconds
});

async function fetchAccounts() {
    try {
        const response = await fetch('/api/accounts');
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        const accounts = await response.json();
        displayAccounts(accounts);
    } catch (error) {
        console.error('Error fetching accounts:', error);
        const accountListDiv = document.getElementById('accountList');
        if(accountListDiv) accountListDiv.innerHTML = `<div class="col"><p class="text-danger">Error loading accounts: ${error.message}</p></div>`;
    }
}

function displayAccounts(accounts) {
    const accountListDiv = document.getElementById('accountList');
    if (!accountListDiv) return;
    accountListDiv.innerHTML = ''; 

    if (Object.keys(accounts).length === 0) {
        accountListDiv.innerHTML = '<div class="col-12"><div class="alert alert-info">No accounts configured yet. Add one using the form above.</div></div>';
        return;
    }

    for (const username in accounts) {
        const acc = accounts[username];
        const card = document.createElement('div');
        card.className = 'col-md-6 col-lg-4 mb-4'; 

        let presenceHtml = '<small class="text-muted">Roblox Presence: Not available</small>';
        if (acc.presence) {
            presenceHtml = `
                <h6 class="mb-1 mt-2" style="font-size: 0.9rem;">Roblox Presence:</h6>
                <p class="mb-0 presence-details"><strong>Status:</strong> ${acc.presence.userPresenceType || 'N/A'}</p>
                <p class="mb-0 presence-details"><strong>Location:</strong> ${acc.presence.lastLocation || 'N/A'}</p>
                <p class="mb-0 presence-details"><strong>Last Online:</strong> ${acc.presence.lastOnline ? new Date(acc.presence.lastOnline).toLocaleString() : 'N/A'}</p>
            `;
        }

        const lastPulseTime = acc.lastPulse ? new Date(acc.lastPulse).toLocaleString() : 'Never';
        const pulseIntervalDisplay = acc.mode === 'partial' ? '~6 min fixed' : `${acc.pulseInterval}ms`;

        card.innerHTML = `
            <div class="card account-card h-100">
                <div class="card-body d-flex flex-column">
                    <div class="d-flex align-items-center mb-2">
                        <img src="${acc.avatarUrl || 'https://via.placeholder.com/50/007bff/FFFFFF?Text=R'}" alt="Avatar" class="avatar">
                        <div>
                            <h5 class="card-title mb-0" style="font-size: 1.1rem;">${acc.displayName || username}</h5>
                            <small class="text-muted">(${username})</small>
                        </div>
                    </div>
                     <p class="card-text mb-1" style="font-size: 0.9rem;">
                        <span class="status-dot ${acc.isActive ? 'status-active' : 'status-inactive'}"></span>
                        <strong>Status:</strong> ${acc.isActive ? 'Active' : 'Inactive'}
                    </p>
                    <p class="card-text mb-1" style="font-size: 0.9rem;">
                        <strong>Mode:</strong> ${acc.mode === 'partial' ? 'Partial/Spoof' : 'Full'} (${pulseIntervalDisplay})
                    </p>
                    <p class="card-text mb-1" style="font-size: 0.9rem;"><strong>Last Pulse:</strong> ${lastPulseTime}</p>
                    <p class="card-text mb-2" style="font-size: 0.9rem;"><strong>User ID:</strong> ${acc.userId || 'N/A'}</p>
                    
                    ${presenceHtml}
                    
                    <div class="mt-auto pt-2">
                        <hr class="my-2">
                        <div class="d-flex justify-content-between align-items-center">
                             <select class="form-control form-control-sm d-inline-block" id="modeChange-${username}" onchange="changeMode('${username}', this.value)" title="Change Mode">
                                <option value="full" ${acc.mode === 'full' ? 'selected' : ''}>Set Full</option>
                                <option value="partial" ${acc.mode === 'partial' ? 'selected' : ''}>Set Partial</option>
                            </select>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteAccount('${username}')" title="Delete Account">Delete</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        accountListDiv.appendChild(card);
    }
}

async function handleAddAccount(event) {
    event.preventDefault();
    const username = document.getElementById('addUsername').value;
    const robloxCookie = document.getElementById('addRobloxCookie').value;
    const pulseIntervalInput = document.getElementById('addPulseInterval').value;
    const mode = document.getElementById('addMode').value;

    const payload = { 
        username, 
        robloxCookie, 
        mode 
    };

    if (pulseIntervalInput) { // Only include pulseInterval if provided
        payload.pulseInterval = parseInt(pulseIntervalInput, 10);
    }


    try {
        const response = await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json(); // Try to parse JSON regardless of response.ok
        if (!response.ok) {
            throw new Error(result.error || `HTTP error! status: ${response.status}`);
        }
        alert(result.message || 'Account added successfully!');
        fetchAccounts(); 
        document.getElementById('addAccountForm').reset();
    } catch (error) {
        console.error('Error adding account:', error);
        alert(`Error adding account: ${error.message}`);
    }
}

async function deleteAccount(username) {
    if (!confirm(`Are you sure you want to delete account: ${username}? This action cannot be undone.`)) {
        return;
    }
    try {
        const response = await fetch(`/api/accounts/${username}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP error! status: ${response.status}`);
        }
        alert(result.message || 'Account deleted successfully!');
        fetchAccounts(); 
    } catch (error) {
        console.error('Error deleting account:', error);
        alert(`Error deleting account: ${error.message}`);
    }
}

async function changeMode(username, mode) {
    if (!confirm(`Change mode for ${username} to ${mode === 'partial' ? 'Partial/Spoof' : 'Full'}?`)) {
        // Reset dropdown if user cancels
        document.getElementById(`modeChange-${username}`).value = (mode === 'full' ? 'partial' : 'full');
        return;
    }
    try {
        const response = await fetch(`/api/accounts/${username}/mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP error! status: ${response.status}`);
        }
        alert(result.message || `Mode for ${username} changed to ${mode}.`);
        fetchAccounts(); 
    } catch (error) {
        console.error(`Error changing mode for ${username}:`, error);
        alert(`Error changing mode: ${error.message}`);
        fetchAccounts(); // Fetch accounts again to reset dropdown to actual current state
    }
}

async function fetchLogs() {
    const logOutputPre = document.getElementById('logOutput');
    if (!logOutputPre) return;

    try {
        const response = await fetch('/api/logs');
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        const logText = await response.text();
        logOutputPre.textContent = logText;
        // Scroll to the bottom of the log output only if it's already near the bottom
        if (logOutputPre.scrollHeight - logOutputPre.scrollTop <= logOutputPre.clientHeight + 100) { // 100px tolerance
            logOutputPre.scrollTop = logOutputPre.scrollHeight;
        }
    } catch (error) {
        console.error('Error fetching logs:', error);
        logOutputPre.textContent = 'Error loading logs: ' + error.message;
    }
}