// ============== SUPABASE CONFIG ==============
const SUPABASE_URL = 'https://okbscacqmsvmvmtewrlh.supabase.co';
// ⚠️ PASTE WHICHEVER KEY WORKED FOR YOU BEFORE:
// Either your LEGACY JWT key (starts with eyJ...) OR your PUBLISHABLE key (starts with sb_publishable_)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYnNjYWNxbXN2bXZtdGV3cmxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzE3NjAsImV4cCI6MjEwMjgwNzc2MH0.uf30y8ce13VoIUTB1eyfurxellJa0sShsXeb335AnQI'; // <-- PUT YOUR WORKING KEY HERE

let db;
try {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error('Supabase init failed:', e);
}

// ============== ON-SCREEN ERROR DISPLAY ==============
function showPageError(msg) {
    let el = document.getElementById('page-error-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'page-error-banner';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ef4444;color:white;padding:12px 16px;font-size:14px;z-index:99999;font-family:monospace;white-space:pre-wrap;';
        document.body.appendChild(el);
    }
    el.textContent = '⚠️ ' + msg;
    console.error('PAGE ERROR:', msg);
}

window.addEventListener('error', (event) => {
    showPageError('JS error: ' + event.message);
});

window.addEventListener('unhandledrejection', (event) => {
    showPageError('Promise error: ' + (event.reason && event.reason.message ? event.reason.message : event.reason));
});

// ============== APP STATE ==============
const app = {
    currentUser: null,
    employees: [],
    entries: [],
    users: [],

    async init() {
        if (!db) {
            showPageError('Supabase not initialized. Set the legacy key in script.js line 5.');
            return;
        }
        if (SUPABASE_ANON_KEY === 'PUT_YOUR_LEGACY_ANON_KEY_HERE') {
            showPageError('You need to replace PUT_YOUR_LEGACY_ANON_KEY_HERE on line 5 with your actual eyJ... key.');
            return;
        }
        this.setupEventListeners();
        const session = sessionStorage.getItem('current_user');
        if (session) {
            try {
                this.currentUser = JSON.parse(session);
                if (this.currentUser.role === 'admin') this.renderAdminView();
                else this.showHub();
            } catch (e) {
                sessionStorage.removeItem('current_user');
            }
        }
    },

    showError(msg) {
        const el = document.getElementById('login-error');
        if (!el) return showPageError(msg);
        el.textContent = msg;
        el.style.display = 'block';
        el.style.color = '#ef4444';
        el.style.marginTop = '1rem';
        el.style.textAlign = 'center';
        el.style.fontSize = '0.85rem';
        el.style.background = 'rgba(239,68,68,0.1)';
        el.style.padding = '0.75rem';
        el.style.borderRadius = '0.375rem';
        console.error('LOGIN ERROR:', msg);
    },

    hideError() {
        const el = document.getElementById('login-error');
        if (el) el.style.display = 'none';
    },

    // ============== EVENT SETUP ==============
    setupEventListeners() {
        const self = this;

        // LOGIN
        document.getElementById('login-form').onsubmit = async function (e) {
            e.preventDefault();
            self.hideError();

            const username = document.getElementById('login-username').value.trim().toLowerCase();
            const password = document.getElementById('login-password').value;

            if (!username || !password) {
                self.showError('Please type both username and password.');
                return;
            }

            try {
                self.showError('Checking...');
                document.getElementById('login-error').style.color = '#94a3b8';

                const { data, error } = await db
                    .from('users')
                    .select('*')
                    .eq('username', username)
                    .eq('password', password)
                    .maybeSingle();

                self.hideError();

                if (!data) {
                    self.showError('No user with that username/password exists.');
                    return;
                }
                if (error) {
                    self.showError(error.message);
                    return;
                }
                await self.login(data);
            } catch (err) {
                self.hideError();
                self.showError('Connection error: ' + err.message);
            }
        };

        // ADMIN: Add Team Leader
        document.getElementById('add-leader-form').onsubmit = async function (e) {
            e.preventDefault();
            const username = document.getElementById('leader-username').value.trim().toLowerCase();
            const name = document.getElementById('leader-name').value;
            const pass = document.getElementById('leader-pass').value;
            const subsection = document.getElementById('leader-subsection').value;

            const { error } = await db.from('users').insert([{
                username, name, password: pass, role: 'leader', subsection
            }]);

            if (error) {
                alert('Could not add user: ' + error.message);
                return;
            }
            alert(`Team leader created!\nLogin: ${username} / ${pass}`);
            e.target.reset();
            await self.loadUsers();
            self.renderAdminView();
        };

        // PPE/CONSUMABLES toggle on both forms
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.onclick = () => {
                const formEl = btn.closest('form');
                formEl.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const itemSel = formEl.querySelector('select[id$="item-select"]');
                if (itemSel) self.filterItemsByCategory(itemSel);
            };
        });

        // Item dropdown - show/hide Other input
        document.getElementById('item-select').onchange = (e) => {
            document.getElementById('other-item-container').classList.toggle('hidden', e.target.value !== 'Other');
        };
        document.getElementById('arrival-item-select').onchange = (e) => {
            document.getElementById('arrival-other-item-container').classList.toggle('hidden', e.target.value !== 'Other');
        };

        // Add Employee forms
        document.querySelectorAll('form[id^="add-employee"]').forEach(form => {
            form.onsubmit = async function (e) {
                e.preventDefault();
                const nameInput = form.querySelector('input');
                const name = nameInput.value.trim();
                if (!name) return;

                if (self.employees.some(emp => emp.subsection === self.currentUser.subsection && emp.name.toLowerCase() === name.toLowerCase())) {
                    alert('Employee already added.');
                    return;
                }

                const { error } = await db.from('employees').insert([{
                    name,
                    subsection: self.currentUser.subsection,
                    leader_id: self.currentUser.id
                }]);
                if (error) return alert(error.message);
                nameInput.value = '';
                await self.loadEmployees();
                self.renderSidePanels();
            };
        });

        // Remove employee
        document.querySelectorAll('[id^="employee-list"]').forEach(ul => {
            ul.addEventListener('click', async function (e) {
                if (e.target.classList.contains('remove-emp')) {
                    const id = e.target.dataset.id;
                    if (!confirm('Remove this employee?')) return;
                    await db.from('employees').delete().eq('id', id);
                    await self.loadEmployees();
                    self.renderSidePanels();
                }
            });
        });

        // Issue form submit
        document.getElementById('movement-form').onsubmit = function (e) {
            e.preventDefault();
            self.showConfirmModal('issue');
        };

        // Arrival form submit
        document.getElementById('arrival-form').onsubmit = function (e) {
            e.preventDefault();
            self.showConfirmModal('arrival');
        };

        // Modal buttons
        document.getElementById('btn-cancel').onclick = () => {
            document.getElementById('confirm-modal').style.display = 'none';
        };
        document.getElementById('btn-confirm').onclick = () => self.submitMovement();
    },

    filterItemsByCategory(selectEl) {
        const formEl = selectEl.closest('form');
        const activeType = formEl.querySelector('.toggle-btn.active').dataset.type;
        let firstVisible = null;
        for (const opt of Array.from(selectEl.options)) {
            if (!opt.dataset.category) continue;
            const visible = opt.dataset.category === activeType;
            opt.style.display = visible ? '' : 'none';
            if (visible && firstVisible === null) firstVisible = opt.value;
        }
        if (firstVisible) selectEl.value = firstVisible;
        selectEl.dispatchEvent(new Event('change'));
    },

    // ============== VIEW SWITCHING ==============
    hideAllViews() {
        ['login-view', 'admin-view', 'hub-view', 'leader-view', 'arrival-view'].forEach(id => {
            document.getElementById(id).classList.add('hidden');
        });
    },

    async showHub() {
        this.hideAllViews();
        document.getElementById('hub-view').classList.remove('hidden');
        document.getElementById('hub-title').textContent = `${this.currentUser.subsection} SUBSECTION`;
        document.getElementById('hub-leader-name').textContent = this.currentUser.name;
        await this.loadEmployees();
        await this.loadEntries();
    },

    async showIssuePage() {
        this.hideAllViews();
        document.getElementById('leader-view').classList.remove('hidden');
        document.getElementById('view-title').textContent = `${this.currentUser.subsection} — ISSUE STOCK`;
        document.getElementById('leader-display-name').textContent = this.currentUser.name;
        await this.loadEmployees();
        await this.loadEntries();
        this.renderSidePanels();
        this.setActiveToggle('movement-form', 'PPE');
        this.filterItemsByCategory(document.getElementById('item-select'));
    },

    async showArrivalPage() {
        this.hideAllViews();
        document.getElementById('arrival-view').classList.remove('hidden');
        document.getElementById('arrival-title').textContent = `${this.currentUser.subsection} — ARRIVING STOCK`;
        document.getElementById('arrival-display-name').textContent = this.currentUser.name;
        await this.loadEmployees();
        await this.loadEntries();
        this.renderSidePanels();
        this.setActiveToggle('arrival-form', 'PPE');
        this.filterItemsByCategory(document.getElementById('arrival-item-select'));
    },

    setActiveToggle(formId, type) {
        document.querySelectorAll(`#${formId} .toggle-btn`).forEach(b => b.classList.remove('active'));
        const target = document.querySelector(`#${formId} .toggle-btn[data-type="${type}"]`);
        if (target) target.classList.add('active');
    },

    // ============== LOGIN / LOGOUT ==============
    async login(user) {
        try {
            this.currentUser = user;
            sessionStorage.setItem('current_user', JSON.stringify(user));
            document.getElementById('login-view').classList.add('hidden');
            document.getElementById('login-error').style.display = 'none';

            await this.loadEmployees();
            await this.loadEntries();

            if (user.role === 'admin') {
                await this.loadUsers();
                this.renderAdminView();
            } else {
                this.showHub();
            }
        } catch (err) {
            showPageError('Login failed: ' + err.message);
        }
    },

    async logout() {
        this.currentUser = null;
        sessionStorage.removeItem('current_user');
        this.hideAllViews();
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('login-form').reset();
    },

    // ============== DATA LOADERS ==============
    async loadUsers() {
        const { data } = await db.from('users').select('*').eq('role', 'leader').order('created_at', { ascending: true });
        this.users = data || [];
    },

    async loadEmployees() {
        const { data } = await db.from('employees').select('*');
        this.employees = data || [];
    },

    async loadEntries() {
        const { data } = await db.from('stock_entries').select('*');
        this.entries = data || [];
    },

    async deleteUser(username) {
        if (!confirm('Delete this team leader?')) return;
        await db.from('users').delete().eq('username', username);
        await this.loadUsers();
        this.renderAdminView();
    },

    // ============== ADMIN VIEW ==============
    renderAdminView() {
        this.hideAllViews();
        document.getElementById('admin-view').classList.remove('hidden');
        const tbody = document.querySelector('#leaders-table tbody');
        tbody.innerHTML = '';
        (this.users || []).forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.name}</td>
                <td>${u.subsection}</td>
                <td><button onclick="app.deleteUser('${u.username}')" class="secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;">Delete</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    // ============== SIDE PANELS ==============
    renderSidePanels() {
        if (!this.currentUser) return;
        const subEmployees = this.employees.filter(e => e.subsection === this.currentUser.subsection);

        const empOptsHtml = subEmployees.length
            ? subEmployees.map(e => `<option value="${e.name}">${e.name}</option>`).join('')
            : '<option value="">No employees added yet</option>';

        ['allocate-employee', 'arrival-allocate-employee'].forEach(id => {
            const sel = document.getElementById(id);
            if (sel) sel.innerHTML = empOptsHtml;
        });

        const empListHtml = subEmployees.length
            ? subEmployees.map(e => `
                <li style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <span>• ${e.name}</span>
                    <button class="remove-emp secondary" data-id="${e.id}" style="width:auto;padding:0.15rem 0.5rem;font-size:0.7rem;">Remove</button>
                </li>
            `).join('')
            : '<li>No employees added yet.</li>';

        ['employee-list', 'employee-list-arrival'].forEach(id => {
            const ul = document.getElementById(id);
            if (ul) ul.innerHTML = empListHtml;
        });

        const subEntries = this.entries
            .filter(e => e.subsection === this.currentUser.subsection)
            .slice(-5)
            .reverse();

        const recentHtml = subEntries.length
            ? subEntries.map(e => {
                const action = e.received > 0
                    ? `<span style="color:#22c55e;">📥 +${e.received}</span>`
                    : `<span style="color:#f97316;">📤 -${e.issued}</span>`;
                return `
                    <div style="border-bottom:1px solid var(--border-color);padding:0.5rem 0;">
                        <div style="display:flex;justify-content:space-between;font-weight:600;">
                            <span>${e.item} → ${e.employee}</span>
                            ${action}
                        </div>
                        <div style="font-size:0.75rem;color:#94a3b8;">${(e.type || '').toLowerCase()} · ${new Date(e.created_at).toLocaleString()}</div>
                    </div>
                `;
            }).join('')
            : 'No entries yet.';

        ['recent-entries', 'recent-entries-arrival'].forEach(id => {
            const div = document.getElementById(id);
            if (div) div.innerHTML = recentHtml;
        });
    },

    // ============== FORM SUBMISSIONS ==============
    showConfirmModal(kind) {
        const data = this._getFormData(kind);
        if (!data) return;

        if (!data.employee) return alert('Please select an employee.');
        if (!data.amount || data.amount <= 0) return alert('Please enter an amount greater than 0.');

        const verb = kind === 'issue' ? 'Issued' : 'Received';
        document.getElementById('confirm-details').innerHTML = `
            Type: ${data.type}<br>
            Item: ${data.item}<br>
            Employee: ${data.employee}<br>
            ${verb}: ${data.amount}<br>
            Notes: ${data.notes || '(none)'}
        `;
        document.getElementById('confirm-modal').dataset.kind = kind;
        document.getElementById('confirm-modal').style.display = 'flex';
    },

    _getFormData(kind) {
        const formId = kind === 'issue' ? 'movement-form' : 'arrival-form';
        const form = document.getElementById(formId);
        if (!form) return null;

        const type = form.querySelector('.toggle-btn.active').dataset.type;
        const itemSel = form.querySelector('select[id$="item-select"]');
        const otherInput = form.querySelector('input[id$="other-item-text"]');
        const empSel = form.querySelector('select[id$="allocate-employee"]');
        const amountInput = form.querySelector('input[type="number"]');
        const notesInput = form.querySelector('textarea');

        let item = itemSel.value;
        if (item === 'Other') item = (otherInput.value || '').trim();
        if (!item) { alert('Please select / specify an item.'); return null; }

        return {
            type,
            item,
            employee: empSel.value,
            amount: parseInt(amountInput.value || '0'),
            notes: (notesInput.value || '').trim()
        };
    },

    async submitMovement() {
        const kind = document.getElementById('confirm-modal').dataset.kind;
        const data = this._getFormData(kind);
        if (!data) return;

        const insertRow = {
            subsection: this.currentUser.subsection,
            leader_id: this.currentUser.id,
            leader_name: this.currentUser.name,
            type: data.type,
            item: data.item,
            employee: data.employee,
            issued: kind === 'issue' ? data.amount : 0,
            received: kind === 'arrival' ? data.amount : 0,
            notes: data.notes
        };

        const { error } = await db.from('stock_entries').insert([insertRow]);

        if (error) return alert('Save failed: ' + error.message);

        document.getElementById('confirm-modal').style.display = 'none';

        const formId = kind === 'issue' ? 'movement-form' : 'arrival-form';
        document.getElementById(formId).reset();
        const otherContainerId = kind === 'issue' ? 'other-item-container' : 'arrival-other-item-container';
        document.getElementById(otherContainerId).classList.add('hidden');
        this.setActiveToggle(formId, 'PPE');
        this.filterItemsByCategory(document.getElementById(kind === 'issue' ? 'item-select' : 'arrival-item-select'));

        await this.loadEntries();
        this.showHub();
    },

    // ============== EXCEL EXPORT ==============
    async exportData() {
        await this.loadEntries();
        if (this.entries.length === 0) return alert('No data to export.');

        const sortedEntries = [...this.entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const totals = {};

        let tableRows = '';
        sortedEntries.forEach(e => {
            const key = `${e.subsection}-${e.item}`;
            totals[key] = (totals[key] || 0) + (e.received - e.issued);
            const direction = e.received > 0 ? 'Received' : 'Issued';
            const amt = e.received > 0 ? e.received : e.issued;
            tableRows += `
                <tr>
                    <td>${e.subsection}</td>
                    <td>${new Date(e.created_at).toLocaleString()}</td>
                    <td>${e.item}</td>
                    <td>${e.type || ''}</td>
                    <td>${direction}</td>
                    <td>${e.leader_name}</td>
                    <td>${e.employee}</td>
                    <td style="text-align:right;">${amt}</td>
                    <td style="text-align:right;font-weight:bold;">${totals[key]}</td>
                    <td>${e.notes || ''}</td>
                </tr>
            `;
        });

        const html = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
            <head>
                <meta charset="UTF-8">
                <style>
                    table { border-collapse: collapse; font-family: Arial, sans-serif; }
                    thead tr { background-color: #f97316; color: white; }
                    th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; }
                    th { font-weight: bold; text-transform: uppercase; font-size: 12px; }
                    td { font-size: 12px; }
                    tr:nth-child(even) { background-color: #f8f8f8; }
                    .title { font-size: 18px; font-weight: bold; margin-bottom: 10px; font-family: Arial; }
                </style>
            </head>
            <body>
                <div class="title">Stock Tracking Report — ${new Date().toLocaleDateString()}</div>
                <table>
                    <thead><tr>
                        <th>Department</th><th>Date</th><th>Item</th><th>Type</th>
                        <th>Direction</th><th>Team Leader</th><th>Allocated To</th>
                        <th>Quantity</th><th>Running Total</th><th>Notes</th>
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </body>
            </html>
        `;

        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Stock_Report_${new Date().toISOString().split('T')[0]}.xls`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

app.init();
