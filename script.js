// ============== SUPABASE CONFIG ==============
const SUPABASE_URL = 'https://okbscacqmsvmvmtewrlh.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'sb_publishable_g0Xk99hRIBJEkovLLRxaig_57-3ibRH';

// Initialize Supabase client (loaded from CDN as a global)
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============== APP STATE ==============
const app = {
    currentUser: null,
    employees: [],
    entries: [],

    async init() {
        this.setupEventListeners();
        const session = sessionStorage.getItem('current_user');
        if (session) {
            this.currentUser = JSON.parse(session);
            if (this.currentUser.role === 'admin') this.renderAdminView();
            else this.renderLeaderView();
        }
    },

    setupEventListeners() {
        const showError = (msg) => {
            const el = document.getElementById('login-error');
            el.textContent = msg;
            el.style.display = 'block';
            el.style.color = '#ef4444';
            el.style.marginTop = '1rem';
            el.style.textAlign = 'center';
            el.style.fontSize = '0.85rem';
            console.error('LOGIN ERROR:', msg);
        };

        // LOGIN
        document.getElementById('login-form').onsubmit = async (e) => {
            e.preventDefault();
            hideError();

            const username = document.getElementById('login-username').value.trim().toLowerCase();
            const password = document.getElementById('login-password').value;

            if (!username || !password) {
                showError('Please type both username and password.');
                return;
            }

            // Show "checking..." while we wait
            showError('Checking...');
            document.getElementById('login-error').style.color = '#94a3b8';

            // First, sanity check that Supabase is reachable
            if (!supabase) {
                hideError();
                showError('Supabase is not loaded. Check your internet connection.');
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('users')
                    .select('*')
                    .eq('username', username)
                    .eq('password', password)
                    .single();

                if (error) {
                    hideError();
                    if (error.code === 'PGRST116') {
                        showError('No user found with those details. (Tables might not exist yet — run the SQL in Supabase.)');
                    } else if (error.message && error.message.includes('relation')) {
                        showError('Database tables do not exist yet. Run the SQL setup in Supabase.');
                    } else {
                        showError('DB Error: ' + (error.message || JSON.stringify(error)));
                    }
                    return;
                }
                if (!data) {
                    hideError();
                    showError('No user with that username/password exists.');
                    return;
                }
                await this.login(data);
            } catch (err) {
                hideError();
                showError('Connection error: ' + err.message);
            }
        };

        const hideError = () => {
            const el = document.getElementById('login-error');
            el.style.display = 'none';
        };

        // ADMIN: Add Team Leader
        document.getElementById('add-leader-form').onsubmit = async (e) => {
            e.preventDefault();
            const username = document.getElementById('leader-username').value.trim().toLowerCase();
            const name = document.getElementById('leader-name').value;
            const pass = document.getElementById('leader-pass').value;
            const subsection = document.getElementById('leader-subsection').value;

            const { error } = await supabase.from('users').insert([{
                username, name, password: pass, role: 'leader', subsection
            }]);

            if (error) {
                alert('Could not add user: ' + error.message);
                return;
            }
            alert(`Team leader created!\nLogin: ${username} / ${pass}`);
            e.target.reset();
            await this.loadUsers();
            this.renderAdminView();
        };

        // LEADER: Toggle PPE/Consumables
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
        });

        // LEADER: Show/hide "Other" text input
        document.getElementById('item-select').onchange = (e) => {
            document.getElementById('other-item-container').classList.toggle('hidden', e.target.value !== 'Other');
        };

        // LEADER: Add Employee
        document.getElementById('add-employee-form').onsubmit = async (e) => {
            e.preventDefault();
            const name = document.getElementById('employee-name').value;
            const { error } = await supabase.from('employees').insert([{
                name,
                subsection: this.currentUser.subsection,
                leader_id: this.currentUser.id
            }]);
            if (error) return alert(error.message);
            e.target.reset();
            await this.loadEmployees();
            this.renderLeaderView();
        };

        // LEADER: Remove Employee (event delegation)
        document.getElementById('employee-list').addEventListener('click', async (e) => {
            if (e.target.classList.contains('remove-emp')) {
                const id = e.target.dataset.id;
                if (!confirm('Remove this employee?')) return;
                await supabase.from('employees').delete().eq('id', id);
                await this.loadEmployees();
                this.renderLeaderView();
            }
        });

        // LEADER: Submit Movement → opens confirm modal
        document.getElementById('movement-form').onsubmit = (e) => {
            e.preventDefault();
            this.showConfirmModal();
        };

        // Modal buttons
        document.getElementById('btn-cancel').onclick = () => {
            document.getElementById('confirm-modal').style.display = 'none';
        };
        document.getElementById('btn-confirm').onclick = () => this.submitMovement();
    },

    async login(user) {
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
            this.renderLeaderView();
        }
    },

    async logout() {
        this.currentUser = null;
        sessionStorage.removeItem('current_user');
        document.getElementById('admin-view').classList.add('hidden');
        document.getElementById('leader-view').classList.add('hidden');
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('login-form').reset();
    },

    async loadUsers() {
        const { data } = await supabase.from('users').select('*').eq('role', 'leader').order('created_at', { ascending: true });
        this.users = data || [];
    },

    async loadEmployees() {
        const { data } = await supabase.from('employees').select('*');
        this.employees = data || [];
    },

    async loadEntries() {
        const { data } = await supabase.from('stock_entries').select('*');
        this.entries = data || [];
    },

    async deleteUser(username) {
        if (!confirm('Delete this team leader?')) return;
        await supabase.from('users').delete().eq('username', username);
        await this.loadUsers();
        this.renderAdminView();
    },

    renderAdminView() {
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

    renderLeaderView() {
        document.getElementById('leader-view').classList.remove('hidden');
        document.getElementById('view-title').textContent = `${this.currentUser.subsection} SUBSECTION`;
        document.getElementById('leader-display-name').textContent = this.currentUser.name;

        const subEmployees = this.employees.filter(e => e.subsection === this.currentUser.subsection);

        // Dropdown
        const select = document.getElementById('allocate-employee');
        select.innerHTML = subEmployees.length
            ? subEmployees.map(e => `<option value="${e.name}">${e.name}</option>`).join('')
            : '<option value="">No employees added yet</option>';

        // List with delete buttons
        const list = document.getElementById('employee-list');
        list.innerHTML = subEmployees.length
            ? subEmployees.map(e => `
                <li style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <span>• ${e.name}</span>
                    <button class="remove-emp secondary" data-id="${e.id}" style="width:auto;padding:0.15rem 0.5rem;font-size:0.7rem;">Remove</button>
                </li>
            `).join('')
            : '<li>No employees added yet.</li>';

        // Recent entries
        const recent = document.getElementById('recent-entries');
        const subEntries = this.entries
            .filter(e => e.subsection === this.currentUser.subsection)
            .slice(-5)
            .reverse();
        recent.innerHTML = subEntries.length
            ? subEntries.map(e => `
                <div style="border-bottom:1px solid var(--border-color);padding:0.5rem 0;">
                    <div style="font-weight:600;">${e.item} → ${e.employee}</div>
                    <div style="font-size:0.75rem;">Issued: ${e.issued} | Received: ${e.received} | ${new Date(e.created_at).toLocaleString()}</div>
                </div>
            `).join('')
            : 'No entries yet.';
    },

    showConfirmModal() {
        const item = document.getElementById('item-select').value === 'Other'
            ? document.getElementById('other-item-text').value
            : document.getElementById('item-select').value;
        const employee = document.getElementById('allocate-employee').value;
        const issued = document.getElementById('check-issued').checked ? document.getElementById('amount-issued').value : 0;
        const received = document.getElementById('check-received').checked ? document.getElementById('amount-received').value : 0;

        if (!employee) return alert('Please select an employee first.');

        document.getElementById('confirm-details').innerHTML = `
            Item: ${item}<br>
            Employee: ${employee}<br>
            Issued: ${issued}<br>
            Received: ${received}
        `;
        document.getElementById('confirm-modal').style.display = 'flex';
    },

    async submitMovement() {
        const type = document.querySelector('.toggle-btn.active').dataset.type;
        const item = document.getElementById('item-select').value === 'Other'
            ? document.getElementById('other-item-text').value
            : document.getElementById('item-select').value;
        const employee = document.getElementById('allocate-employee').value;
        const issued = parseInt(document.getElementById('check-issued').checked ? document.getElementById('amount-issued').value : 0);
        const received = parseInt(document.getElementById('check-received').checked ? document.getElementById('amount-received').value : 0);
        const notes = document.getElementById('notes').value;

        const { error } = await supabase.from('stock_entries').insert([{
            subsection: this.currentUser.subsection,
            leader_id: this.currentUser.id,
            leader_name: this.currentUser.name,
            type, item, employee, issued, received, notes
        }]);

        if (error) return alert('Save failed: ' + error.message);

        document.getElementById('confirm-modal').style.display = 'none';
        document.getElementById('movement-form').reset();
        document.getElementById('other-item-container').classList.add('hidden');
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-type="PPE"]').classList.add('active');

        await this.loadEntries();
        this.renderLeaderView();
    },

    async exportData() {
        await this.loadEntries();
        if (this.entries.length === 0) return alert('No data to export.');

        const sortedEntries = [...this.entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const totals = {};

        let tableRows = '';
        sortedEntries.forEach(e => {
            const key = `${e.subsection}-${e.item}`;
            totals[key] = (totals[key] || 0) + (e.received - e.issued);
            tableRows += `
                <tr>
                    <td>${e.subsection}</td>
                    <td>${new Date(e.created_at).toLocaleString()}</td>
                    <td>${e.item}</td>
                    <td>${e.type}</td>
                    <td>${e.leader_name}</td>
                    <td>${e.employee}</td>
                    <td style="text-align:right;">${e.issued}</td>
                    <td style="text-align:right;">${e.received}</td>
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
                        <th>Team Leader</th><th>Allocated To</th>
                        <th>Issued</th><th>Received</th><th>Running Total</th><th>Notes</th>
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
