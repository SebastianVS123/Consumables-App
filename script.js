// Guard: if index.html accidentally includes this file twice, do not crash.
if (window.__STOCK_APP_JS__) {
    console.warn('script.js loaded twice — ignoring the second copy');
} else {
window.__STOCK_APP_JS__ = true;

// ============== SUPABASE CONFIG ==============
const SUPABASE_URL = 'https://okbscacqmsvmvmtewrlh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYnNjYWNxbXN2bXZtdGV3cmxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMzE3NjAsImV4cCI6MjEwMjgwNzc2MH0.uf30y8ce13VoIUTB1eyfurxellJa0sShsXeb335AnQI'; // <-- paste your eyJ... key here

// ============== ITEM CATALOG ==============
const DEFAULT_ITEM_CATALOG = [
    { value: 'Shirts',      label: 'Shirts',      category: 'PPE' },
    { value: 'Pants',       label: 'Pants',       category: 'PPE' },
    { value: 'Reflectors',  label: 'Reflectors',  category: 'PPE' },
    { value: 'Hard Hats',   label: 'Hard Hats',   category: 'PPE' },
    { value: 'Boots',       label: 'Boots',       category: 'PPE' },
    { value: 'Paint Suits', label: 'Paint Suits', category: 'PPE' },
    { value: 'Gloves',      label: 'Gloves',      category: 'CONSUMABLES' },
    { value: 'Markers',     label: 'Markers',     category: 'CONSUMABLES' },
    { value: 'Cloths',      label: 'Cloths',      category: 'CONSUMABLES' },
    { value: 'Other',       label: 'Other',       category: 'BOTH' }
];

let ITEM_CATALOG = DEFAULT_ITEM_CATALOG.slice();

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function populateItemDropdown(selectId, category) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const previousValue = sel.value;
    const filtered = ITEM_CATALOG.filter(i => i.category === category || i.category === 'BOTH');
    sel.innerHTML = filtered.map(i => `<option value="${escapeHtml(i.value)}">${escapeHtml(i.label)}</option>`).join('');
    if (filtered.some(i => i.value === previousValue)) sel.value = previousValue;
}

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
window.addEventListener('error', (event) => { showPageError('JS error: ' + event.message); });
window.addEventListener('unhandledrejection', (event) => { showPageError('Promise error: ' + (event.reason && event.reason.message ? event.reason.message : event.reason)); });

// ============== APP STATE ==============
const app = {
    currentUser: null,
    employees: [],
    entries: [],
    users: [],
    signatures: [],
    attendance: [],
    stockItems: [],
    _pendingSignatureFile: null,
    _submittingSignature: false,

    async init() {
        try {
            populateItemDropdown('item-select', 'PPE');
            populateItemDropdown('arrival-item-select', 'PPE');
        } catch (e) { console.error('init dropdown populate failed:', e); }

        if (!db) { showPageError('Supabase not initialized.'); return; }
        if (SUPABASE_ANON_KEY === '<USER_LEGACY_KEY>') {
            showPageError('Replace <USER_LEGACY_KEY> on line 4 with your actual eyJ... key.');
            return;
        }
        this.setupEventListeners();
        await this.loadStockItems();
        const session = sessionStorage.getItem('current_user');
        if (session) {
            try {
                this.currentUser = JSON.parse(session);
                if (this.currentUser.role === 'admin') this.renderAdminView();
                else this.showHub();
            } catch (e) { sessionStorage.removeItem('current_user'); }
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
            if (!username || !password) { self.showError('Please type both username and password.'); return; }
            try {
                self.showError('Checking...');
                document.getElementById('login-error').style.color = '#94a3b8';
                const { data, error } = await db.from('users').select('*').eq('username', username).eq('password', password).maybeSingle();
                self.hideError();
                if (!data) { self.showError('No user with that username/password exists.'); return; }
                if (error) { self.showError(error.message); return; }
                await self.login(data);
            } catch (err) { self.hideError(); self.showError('Connection error: ' + err.message); }
        };

        // ADMIN: Add Team Leader
        document.getElementById('add-leader-form').onsubmit = async function (e) {
            e.preventDefault();
            const username = document.getElementById('leader-username').value.trim().toLowerCase();
            const name = document.getElementById('leader-name').value;
            const pass = document.getElementById('leader-pass').value;
            const subsection = document.getElementById('leader-subsection').value;
            const { error } = await db.from('users').insert([{ username, name, password: pass, role: 'leader', subsection }]);
            if (error) { alert('Could not add user: ' + error.message); return; }
            alert(`Team leader created!\nLogin: ${username} / ${pass}`);
            e.target.reset();
            await self.loadUsers();
            self.renderAdminView();
        };

        // ADMIN: Add stock item
        const addItemForm = document.getElementById('add-stock-item-form');
        if (addItemForm) {
            addItemForm.onsubmit = async function (e) {
                e.preventDefault();
                await self.addStockItem();
            };
        }

        // PPE / CONSUMABLES toggle
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.onclick = () => {
                const formEl = btn.closest('form');
                formEl.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const activeType = btn.dataset.type;
                const itemSel = formEl.querySelector('select[id$="item-select"]');
                if (itemSel) populateItemDropdown(itemSel.id, activeType);
                self.refreshStockHint();
            };
        });

        // Item dropdowns - show/hide Other input
        document.getElementById('item-select').onchange = (e) => {
            document.getElementById('other-item-container').classList.toggle('hidden', e.target.value !== 'Other');
            self.refreshStockHint();
        };
        document.getElementById('arrival-item-select').onchange = (e) => {
            document.getElementById('arrival-other-item-container').classList.toggle('hidden', e.target.value !== 'Other');
        };

        // Add Employee form (issue page only)
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
                const { error } = await db.from('employees').insert([{ name, subsection: self.currentUser.subsection, leader_id: self.currentUser.id }]);
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

        // Live-update stock hint
        ['amount-issued', 'amount-received'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => self.refreshStockHint());
        });

        // Issue + Arrival forms
        document.getElementById('movement-form').onsubmit = function (e) { e.preventDefault(); self.showConfirmModal('issue'); };
        document.getElementById('arrival-form').onsubmit = function (e) { e.preventDefault(); self.showConfirmModal('arrival'); };

        // Confirmation modal
        document.getElementById('btn-cancel').onclick = () => {
            document.getElementById('confirm-modal').style.display = 'none';
            self._forceSubmitOnWarning = false;
            self._pendingOverrideReason = null;
        };
        document.getElementById('btn-confirm').onclick = () => self.submitMovement();

        // Over-usable-stock warning
        document.getElementById('btn-warn-cancel').onclick = () => { document.getElementById('warning-modal').style.display = 'none'; };
        document.getElementById('btn-warn-force').onclick = () => {
            document.getElementById('warning-modal').style.display = 'none';
            self._forceSubmitOnWarning = true;
            self.submitMovement();
        };

        // Audit warning (issued > received for consumables)
        document.getElementById('btn-audit-cancel').onclick = () => {
            document.getElementById('audit-warning-modal').style.display = 'none';
            self._pendingOverrideReason = null;
        };
        document.getElementById('btn-audit-continue').onclick = () => {
            document.getElementById('audit-warning-modal').style.display = 'none';
            document.getElementById('override-reason').value = '';
            document.getElementById('override-modal').style.display = 'flex';
        };

        // Override reason
        document.getElementById('btn-override-cancel').onclick = () => {
            document.getElementById('override-modal').style.display = 'none';
            self._pendingOverrideReason = null;
        };
        document.getElementById('btn-override-submit').onclick = () => {
            const reason = document.getElementById('override-reason').value.trim();
            if (!reason) { alert('A reason is required when overriding the audit rule.'); return; }
            document.getElementById('override-modal').style.display = 'none';
            self._pendingOverrideReason = reason;
            self._forceSubmitOnWarning = true;
            self.showConfirmModal(self._currentSubmitKind || 'issue');
        };

        // Clear-data two-step verification
        document.getElementById('btn-clear-cancel-1').onclick = () => { document.getElementById('clear-warning-modal').style.display = 'none'; };
        document.getElementById('btn-clear-continue').onclick = () => {
            document.getElementById('clear-warning-modal').style.display = 'none';
            const input = document.getElementById('clear-typed-confirmation');
            input.value = '';
            document.getElementById('btn-clear-execute').disabled = true;
            document.getElementById('clear-confirm-modal').style.display = 'flex';
            setTimeout(() => input.focus(), 100);
        };
        document.getElementById('btn-clear-cancel-2').onclick = () => { document.getElementById('clear-confirm-modal').style.display = 'none'; };
        document.getElementById('clear-typed-confirmation').oninput = (e) => {
            document.getElementById('btn-clear-execute').disabled = e.target.value !== 'CLEAR';
        };
        document.getElementById('btn-clear-execute').onclick = () => self.executeClearData();

        // Signature file input preview — save the file immediately so Submit always has it
        const sigInput = document.getElementById('signature-file-input');
        if (sigInput) {
            sigInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                self._pendingSignatureFile = file;
                const btn = document.getElementById('btn-submit-signature');
                if (btn) btn.disabled = false;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    document.getElementById('signature-preview-container').innerHTML =
                        `<img src="${ev.target.result}" alt="Preview" style="max-width: 100%; max-height: 60vh; border-radius: 0.375rem;">`;
                };
                reader.onerror = () => {
                    document.getElementById('signature-preview-container').innerHTML =
                        `<p style="color: var(--success-color);">Photo selected: ${escapeHtml(file.name)}. Tap Submit to upload.</p>`;
                };
                reader.readAsDataURL(file);
            });
        }

        // Gallery filter
        const sigSearch = document.getElementById('signature-search');
        if (sigSearch) {
            sigSearch.addEventListener('input', () => self.renderSignaturesGallery());
        }

        // Attendance row buttons (event delegation — safe with any employee name)
        const attList = document.getElementById('attendance-list');
        if (attList) {
            attList.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-att-status]');
                if (!btn) return;
                const name = btn.getAttribute('data-emp-name');
                const status = btn.getAttribute('data-att-status');
                if (name && status) self.markAttendance(name, status);
            });
        }
    },

    // ============ VIEW SWITCHING ============
    hideAllViews() {
        ['login-view', 'admin-view', 'hub-view', 'leader-view', 'arrival-view', 'signature-view', 'signatures-gallery-view', 'attendance-view', 'stock-items-view', 'stocktake-view'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    },

    async showHub() {
        if (!this.currentUser) return;
        if (this._needsIssuePhoto) {
            this.blockLeaveIssue('Please upload the signed issue list photo before returning to Hub.');
            return;
        }
        this.hideAllViews();
        document.getElementById('hub-view').classList.remove('hidden');
        document.getElementById('hub-title').textContent = `${this.currentUser.subsection} SUBSECTION`;
        document.getElementById('hub-leader-name').textContent = this.currentUser.name;
        await this.loadEmployees();
        await this.loadEntries();
    },

    tryLeaveIssuePage() {
        if (this._needsIssuePhoto) {
            this.blockLeaveIssue('You cannot leave Issue Stock until you upload a photo of the signed issue list.');
            return;
        }
        this.showHub();
    },

    tryLogout() {
        if (this._needsIssuePhoto) {
            this.blockLeaveIssue('Upload the signed issue list photo before signing out.');
            return;
        }
        this.logout();
    },

    blockLeaveIssue(msg) {
        alert(msg);
        const issueView = document.getElementById('leader-view');
        const onIssuePage = issueView && !issueView.classList.contains('hidden');
        if (!onIssuePage) {
            this.hideAllViews();
            document.getElementById('leader-view').classList.remove('hidden');
        }
        this.updateIssuePhotoBanner();
        const card = document.getElementById('issue-signature-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    updateIssuePhotoBanner() {
        const banner = document.getElementById('issue-photo-banner');
        const status = document.getElementById('issue-photo-status');
        if (banner) banner.classList.toggle('hidden', !this._needsIssuePhoto);
        if (status) {
            status.textContent = this._needsIssuePhoto
                ? 'Photo still required. Issue to everyone, then upload the signed list.'
                : 'No signed list required right now. After you issue stock, a photo will be required before you can leave.';
            status.style.color = this._needsIssuePhoto ? '#fecaca' : '';
        }
    },

    // ============ SIGNATURE UPLOAD (team leader flow) ============
    openSignatureUpload(purpose) {
        this._signaturePurpose = purpose === 'issue' ? 'issue' : 'arrival';
        this._signatureReturnTo = this._signaturePurpose === 'issue' ? 'issue' : 'hub';
        this.hideAllViews();
        document.getElementById('signature-view').classList.remove('hidden');
        const isIssue = this._signaturePurpose === 'issue';
        document.getElementById('signature-title').textContent = isIssue
            ? `${this.currentUser.subsection} — Signed Issue List`
            : `${this.currentUser.subsection} — Arrival Receipt`;
        document.getElementById('signature-leader-name').textContent = this.currentUser.name;
        const backBtn = document.getElementById('signature-back-btn');
        if (backBtn) backBtn.textContent = isIssue ? '← ISSUE' : '← HUB';
        const notes = document.getElementById('signature-notes');
        notes.value = '';
        notes.placeholder = isIssue
            ? 'e.g. Morning shift, signed by 5 employees'
            : 'e.g. Supplier delivery note, waybill 123, 20 gloves received';
        document.getElementById('signature-preview-container').innerHTML =
            `<p style="color: var(--text-secondary);">No photo selected yet.</p>`;
        document.getElementById('btn-submit-signature').disabled = true;
        document.getElementById('btn-submit-signature').textContent = isIssue ? '📤 SUBMIT SIGNED LIST' : '📤 SUBMIT RECEIPT';
        this._pendingSignatureFile = null;
        this._submittingSignature = false;
        const input = document.getElementById('signature-file-input');
        input.value = '';
        setTimeout(() => input.click(), 150);
    },

    cancelSignatureUpload() {
        this._pendingSignatureFile = null;
        this._submittingSignature = false;
        document.getElementById('signature-file-input').value = '';
        if (this._signatureReturnTo === 'issue') this.showIssuePage();
        else this.showHub();
    },

    async prepareImageFile(file) {
        try {
            const dataUrl = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = rej;
                r.readAsDataURL(file);
            });
            const img = await new Promise((res, rej) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = rej;
                i.src = dataUrl;
            });
            const maxW = 1600;
            let w = img.width, h = img.height;
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
            if (!blob) return file;
            const base = (file.name || 'signature').replace(/\.[^.]+$/, '') || 'signature';
            return new File([blob], base + '.jpg', { type: 'image/jpeg' });
        } catch (e) {
            return file;
        }
    },

    async submitSignature() {
        if (this._submittingSignature) return;
        const file = this._pendingSignatureFile;
        if (!file) {
            alert('Choose a photo first.');
            document.getElementById('signature-file-input').click();
            return;
        }

        const btn = document.getElementById('btn-submit-signature');
        this._submittingSignature = true;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Uploading…';

        try {
            const ready = await this.prepareImageFile(file);
            const ext = (ready.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
            const safeUser = String(this.currentUser.username || 'leader').replace(/[^a-z0-9_-]/gi, '_');
            const safeSub = String(this.currentUser.subsection || 'dept').replace(/[^a-z0-9_-]/gi, '_');
            const path = `${safeSub}/${safeUser}-${Date.now()}.${ext}`;

            const { error: upErr } = await db.storage
                .from('signatures')
                .upload(path, ready, { upsert: false, contentType: ready.type || 'image/jpeg' });
            if (upErr) throw upErr;

            const { data: urlData } = db.storage.from('signatures').getPublicUrl(path);
            if (!urlData || !urlData.publicUrl) throw new Error('Failed to get public URL.');

            const typedNotes = document.getElementById('signature-notes').value.trim();
            const typeTag = this._signaturePurpose === 'issue' ? '[ISSUE LIST]' : '[ARRIVAL RECEIPT]';
            const meta = {
                leader_id: this.currentUser.id || null,
                leader_name: this.currentUser.name,
                subsection: this.currentUser.subsection,
                notes: typedNotes ? `${typeTag} ${typedNotes}` : typeTag,
                storage_path: path,
                public_url: urlData.publicUrl,
                leader_username: this.currentUser.username
            };

            let { error: metaErr } = await db.from('employee_signatures').insert([meta]);
            if (metaErr && /leader_username/i.test(metaErr.message || '')) {
                delete meta.leader_username;
                ({ error: metaErr } = await db.from('employee_signatures').insert([meta]));
            }
            if (metaErr) throw metaErr;

            if (this._signaturePurpose === 'issue') {
                this._needsIssuePhoto = false;
                this.updateIssuePhotoBanner();
                alert('Signed issue list uploaded. You can issue to more people, or return to Hub.');
            } else {
                alert('Arrival receipt uploaded successfully.');
            }
            this.cancelSignatureUpload();
        } catch (err) {
            alert('Upload failed: ' + (err.message || err));
            btn.disabled = false;
            btn.textContent = original;
            this._submittingSignature = false;
        }
    },

    // ============ SIGNATURE GALLERY (admin flow) ============
    showSafeSignaturesGallery() {
        return this.showSignaturesGallery();
    },

    async showSignaturesGallery() {
        this.hideAllViews();
        document.getElementById('signatures-gallery-view').classList.remove('hidden');
        const searchEl = document.getElementById('signature-search');
        if (searchEl) searchEl.value = '';
        await this.loadSignatures();
        this.renderSignaturesGallery();
    },

    async loadSignatures() {
        try {
            const { data, error } = await db.from('employee_signatures').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            this.signatures = data || [];
        } catch (e) {
            console.error('loadSignatures', e);
            this.signatures = [];
        }
    },

    renderSignaturesGallery() {
        const container = document.getElementById('signatures-gallery');
        const counter = document.getElementById('signature-count');
        const filterEl = document.getElementById('signature-search');
        const filter = (filterEl && filterEl.value ? filterEl.value : '').toLowerCase().trim();
        if (counter) counter.textContent = `(${this.signatures.length} total)`;

        const filtered = this.signatures.filter(s => {
            if (!filter) return true;
            return (s.leader_name || '').toLowerCase().includes(filter)
                || (s.leader_username || '').toLowerCase().includes(filter)
                || (s.subsection || '').toLowerCase().includes(filter)
                || (s.notes || '').toLowerCase().includes(filter);
        });

        if (filtered.length === 0) {
            container.innerHTML = `<p style="color: var(--text-secondary); grid-column: 1 / -1; padding:1rem 0;">${this.signatures.length === 0 ? 'No signatures uploaded yet.' : 'No results match that filter.'}</p>`;
            return;
        }

        container.innerHTML = filtered.map(s => {
            const urlEsc = String(s.public_url).replace(/'/g, "\\'");
            const dateStr = new Date(s.created_at).toLocaleString();
            const safeNotes = String(s.notes || '').replace(/[<>]/g, '');
            const safeLeader = String(s.leader_name || 'Unknown').replace(/[<>]/g, '');
            const safeSubsection = String(s.subsection || '').replace(/[<>]/g, '');
            return `
                <div class="card" style="padding:0; overflow:hidden;">
                    <button type="button"
                            onclick="document.getElementById('signature-full-image').src='${urlEsc}'; document.getElementById('signature-image-modal').style.display='flex';"
                            style="background:none;border:none;padding:0;cursor:pointer;width:100%;">
                        <img src="${urlEsc}" loading="lazy" style="width:100%; height: 180px; object-fit:cover; display:block;">
                    </button>
                    <div style="padding: 0.75rem;">
                        <div style="font-weight:600;">${safeLeader}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">${safeSubsection} · ${dateStr}</div>
                        ${safeNotes ? `<div style="font-size: 0.75rem; margin-top: 0.25rem;">${safeNotes}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    // ============ ATTENDANCE ============
    getTodayString() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    async loadAttendance() {
        const today = this.getTodayString();
        const { data, error } = await db
            .from('attendance')
            .select('*')
            .eq('leader_username', this.currentUser.username)
            .eq('log_date', today);
        if (error) {
            alert('Could not load attendance: ' + error.message + '\n\nIf the attendance table is missing, run the Attendance SQL in Supabase first.');
            this.attendance = [];
            return;
        }
        this.attendance = data || [];
    },

    async showAttendancePage() {
        this.hideAllViews();
        document.getElementById('attendance-view').classList.remove('hidden');
        document.getElementById('attendance-title').textContent = `${this.currentUser.subsection} — Attendance`;
        document.getElementById('attendance-leader-name').textContent = this.currentUser.name;
        document.getElementById('attendance-date').textContent = '· ' + new Date().toLocaleDateString();
        await this.loadEmployees();
        await this.loadAttendance();
        this.renderAttendancePage();
    },

    renderAttendancePage() {
        const container = document.getElementById('attendance-list');
        const employees = this.employees.filter(e => e.subsection === this.currentUser.subsection);
        const byName = {};
        this.attendance.forEach(a => { byName[a.employee_name] = a.status; });
        const marked = employees.filter(e => byName[e.name]).length;
        document.getElementById('attendance-marked-count').textContent = `(${marked}/${employees.length} marked)`;

        if (employees.length === 0) {
            container.innerHTML = `<p style="color: var(--text-secondary); padding: 1rem 0;">No employees added yet. Go to Issue Stock and add the people on your shift first.</p>`;
            return;
        }

        const statusLabel = (s) => {
            if (s === 'on_time') return 'On Time';
            if (s === 'late') return 'Late';
            if (s === 'absent') return 'Absent';
            return 'Not marked yet';
        };

        container.innerHTML = employees.map(emp => {
            const status = byName[emp.name] || '';
            const nameAttr = escapeHtml(emp.name);
            return `
                <div class="attendance-row">
                    <div>
                        <strong>${nameAttr}</strong>
                        <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.2rem;">
                            ${status ? 'Marked: ' + statusLabel(status) : 'Not marked yet'}
                        </div>
                    </div>
                    <div class="attendance-actions">
                        <button type="button" data-emp-name="${nameAttr}" data-att-status="on_time" class="${status === 'on_time' ? 'att-active ontime' : 'secondary'}">On Time</button>
                        <button type="button" data-emp-name="${nameAttr}" data-att-status="late" class="${status === 'late' ? 'att-active late' : 'secondary'}">Late</button>
                        <button type="button" data-emp-name="${nameAttr}" data-att-status="absent" class="${status === 'absent' ? 'att-active absent' : 'secondary'}">Absent</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async markAttendance(employeeName, status) {
        const today = this.getTodayString();
        const payload = {
            employee_name: employeeName,
            subsection: this.currentUser.subsection,
            leader_username: this.currentUser.username,
            status,
            log_date: today,
            marked_at: new Date().toISOString()
        };
        const { error } = await db.from('attendance').upsert(payload, { onConflict: 'leader_username,employee_name,log_date' });
        if (error) return alert('Could not save attendance: ' + error.message);
        await this.loadAttendance();
        this.renderAttendancePage();
    },

    async markAllAttendance(status) {
        const employees = this.employees.filter(e => e.subsection === this.currentUser.subsection);
        if (employees.length === 0) return alert('No employees to mark.');
        if (!confirm(`Mark all ${employees.length} operators as On Time?`)) return;
        for (const emp of employees) {
            const { error } = await db.from('attendance').upsert({
                employee_name: emp.name,
                subsection: this.currentUser.subsection,
                leader_username: this.currentUser.username,
                status,
                log_date: this.getTodayString(),
                marked_at: new Date().toISOString()
            }, { onConflict: 'leader_username,employee_name,log_date' });
            if (error) return alert('Could not save attendance: ' + error.message);
        }
        await this.loadAttendance();
        this.renderAttendancePage();
    },

    exportAttendance() {
        const employees = this.employees.filter(e => e.subsection === this.currentUser.subsection);
        const byName = {};
        this.attendance.forEach(a => { byName[a.employee_name] = a.status; });
        const statusLabel = (s) => s === 'on_time' ? 'On Time' : s === 'late' ? 'Late' : s === 'absent' ? 'Absent' : 'Not marked';
        const today = this.getTodayString();
        let csv = 'Date,Department,Team Leader,Employee,Status\n';
        employees.forEach(emp => {
            csv += `"${today}","${this.currentUser.subsection}","${this.currentUser.name}","${emp.name}","${statusLabel(byName[emp.name])}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Attendance_${this.currentUser.subsection}_${today}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // ============ STOCK ITEMS (admin custom dropdowns) ============
    async loadStockItems() {
        try {
            const { data, error } = await db.from('stock_items').select('*').order('sort_order', { ascending: true });
            if (error) throw error;
            if (!data || data.length === 0) {
                await this.seedDefaultStockItems();
                return;
            }
            this.stockItems = data;
            ITEM_CATALOG = data.map(i => ({ value: i.name, label: i.name, category: i.category, id: i.id }));
            if (!ITEM_CATALOG.some(i => i.value === 'Other')) {
                ITEM_CATALOG.push({ value: 'Other', label: 'Other', category: 'BOTH' });
            }
        } catch (e) {
            console.warn('stock_items table not ready, using default catalog.', e);
            ITEM_CATALOG = DEFAULT_ITEM_CATALOG.slice();
            this.stockItems = [];
        }
    },

    async seedDefaultStockItems() {
        const rows = DEFAULT_ITEM_CATALOG.map((i, idx) => ({
            name: i.value,
            category: i.category,
            sort_order: idx + 1
        }));
        const { error } = await db.from('stock_items').insert(rows);
        if (error && !/duplicate/i.test(error.message || '')) {
            console.warn('Could not seed stock items:', error.message);
        }
        const { data } = await db.from('stock_items').select('*').order('sort_order', { ascending: true });
        this.stockItems = data || [];
        if (this.stockItems.length) {
            ITEM_CATALOG = this.stockItems.map(i => ({ value: i.name, label: i.name, category: i.category, id: i.id }));
        }
    },

    async showStockItemsPage() {
        this.hideAllViews();
        document.getElementById('stock-items-view').classList.remove('hidden');
        await this.loadStockItems();
        this.renderStockItemsTable();
    },

    renderStockItemsTable() {
        const tbody = document.querySelector('#stock-items-table tbody');
        if (!tbody) return;
        const items = this.stockItems.length
            ? this.stockItems
            : ITEM_CATALOG.map(i => ({ name: i.value, category: i.category, id: i.id || null }));
        tbody.innerHTML = items.map(i => {
            const isOther = i.name === 'Other';
            const idAttr = i.id ? String(i.id) : '';
            return `<tr>
                <td>${escapeHtml(i.name)}</td>
                <td>${escapeHtml(i.category)}</td>
                <td>${isOther ? '<span style="color:var(--text-secondary);font-size:0.75rem;">Locked</span>' : `<button type="button" class="secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;width:auto;" onclick="app.deleteStockItem('${idAttr}', ${JSON.stringify(i.name)})">Delete</button>`}</td>
            </tr>`;
        }).join('');
    },

    async addStockItem() {
        const name = document.getElementById('new-item-name').value.trim();
        const category = document.getElementById('new-item-category').value;
        if (!name) return alert('Type an item name.');
        if (ITEM_CATALOG.some(i => i.value.toLowerCase() === name.toLowerCase())) {
            return alert('That item already exists.');
        }
        const sort_order = (this.stockItems.length || ITEM_CATALOG.length) + 1;
        const { error } = await db.from('stock_items').insert([{ name, category, sort_order }]);
        if (error) {
            alert('Could not add item: ' + error.message + '\n\nIf the stock_items table is missing, run the SQL in the instructions first.');
            return;
        }
        document.getElementById('new-item-name').value = '';
        await this.loadStockItems();
        this.renderStockItemsTable();
        alert('Item added. Team leaders will see it in the dropdowns.');
    },

    async deleteStockItem(id, name) {
        if (name === 'Other') return alert('The Other option cannot be deleted.');
        if (!confirm(`Remove "${name}" from the dropdown list?\n\nPast stock records for this item are kept.`)) return;
        let query = db.from('stock_items').delete();
        if (id) query = query.eq('id', id);
        else query = query.eq('name', name);
        const { error } = await query;
        if (error) return alert('Could not delete: ' + error.message);
        await this.loadStockItems();
        this.renderStockItemsTable();
    },

    // ============ STOCKTAKE (admin) ============
    async showStocktakePage() {
        this.hideAllViews();
        document.getElementById('stocktake-view').classList.remove('hidden');
        await this.loadStockItems();
        await this.loadEntries();
        this.renderStocktakeTable();
    },

    renderStocktakeTable() {
        const tbody = document.querySelector('#stocktake-table tbody');
        if (!tbody) return;
        const items = ITEM_CATALOG.filter(i => i.value !== 'Other');
        tbody.innerHTML = items.map((i, idx) => {
            const current = this.computeUsableStock(i.value);
            const colour = current >= 0 ? '#22c55e' : '#ef4444';
            return `<tr>
                <td>${escapeHtml(i.label)}</td>
                <td>${escapeHtml(i.category)}</td>
                <td style="font-weight:700;color:${colour};">${current}</td>
                <td><input type="number" min="0" class="stocktake-count-input" data-item="${escapeHtml(i.value)}" data-category="${escapeHtml(i.category)}" data-current="${current}" value="${current}"></td>
            </tr>`;
        }).join('');
    },

    async submitStocktake() {
        const inputs = document.querySelectorAll('#stocktake-table .stocktake-count-input');
        const notes = (document.getElementById('stocktake-notes').value || '').trim();
        const adjustments = [];
        inputs.forEach(input => {
            const countedRaw = input.value;
            if (countedRaw === '' || countedRaw === null) return;
            const counted = parseInt(countedRaw, 10);
            if (Number.isNaN(counted) || counted < 0) return;
            const current = parseInt(input.dataset.current, 10) || 0;
            const diff = counted - current;
            if (diff === 0) return;
            const category = input.dataset.category === 'BOTH' ? 'PPE' : input.dataset.category;
            adjustments.push({
                item: input.dataset.item,
                type: category,
                counted,
                current,
                diff
            });
        });

        if (adjustments.length === 0) return alert('No changes to save. Counted quantities match current usable stock.');

        const summary = adjustments.map(a =>
            `${a.item}: ${a.current} → ${a.counted} (${a.diff > 0 ? '+' : ''}${a.diff})`
        ).join('\n');
        if (!confirm(`Save stocktake for ${adjustments.length} item(s)?\n\n${summary}`)) return;

        const btn = document.getElementById('btn-submit-stocktake');
        btn.disabled = true;
        btn.textContent = 'Saving…';

        try {
            const rows = adjustments.map(a => ({
                subsection: 'Admin',
                leader_id: this.currentUser.id || null,
                leader_name: this.currentUser.name,
                type: a.type,
                item: a.item,
                employee: null,
                issued: a.diff < 0 ? Math.abs(a.diff) : 0,
                received: a.diff > 0 ? a.diff : 0,
                notes: `[STOCKTAKE] Counted ${a.counted} (was ${a.current})` + (notes ? ' | ' + notes : '')
            }));
            const { error } = await db.from('stock_entries').insert(rows);
            if (error) throw error;
            await this.loadEntries();
            this.renderStocktakeTable();
            document.getElementById('stocktake-notes').value = '';
            alert('Stocktake saved. Usable stock now matches the counted quantities.');
        } catch (err) {
            alert('Stocktake failed: ' + (err.message || err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'SAVE STOCKTAKE';
        }
    },

    // ============ EXISTING VIEWS (issue / arrival / stock helpers) ============
    async showIssuePage() {
        this.hideAllViews();
        document.getElementById('leader-view').classList.remove('hidden');
        document.getElementById('view-title').textContent = `${this.currentUser.subsection} — ISSUE STOCK`;
        document.getElementById('leader-display-name').textContent = this.currentUser.name;
        await this.loadStockItems();
        await this.loadEmployees();
        await this.loadEntries();
        this.renderSidePanels();
        this.setActiveToggle('movement-form', 'PPE');
        populateItemDropdown('item-select', 'PPE');
        this.refreshStockHint();
        this.updateIssuePhotoBanner();
        const saveStatus = document.getElementById('issue-save-status');
        if (saveStatus && !this._needsIssuePhoto) saveStatus.textContent = '';
    },

    async showArrivalPage() {
        this.hideAllViews();
        document.getElementById('arrival-view').classList.remove('hidden');
        document.getElementById('arrival-title').textContent = `${this.currentUser.subsection} — ARRIVING STOCK`;
        document.getElementById('arrival-display-name').textContent = this.currentUser.name;
        await this.loadStockItems();
        await this.loadEntries();
        this.setActiveToggle('arrival-form', 'PPE');
        populateItemDropdown('arrival-item-select', 'PPE');
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
            await this.loadStockItems();
            await this.loadEmployees();
            await this.loadEntries();
            if (user.role === 'admin') { await this.loadUsers(); this.renderAdminView(); }
            else { this.showHub(); }
        } catch (err) { showPageError('Login failed: ' + err.message); }
    },

    async logout() {
        this.currentUser = null;
        sessionStorage.removeItem('current_user');
        this.hideAllViews();
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('login-form').reset();
    },

    // ============ DATA LOADERS ============
    async loadUsers() { const { data } = await db.from('users').select('*').eq('role', 'leader').order('created_at', { ascending: true }); this.users = data || []; },
    async loadEmployees() { const { data } = await db.from('employees').select('*'); this.employees = data || []; },
    async loadEntries() { const { data } = await db.from('stock_entries').select('*'); this.entries = data || []; },

    async deleteUser(username) {
        if (!confirm('Delete this team leader?')) return;
        await db.from('users').delete().eq('username', username);
        await this.loadUsers();
        this.renderAdminView();
    },

    renderAdminView() {
        this.hideAllViews();
        document.getElementById('admin-view').classList.remove('hidden');
        const tbody = document.querySelector('#leaders-table tbody');
        tbody.innerHTML = '';
        (this.users || []).forEach(u => {
            const uname = String(u.username).replace(/'/g, "\\'");
            tbody.innerHTML += `<tr><td>${u.name}</td><td>${u.subsection}</td><td><button onclick="app.deleteUser('${uname}')" class="secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;">Delete</button></td></tr>`;
        });
    },

    renderSidePanels() {
        if (!this.currentUser) return;
        const subEmployees = this.employees.filter(e => e.subsection === this.currentUser.subsection);
        const empOptsHtml = subEmployees.length
            ? subEmployees.map(e => `<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join('')
            : '<option value="">No employees added yet</option>';
        const sel = document.getElementById('allocate-employee');
        if (sel) sel.innerHTML = empOptsHtml;

        const empListHtml = subEmployees.length
            ? subEmployees.map(e => `<li style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span>• ${escapeHtml(e.name)}</span><button class="remove-emp secondary" data-id="${e.id}" style="width:auto;padding:0.15rem 0.5rem;font-size:0.7rem;">Remove</button></li>`).join('')
            : '<li>No employees added yet.</li>';
        const ul = document.getElementById('employee-list');
        if (ul) ul.innerHTML = empListHtml;

        const subEntries = this.entries.filter(e => e.subsection === this.currentUser.subsection).slice(-5).reverse();
        const recentHtml = subEntries.length
            ? subEntries.map(e => {
                const isIssue = !!e.employee;
                const parts = [];
                if (e.issued > 0) parts.push(`<span style="color:#f97316;">📤 issued -${e.issued}</span>`);
                if (e.received > 0) parts.push(isIssue ? `<span style="color:#94a3b8;">🗑 disposed +${e.received}</span>` : `<span style="color:#22c55e;">📦 arrived +${e.received}</span>`);
                const action = parts.length ? parts.join(' · ') : '<span style="color:#94a3b8;">—</span>';
                return `<div style="border-bottom:1px solid var(--border-color);padding:0.5rem 0;"><div style="display:flex;justify-content:space-between;font-weight:600;"><span>${escapeHtml(e.item)} ${e.employee ? '→ ' + escapeHtml(e.employee) : ''}</span>${action}</div><div style="font-size:0.75rem;color:#94a3b8;">${(e.type || '').toLowerCase()} · ${new Date(e.created_at).toLocaleString()}</div></div>`;
            }).join('')
            : 'No entries yet.';
        const recentEl = document.getElementById('recent-entries');
        if (recentEl) recentEl.innerHTML = recentHtml;
    },

    computeUsableStock(itemName) {
        let received = 0, issued = 0;
        for (const e of this.entries) {
            if (e.item !== itemName) continue;
            if (e.employee) {
                issued += (e.issued || 0);
            } else {
                received += (e.received || 0);
                issued += (e.issued || 0);
            }
        }
        return received - issued;
    },

    refreshStockHint() {
        const hintEl = document.getElementById('stock-hint');
        if (!hintEl) return;
        const itemSel = document.getElementById('item-select');
        if (!itemSel || itemSel.value === 'Other') { hintEl.innerHTML = '&nbsp;'; return; }
        const item = itemSel.value;
        const stock = this.computeUsableStock(item);
        const issued = parseInt((document.getElementById('amount-issued')?.value || '0'));
        const projected = stock - issued;
        const colour = stock >= 0 ? '#22c55e' : '#ef4444';
        const pColour = projected >= 0 ? '#22c55e' : '#ef4444';
        hintEl.innerHTML = `Current usable stock: <strong style="color:${colour}">${stock}</strong>` + (issued > 0 ? ` · After this issue: <strong style="color:${pColour}">${projected}</strong>` : '');
    },

    // ============ FORM SUBMISSIONS ============
    showConfirmModal(kind) {
        const data = this._getFormData(kind);
        if (!data) return;
        if (kind === 'issue') {
            if (!data.employee) return alert('Please select an employee.');
            const issuing = data.issued || 0, receiving = data.received || 0;
            if (issuing <= 0 && receiving <= 0) return alert('Enter an amount in either "Amount Issued" or "Old Stock Returned".');
            this._currentSubmitKind = 'issue';

            if (data.type === 'CONSUMABLES' && issuing > receiving && !this._forceSubmitOnWarning) {
                document.getElementById('audit-warning-details').innerHTML = `<strong>Are you sure?</strong> Currently amount issued (<strong>${issuing}</strong>) exceeds amount received from employee (<strong>${receiving}</strong>) for <strong>${data.item}</strong>.<br><br><em>This is against the rules. Every issue should match a return.</em>`;
                document.getElementById('audit-warning-modal').style.display = 'flex';
                return;
            }
            if (data.type === 'CONSUMABLES' && issuing > 0) {
                const liveStock = this.computeUsableStock(data.item);
                if (issuing > Math.max(0, liveStock)) {
                    const projectedAfter = liveStock - issuing;
                    document.getElementById('warning-details').innerHTML = `You are issuing <strong>${issuing}</strong> of <strong>${data.item}</strong>.<br><br>Current usable stock across all departments: <strong>${Math.max(0, liveStock)}</strong>.<br><br>Continuing will leave usable stock at <strong style="color:#ef4444;">${projectedAfter}</strong>.${receiving > 0 ? '<br><br><em>(Old stock being returned is logged but does not re-enter inventory.)</em>' : ''}`;
                    document.getElementById('warning-modal').style.display = 'flex';
                    return;
                }
            }
            const overrideLine = this._pendingOverrideReason ? `<div style="margin-top:0.5rem;padding:0.5rem;background:rgba(239,68,68,0.1);border-left:3px solid #ef4444;font-size:0.85rem;"><strong>OVERRIDE REASON:</strong> ${this._pendingOverrideReason}</div>` : '';
            document.getElementById('confirm-details').innerHTML = `Type: ${data.type}<br>Item: ${data.item}<br>Employee: ${data.employee}<br>Amount Issued: ${issuing}<br>Old Stock Returned (audit / disposed): ${receiving}<br><span style="font-size:0.75rem;color:var(--text-secondary);">Note: returned old stock is logged only for audit and does NOT re-enter usable inventory.</span><br>Notes: ${data.notes || '(none)'}${overrideLine}`;
        } else if (kind === 'arrival') {
            if (!data.amount || data.amount <= 0) return alert('Please enter an amount greater than 0.');
            document.getElementById('confirm-details').innerHTML = `Type: ${data.type}<br>Item: ${data.item}<br>Amount Received: ${data.amount}<br>Notes: ${data.notes || '(none)'}`;
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
        return { type, item, employee: empSel ? empSel.value : '', issued, received, amount, notes: (notesInput.value || '').trim() };
    },

    async submitMovement() {
        const kind = document.getElementById('confirm-modal').dataset.kind;
        const data = this._getFormData(kind);
        if (!data) return;
        let finalNotes = data.notes || '';
        if (this._pendingOverrideReason) finalNotes = `[OVERRIDE: ${this._pendingOverrideReason}]${finalNotes ? ' | ' + finalNotes : ''}`;
        const insertRow = {
            subsection: this.currentUser.subsection,
            leader_id: this.currentUser.id || null,
            leader_name: this.currentUser.name,
            type: data.type, item: data.item,
            employee: data.employee || null,
            issued: kind === 'issue' ? (data.issued || 0) : 0,
            received: kind === 'issue' ? (data.received || 0) : (data.amount || 0),
            notes: finalNotes
        };
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
        populateItemDropdown(kind === 'issue' ? 'item-select' : 'arrival-item-select', 'PPE');
        await this.loadEntries();
        if (kind === 'issue') {
            this._needsIssuePhoto = true;
            this.refreshStockHint();
            this.renderSidePanels();
            this.updateIssuePhotoBanner();
            const saveStatus = document.getElementById('issue-save-status');
            if (saveStatus) {
                saveStatus.textContent = `Saved for ${data.employee}. Issue the next person, then upload the signed list before you leave.`;
            }
            return;
        }
        this.showHub();
    },

    // ============ EXCEL EXPORT ============
    async exportData() {
        await this.loadEntries();
        if (this.entries.length === 0) return alert('No data to export.');
        const sortedEntries = [...this.entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const totalsByDeptItem = {};
        sortedEntries.forEach(e => {
            const deptKey = `${e.subsection}-${e.item}`;
            if (!e.employee) {
                totalsByDeptItem[deptKey] = (totalsByDeptItem[deptKey] || 0) + (e.received || 0) - (e.issued || 0);
            } else {
                totalsByDeptItem[deptKey] = (totalsByDeptItem[deptKey] || 0) - (e.issued || 0);
            }
        });
        let movementRows = '';
        sortedEntries.forEach(e => {
            const deptKey = `${e.subsection}-${e.item}`;
            const isIssue = !!e.employee;
            const isStocktake = !isIssue && (e.issued || 0) > 0;
            const movementQty = isIssue ? (e.issued || 0) : (isStocktake ? -(e.issued || 0) : (e.received || 0));
            const allocated = isIssue ? (e.employee || '') : ((e.notes || '').indexOf('[STOCKTAKE]') === 0 ? 'STOCKTAKE' : '');
            movementRows += `<tr><td>${e.subsection}</td><td>${new Date(e.created_at).toLocaleString()}</td><td>${e.item}</td><td>${e.type || ''}</td><td>${e.leader_name}</td><td>${allocated}</td><td style="text-align:right;">${movementQty}</td><td style="text-align:right;">${isIssue ? (e.received || 0) : 0}</td><td style="text-align:right;font-weight:bold;">${totalsByDeptItem[deptKey]}</td><td>${e.notes || ''}</td></tr>`;
        });
        const skuStats = {};
        sortedEntries.forEach(e => {
            if (!skuStats[e.item]) skuStats[e.item] = { arrived: 0, issued: 0, returned: 0 };
            if (!e.employee) {
                skuStats[e.item].arrived += (e.received || 0);
                skuStats[e.item].issued += (e.issued || 0);
            } else {
                skuStats[e.item].issued += (e.issued || 0);
                skuStats[e.item].returned += (e.received || 0);
            }
        });
        const sortedSkuRows = Object.entries(skuStats).sort((a, b) => a[0].localeCompare(b[0]));
        let skuRows = '';
        sortedSkuRows.forEach(([item, s]) => {
            const usable = s.arrived - s.issued;
            const styleCol = usable >= 0 ? 'color:#22c55e' : 'color:#ef4444';
            skuRows += `<tr><td>${item}</td><td style="text-align:right;">${s.arrived}</td><td style="text-align:right;">${s.issued}</td><td style="text-align:right;font-weight:bold;${styleCol};">${usable}</td><td style="text-align:right;">${s.returned}</td></tr>`;
        });
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;margin-bottom:30px}thead tr{background-color:#f97316;color:white}th,td{border:1px solid #ccc;padding:8px 12px;text-align:left}th{font-weight:bold;text-transform:uppercase;font-size:12px}td{font-size:12px}tr:nth-child(even){background-color:#f8f8f8}.title{font-size:18px;font-weight:bold;margin-bottom:10px}.section{font-size:16px;font-weight:bold;margin:25px 0 8px 0;color:#0f172a}</style></head><body><div class="title">Stock Tracking Report — ${new Date().toLocaleDateString()}</div><div class="section">1. Stock Movements (per case)</div><table><thead><tr><th>Department</th><th>Date</th><th>Item</th><th>Type</th><th>Team Leader</th><th>Allocated To</th><th>Movement Qty</th><th>Old Stock Returned (audit/disposal)</th><th>Running Usable Total</th><th>Notes</th></tr></thead><tbody>${movementRows}</tbody></table><div class="section">2. Stock Levels by SKU</div><table><thead><tr><th>Item</th><th>Total Arrived (new)</th><th>Total Issued (new)</th><th>Current Usable Stock</th><th>Total Old Stock Returned (audit/disposal)</th></tr></thead><tbody>${skuRows}</tbody></table></body></html>`;
        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Stock_Report_${new Date().toISOString().split('T')[0]}.xls`; a.click();
        URL.revokeObjectURL(url);
    },

    // ============ CLEAR ALL STOCK DATA ============
    async clearStockData() {
        await this.loadEntries();
        const count = this.entries.length;
        document.getElementById('clear-warning-details').innerHTML = `You are about to permanently delete <strong style="color:#ef4444;">${count} stock movement${count === 1 ? '' : 's'}</strong> from the database.<br><br>This will affect:<ul style="margin-top:0.5rem;padding-left:1.25rem;"><li>Every Issue entry (incl. PPE & Consumables, old stock returns)</li><li>Every Arrival entry (incoming new stock)</li><li>The Stock Levels report in any future Excel exports</li></ul><br><em>This only touches stock movements. Team leader accounts, employee rosters, and admin access are NOT affected.</em>`;
        document.getElementById('clear-warning-modal').style.display = 'flex';
    },

    async executeClearData() {
        const executeBtn = document.getElementById('btn-clear-execute');
        executeBtn.disabled = true;
        executeBtn.textContent = 'Deleting…';
        try {
            const { error: err1 } = await db.from('stock_entries').delete().gte('created_at', '1970-01-01');
            document.getElementById('clear-confirm-modal').style.display = 'none';
            if (err1) alert('Some data could not be deleted: ' + err1.message);
            else {
                await this.loadEntries();
                alert('All stock data has been permanently deleted.');
                const infoEl = document.getElementById('clear-data-info');
                if (infoEl) infoEl.innerHTML = 'Last cleared: ' + new Date().toLocaleString();
            }
        } catch (e) { alert('Clear failed: ' + e.message); }
        finally { executeBtn.disabled = false; executeBtn.textContent = 'Permanently Delete All Data'; }
    }
};

window.app = app;
app.init();
} // end duplicate-load guard
