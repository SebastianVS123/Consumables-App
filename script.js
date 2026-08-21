// ============== SUPABASE CONFIG ==============
const SUPABASE_URL = 'https://okbscacqmsvmvmtewrlh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYnNjYWNxbXN2bXZtdGV3cmxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzE3NjAsImV4cCI6MjEwMjgwNzc2MH0.uf30y8ce13VoIUTB1eyfurxellJa0sShsXeb335AnQI'; // <-- paste your eyJ... key here

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
            showPageError('Supabase not initialized.');
            return;
        }
        if (SUPABASE_ANON_KEY === '<USER_LEGACY_KEY>') {
            showPageError('Replace <USER_LEGACY_KEY> on line 4 with your actual eyJ... key.');
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

    // ============ EVENT SETUP ============
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

        // PPE / CONSUMABLES toggle
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.onclick = () => {
                const formEl = btn.closest('form');
                formEl.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const itemSel = formEl.querySelector('select[id$="item-select"]');
                if (itemSel) self.filterItemsByCategory(itemSel);
                self.refreshStockHint();
            };
        });

        // Show/hide Other input
        document.getElementById('item-select').onchange = (e) => {
            document.getElementById('other-item-container').classList.toggle('hidden', e.target.value !== 'Other');
            self.refreshStockHint();
        };
        document.getElementById('arrival-item-select').onchange = (e) => {
            document.getElementById('arrival-other-item-container').classList.toggle('hidden', e.target.value !== 'Other');
        };

        // Add Employee form (issue page only — arrival page has no employees)
        const empForm = document.getElementById('add-employee');
        if (empForm) {
            empForm.onsubmit = async function (e) {
                e.preventDefault();
                const nameInput = empForm.querySelector('input');
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
        }

        // Remove employee
        const empList = document.getElementById('employee-list');
        if (empList) {
            empList.addEventListener('click', async function (e) {
                if (e.target.classList.contains('remove-emp')) {
                    const id = e.target.dataset.id;
                    if (!confirm('Remove this employee?')) return;
                    await db.from('employees').delete().eq('id', id);
                    await self.loadEmployees();
                    self.renderSidePanels();
                }
            });
        }

        // Live-update stock hint when either amount field changes
        ['amount-issued', 'amount-received'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => self.refreshStockHint());
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
            // Reset override flow if user cancels from confirm
            self._forceSubmitOnWarning = false;
            self._pendingOverrideReason = null;
        };
        document.getElementById('btn-confirm').onclick = () => self.submitMovement();

        // Warning modal buttons (over usable stock)
        document.getElementById('btn-warn-cancel').onclick = () => {
            document.getElementById('warning-modal').style.display = 'none';
        };
        document.getElementById('btn-warn-force').onclick = () => {
            document.getElementById('warning-modal').style.display = 'none';
            self._forceSubmitOnWarning = true;
            self.submitMovement();
        };

        // Audit warning modal buttons (issued > received for consumables)
        document.getElementById('btn-audit-cancel').onclick = () => {
            document.getElementById('audit-warning-modal').style.display = 'none';
            self._pendingOverrideReason = null;
        };
        document.getElementById('btn-audit-continue').onclick = () => {
            // User clicked "I am aware, override" — now ask for a reason
            document.getElementById('audit-warning-modal').style.display = 'none';
            document.getElementById('override-reason').value = '';
            document.getElementById('override-modal').style.display = 'flex';
        };

        // Override reason modal buttons
        document.getElementById('btn-override-cancel').onclick = () => {
            document.getElementById('override-modal').style.display = 'none';
            self._pendingOverrideReason = null;
        };
        document.getElementById('btn-override-submit').onclick = () => {
            const reason = document.getElementById('override-reason').value.trim();
            if (!reason) {
                alert('A reason is required when overriding the audit rule.');
                return;
            }
            document.getElementById('override-modal').style.display = 'none';
            self._pendingOverrideReason = reason;
            // Now open the standard confirmation modal with override flag set
            self._forceSubmitOnWarning = true;
            self.showConfirmModal(self._currentSubmitKind || 'issue');
        };
    },

    filterItemsByCategory(selectEl) {
        const formEl = selectEl.closest('form');
        const activeType = formEl.querySelector('.toggle-btn.active').dataset.type;
        let firstVisible = null;
        for (const opt of Array.from(selectEl.options)) {
            // "Other" is always available under both PPE and Consumables
            if (opt.value === 'Other') {
                opt.style.display = '';
                continue;
            }
            // Items without a category are hidden
            if (!opt.dataset.category) {
                opt.style.display = 'none';
                continue;
            }
            const visible = opt.dataset.category === activeType;
            opt.style.display = visible ? '' : 'none';
            if (visible && firstVisible === null) firstVisible = opt.value;
        }
        if (firstVisible) selectEl.value = firstVisible;
        selectEl.dispatchEvent(new Event('change'));
    },

    // ============ VIEW SWITCHING ============
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
        this.refreshStockHint();
    },

    async showArrivalPage() {
        this.hideAllViews();
        document.getElementById('arrival-view').classList.remove('hidden');
        document.getElementById('arrival-title').textContent = `${this.currentUser.subsection} — ARRIVING STOCK`;
        document.getElementById('arrival-display-name').textContent = this.currentUser.name;
        await this.loadEntries();
        this.setActiveToggle('arrival-form', 'PPE');
        this.filterItemsByCategory(document.getElementById('arrival-item-select'));
    },

    setActiveToggle(formId, type) {
        document.querySelectorAll(`#${formId} .toggle-btn`).forEach(b => b.classList.remove('active'));
        const target = document.querySelector(`#${formId} .toggle-btn[data-type="${type}"]`);
        if (target) target.classList.add('active');
    },

    // ============ LOGIN / LOGOUT ============
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

    // ============ DATA LOADERS ============
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

    // ============ ADMIN VIEW ============
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

    // ============ SIDEBAR (issue page only) ============
    renderSidePanels() {
        if (!this.currentUser) return;
        const subEmployees = this.employees.filter(e => e.subsection === this.currentUser.subsection);

        const empOptsHtml = subEmployees.length
            ? subEmployees.map(e => `<option value="${e.name}">${e.name}</option>`).join('')
            : '<option value="">No employees added yet</option>';

        const sel = document.getElementById('allocate-employee');
        if (sel) sel.innerHTML = empOptsHtml;

        const empListHtml = subEmployees.length
            ? subEmployees.map(e => `
                <li style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <span>• ${e.name}</span>
                    <button class="remove-emp secondary" data-id="${e.id}" style="width:auto;padding:0.15rem 0.5rem;font-size:0.7rem;">Remove</button>
                </li>
            `).join('')
            : '<li>No employees added yet.</li>';

        const ul = document.getElementById('employee-list');
        if (ul) ul.innerHTML = empListHtml;

        const subEntries = this.entries
            .filter(e => e.subsection === this.currentUser.subsection)
            .slice(-5)
            .reverse();

        const recentHtml = subEntries.length
            ? subEntries.map(e => {
                const isIssue = !!e.employee;
                const parts = [];
                if (e.issued > 0)  parts.push(`<span style="color:#f97316;">📤 issued -${e.issued}</span>`);
                if (e.received > 0) {
                    if (isIssue) {
                        // For issue rows, received = audit/disposal (not new stock)
                        parts.push(`<span style="color:#94a3b8;">🗑 disposed +${e.received}</span>`);
                    } else {
                        parts.push(`<span style="color:#22c55e;">📦 arrived +${e.received}</span>`);
                    }
                }
                const action = parts.length ? parts.join(' · ') : '<span style="color:#94a3b8;">—</span>';
                return `
                    <div style="border-bottom:1px solid var(--border-color);padding:0.5rem 0;">
                        <div style="display:flex;justify-content:space-between;font-weight:600;">
                            <span>${e.item} ${e.employee ? '→ ' + e.employee : ''}</span>
                            ${action}
                        </div>
                        <div style="font-size:0.75rem;color:#94a3b8;">${(e.type || '').toLowerCase()} · ${new Date(e.created_at).toLocaleString()}</div>
                    </div>
                `;
            }).join('')
            : 'No entries yet.';

        const recentEl = document.getElementById('recent-entries');
        if (recentEl) recentEl.innerHTML = recentHtml;
    },

    // ============ STOCK LEVEL HELPERS ============
    // Usable stock only considers ARRIVAL receipts (employee==null rows) minus
    // ISSUED new stock. The "used stock returned from employee" recorded on
    // the Issue page is treated as DISPOSED and does NOT re-enter usable inventory.
    computeUsableStock(itemName) {
        let received = 0, issued = 0;
        for (const e of this.entries) {
            if (e.item !== itemName) continue;
            if (e.employee) {
                // Issue row: only `issued` depletes usable stock.
                // The `received` amount here is used stock coming back from the
                // employee — logged for audit, but discarded (disposed of).
                issued += (e.issued || 0);
            } else {
                // Arrival row: new usable stock coming in.
                received += (e.received || 0);
            }
        }
        return received - issued;
    },

    refreshStockHint() {
        const hintEl = document.getElementById('stock-hint');
        if (!hintEl) return;
        const itemSel = document.getElementById('item-select');
        if (!itemSel || itemSel.value === 'Other') {
            hintEl.innerHTML = '&nbsp;';
            return;
        }
        const item = itemSel.value;
        const stock = this.computeUsableStock(item);
        const issuedEl = document.getElementById('amount-issued');
        const issued = parseInt(issuedEl ? (issuedEl.value || '0') : '0');
        const projected = stock - issued;  // used-returned does NOT affect usable stock
        const colour = stock >= 0 ? '#22c55e' : '#ef4444';
        const pColour = projected >= 0 ? '#22c55e' : '#ef4444';
        hintEl.innerHTML =
            `Current usable stock: <strong style="color:${colour}">${stock}</strong>` +
            (issued > 0
                ? ` · After this issue: <strong style="color:${pColour}">${projected}</strong>`
                : '');
    },

    // ============ FORM SUBMISSIONS ============
    showConfirmModal(kind) {
        const data = this._getFormData(kind);
        if (!data) return;

        if (kind === 'issue') {
            if (!data.employee) return alert('Please select an employee.');
            const issuing = data.issued || 0;
            const receiving = data.received || 0;
            if (issuing <= 0 && receiving <= 0) {
                return alert('Enter an amount in either "Amount Issued" or "Old Stock Returned".');
            }

            // Stash current kind so override-modal flow can come back here
            this._currentSubmitKind = 'issue';

            // Audit rule: For consumables, if issuing more than what was returned, block.
            // PPE is exempt from this rule.
            if (data.type === 'CONSUMABLES' && issuing > receiving && !this._forceSubmitOnWarning) {
                // We haven't yet completed override flow — show audit warning
                document.getElementById('audit-warning-details').innerHTML = `
                    <strong>Are you sure?</strong> Currently amount issued (<strong>${issuing}</strong>) exceeds
                    amount received from employee (<strong>${receiving}</strong>) for <strong>${data.item}</strong>.
                    <br><br>
                    <em>This is against the rules. Every issue should match a return.</em>
                `;
                document.getElementById('audit-warning-modal').style.display = 'flex';
                return;
            }

            if (data.type === 'CONSUMABLES' && issuing > 0) {
                const liveStock = this.computeUsableStock(data.item);
                if (issuing > Math.max(0, liveStock)) {
                    const projectedAfter = liveStock - issuing;
                    document.getElementById('warning-details').innerHTML = `
                        You are issuing <strong>${issuing}</strong> of <strong>${data.item}</strong>.
                        <br><br>
                        Current usable stock across all departments: <strong>${Math.max(0, liveStock)}</strong>.
                        <br><br>
                        Continuing will leave usable stock at <strong style="color:#ef4444;">${projectedAfter}</strong>.
                        ${receiving > 0 ? '<br><br><em>(Old stock being returned is logged but does not re-enter inventory.)</em>' : ''}
                    `;
                    document.getElementById('warning-modal').style.display = 'flex';
                    return;
                }
            }

            const overrideLine = this._pendingOverrideReason
                ? `<div style="margin-top:0.5rem;padding:0.5rem;background:rgba(239,68,68,0.1);border-left:3px solid #ef4444;font-size:0.85rem;"><strong>OVERRIDE REASON:</strong> ${this._pendingOverrideReason}</div>`
                : '';

            document.getElementById('confirm-details').innerHTML = `
                Type: ${data.type}<br>
                Item: ${data.item}<br>
                Employee: ${data.employee}<br>
                Amount Issued: ${issuing}<br>
                Old Stock Returned (audit / disposed): ${receiving}<br>
                <span style="font-size:0.75rem;color:var(--text-secondary);">Note: returned old stock is logged only for audit and does NOT re-enter usable inventory.</span><br>
                Notes: ${data.notes || '(none)'}
                ${overrideLine}
            `;
        } else if (kind === 'arrival') {
            if (!data.amount || data.amount <= 0) return alert('Please enter an amount greater than 0.');
            document.getElementById('confirm-details').innerHTML = `
                Type: ${data.type}<br>
                Item: ${data.item}<br>
                Amount Received: ${data.amount}<br>
                Notes: ${data.notes || '(none)'}
            `;
        }

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
        const notesInput = form.querySelector('textarea');

        let item = itemSel.value;
        if (item === 'Other') item = (otherInput.value || '').trim();
        if (!item) { alert('Please select / specify an item.'); return null; }

        let issued = 0, received = 0, amount = 0;
        if (kind === 'issue') {
            const issuedEl = form.querySelector('#amount-issued');
            const receivedEl = form.querySelector('#amount-received');
            issued = parseInt(issuedEl ? (issuedEl.value || '0') : '0');
            received = parseInt(receivedEl ? (receivedEl.value || '0') : '0');
        } else {
            const arrivalEl = form.querySelector('#arrival-amount');
            amount = parseInt(arrivalEl ? (arrivalEl.value || '0') : '0');
        }

        return {
            type,
            item,
            employee: empSel ? empSel.value : '',
            issued,
            received,
            amount,
            notes: (notesInput.value || '').trim()
        };
    },

    async submitMovement() {
        const kind = document.getElementById('confirm-modal').dataset.kind;
        const data = this._getFormData(kind);
        if (!data) return;

        // Compose final notes — if there was an override reason, prefix it for admin visibility
        let finalNotes = data.notes || '';
        if (this._pendingOverrideReason) {
            finalNotes = `[OVERRIDE: ${this._pendingOverrideReason}]${finalNotes ? ' | ' + finalNotes : ''}`;
        }

        const insertRow = {
            subsection: this.currentUser.subsection,
            leader_id: this.currentUser.id,
            leader_name: this.currentUser.name,
            type: data.type,
            item: data.item,
            employee: data.employee || null,
            issued: kind === 'issue' ? (data.issued || 0) : 0,
            received: kind === 'issue' ? (data.received || 0) : (data.amount || 0),
            notes: finalNotes
        };

        // Reset override flow flags after composing
        this._forceSubmitOnWarning = false;
        this._pendingOverrideReason = null;

        const { error } = await db.from('stock_entries').insert([insertRow]);
        if (error) return alert('Save failed: ' + error.message);

        document.getElementById('confirm-modal').style.display = 'none';

        const formId = kind === 'issue' ? 'movement-form' : 'arrival-form';
        document.getElementById(formId).reset();
        const otherContainerId = kind === 'issue' ? 'other-item-container' : 'arrival-other-item-container';
        document.getElementById(otherContainerId).classList.add('hidden');
        this.setActiveToggle(formId, 'PPE');
        this.filterItemsByCategory(document.getElementById(kind === 'issue' ? 'item-select' : 'arrival-item-select'));
        if (kind === 'issue') this.refreshStockHint();

        await this.loadEntries();
        this.showHub();
    },

    // ============ EXCEL EXPORT ============
    async exportData() {
        await this.loadEntries();
        if (this.entries.length === 0) return alert('No data to export.');

        const sortedEntries = [...this.entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        // =========== TABLE 1: per-(department, item) running totals ===========
        const totalsByDeptItem = {};
        sortedEntries.forEach(e => {
            const deptKey = `${e.subsection}-${e.item}`;
            // Only `issued` (new stock going out) affects usable-stock running totals here.
            // Used stock returned on issue rows is audit/disposal and does not contribute.
            if (!e.employee) {
                totalsByDeptItem[deptKey] = (totalsByDeptItem[deptKey] || 0) + (e.received || 0);
            } else {
                totalsByDeptItem[deptKey] = (totalsByDeptItem[deptKey] || 0) - (e.issued || 0);
            }
        });

        let movementRows = '';
        sortedEntries.forEach(e => {
            const deptKey = `${e.subsection}-${e.item}`;
            const isIssue = !!e.employee;
            movementRows += `
                <tr>
                    <td>${e.subsection}</td>
                    <td>${new Date(e.created_at).toLocaleString()}</td>
                    <td>${e.item}</td>
                    <td>${e.type || ''}</td>
                    <td>${e.leader_name}</td>
                    <td>${e.employee || ''}</td>
                    <td style="text-align:right;">${isIssue ? (e.issued || 0) : (e.received || 0)}</td>
                    <td style="text-align:right;">${isIssue ? (e.received || 0) : 0}</td>
                    <td style="text-align:right;font-weight:bold;">${totalsByDeptItem[deptKey]}</td>
                    <td>${e.notes || ''}</td>
                </tr>`;
        });

        // =========== TABLE 2: per-SKU running totals ===========
        // Sums separately for each item across all departments:
        //   - Total Arrived (usable stock coming in)
        //   - Total Issued (new stock given out)
        //   - Total Old Stock Returned (audit/disposal — separate column)
        //   - Current Usable Stock = Total Arrived − Total Issued
        const skuStats = {};
        sortedEntries.forEach(e => {
            if (!skuStats[e.item]) {
                skuStats[e.item] = { arrived: 0, issued: 0, returned: 0 };
            }
            if (!e.employee) {
                // Arrival row
                skuStats[e.item].arrived += (e.received || 0);
            } else {
                // Issue row
                skuStats[e.item].issued += (e.issued || 0);
                skuStats[e.item].returned += (e.received || 0); // audit only
            }
        });

        const sortedSkuRows = Object.entries(skuStats).sort((a, b) => a[0].localeCompare(b[0]));
        let skuRows = '';
        sortedSkuRows.forEach(([item, s]) => {
            const usable = s.arrived - s.issued;
            const styleCol = usable >= 0 ? 'color:#22c55e' : 'color:#ef4444';
            skuRows += `
                <tr>
                    <td>${item}</td>
                    <td style="text-align:right;">${s.arrived}</td>
                    <td style="text-align:right;">${s.issued}</td>
                    <td style="text-align:right;font-weight:bold;${styleCol};">${usable}</td>
                    <td style="text-align:right;">${s.returned}</td>
                </tr>`;
        });

        const html = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; }
                    table { border-collapse: collapse; margin-bottom: 30px; }
                    thead tr { background-color: #f97316; color: white; }
                    th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; }
                    th { font-weight: bold; text-transform: uppercase; font-size: 12px; }
                    td { font-size: 12px; }
                    tr:nth-child(even) { background-color: #f8f8f8; }
                    .title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
                    .section { font-size: 16px; font-weight: bold; margin: 25px 0 8px 0; color: #0f172a; }
                </style>
            </head>
            <body>
                <div class="title">Stock Tracking Report — ${new Date().toLocaleDateString()}</div>

                <div class="section">1. Stock Movements (per case)</div>
                <table>
                    <thead><tr>
                        <th>Department</th><th>Date</th><th>Item</th><th>Type</th>
                        <th>Team Leader</th><th>Allocated To</th>
                        <th>Movement Qty</th><th>Old Stock Returned (audit/disposal)</th>
                        <th>Running Usable Total</th><th>Notes</th>
                    </tr></thead>
                    <tbody>${movementRows}</tbody>
                </table>

                <div class="section">2. Stock Levels by SKU</div>
                <table>
                    <thead><tr>
                        <th>Item</th>
                        <th>Total Arrived (new)</th>
                        <th>Total Issued (new)</th>
                        <th>Current Usable Stock</th>
                        <th>Total Old Stock Returned (audit/disposal)</th>
                    </tr></thead>
                    <tbody>${skuRows}</tbody>
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
