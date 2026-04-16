/**
 * Dashboard (organisaties) – zelfde inlog als admin, alleen eigen Nieuws / Agenda / Profiel.
 * API: /api/auth/login, /api/org/me, /api/org/news, /api/org/events, /api/org/profile, /api/upload
 */
(function () {
    const apiBase = window.location.hostname === 'localhost'
        ? 'http://localhost:3000/api'
        : 'https://holwert-backend.vercel.app/api';

    const TOKEN_KEY = 'holwertDashboardToken';
    const TOKEN_KEY_LEGACY = 'orgPortalToken';

    function getStoredToken() {
        return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY_LEGACY);
    }
    function setStoredToken(t) {
        localStorage.setItem(TOKEN_KEY, t);
        localStorage.removeItem(TOKEN_KEY_LEGACY);
    }
    function clearStoredToken() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_KEY_LEGACY);
    }

    let token = getStoredToken();
    let currentUser = null;
    let organization = null;

    const loginScreen = document.getElementById('loginScreen');
    const loginPanel = document.getElementById('loginPanel');
    const registerOrgPanel = document.getElementById('registerOrgPanel');
    const mainScreen = document.getElementById('mainScreen');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const orgRegisterForm = document.getElementById('orgRegisterForm');
    const orgRegisterError = document.getElementById('orgRegisterError');
    const userInfo = document.getElementById('userInfo');
    const logoutBtn = document.getElementById('logoutBtn');

    let orgLogoPreviewObjectUrl = null;
    function clearOrgLogoPreview() {
        if (orgLogoPreviewObjectUrl) {
            URL.revokeObjectURL(orgLogoPreviewObjectUrl);
            orgLogoPreviewObjectUrl = null;
        }
        const prev = document.getElementById('org_reg_logo_preview');
        if (prev) prev.innerHTML = '';
    }

    document.getElementById('org_reg_logo_file')?.addEventListener('change', () => {
        clearOrgLogoPreview();
        const input = document.getElementById('org_reg_logo_file');
        const prev = document.getElementById('org_reg_logo_preview');
        const f = input?.files?.[0];
        if (!f || !f.type.startsWith('image/') || !prev) return;
        orgLogoPreviewObjectUrl = URL.createObjectURL(f);
        prev.innerHTML = `<img src="${orgLogoPreviewObjectUrl}" alt="" style="max-height:96px;border-radius:6px;margin-top:8px;object-fit:contain">`;
    });

    function trimOrUndef(id) {
        const el = document.getElementById(id);
        const s = (el && el.value) ? String(el.value).trim() : '';
        return s || undefined;
    }

    function showOrgRegisterError(msg, isError = true) {
        if (!orgRegisterError) return;
        orgRegisterError.textContent = msg;
        orgRegisterError.style.color = isError ? '#c00' : '#080';
        orgRegisterError.classList.add('show');
    }

    document.getElementById('showOrgRegisterBtn')?.addEventListener('click', () => {
        if (loginPanel) loginPanel.style.display = 'none';
        if (registerOrgPanel) registerOrgPanel.style.display = 'block';
        if (loginError) loginError.classList.remove('show');
        if (orgRegisterError) orgRegisterError.classList.remove('show');
    });

    document.getElementById('backToLoginBtn')?.addEventListener('click', () => {
        clearOrgLogoPreview();
        if (registerOrgPanel) registerOrgPanel.style.display = 'none';
        if (loginPanel) loginPanel.style.display = 'block';
        if (orgRegisterError) {
            orgRegisterError.textContent = '';
            orgRegisterError.classList.remove('show');
        }
    });

    orgRegisterForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!orgRegisterError) return;
        orgRegisterError.classList.remove('show');
        const name = (document.getElementById('org_reg_name')?.value || '').trim();
        if (!name) {
            showOrgRegisterError('Vul de organisatienaam in.');
            return;
        }
        const bcRaw = (document.getElementById('org_reg_brand_color')?.value || '').trim();
        if (bcRaw && !/^#[0-9A-Fa-f]{6}$/.test(bcRaw)) {
            showOrgRegisterError('Brandkleur: gebruik hex zoals #0f46ae (6 tekens na #).');
            return;
        }
        const logoFile = document.getElementById('org_reg_logo_file')?.files?.[0];
        if (logoFile) {
            if (!logoFile.type.startsWith('image/')) {
                showOrgRegisterError('Logo: kies een afbeeldingsbestand (JPG, PNG, …).');
                return;
            }
            if (logoFile.size > 9 * 1024 * 1024) {
                showOrgRegisterError('Logo: bestand te groot (max. 9 MB).');
                return;
            }
        }

        const btn = document.getElementById('orgRegisterSubmitBtn');
        const span = btn?.querySelector('span');
        if (span) span.textContent = 'Versturen…';
        if (btn) btn.disabled = true;
        try {
            let logoUrl = trimOrUndef('org_reg_logo_url');
            if (logoFile) {
                if (span) span.textContent = 'Logo uploaden…';
                const fd = new FormData();
                fd.append('image', logoFile);
                const upRes = await fetch(`${apiBase}/organizations/register-logo`, {
                    method: 'POST',
                    body: fd,
                });
                const upData = await upRes.json().catch(() => ({}));
                if (!upRes.ok) {
                    showOrgRegisterError(upData.message || upData.error || `Logo-upload mislukt (${upRes.status})`);
                    if (span) span.textContent = 'Aanmelding versturen';
                    if (btn) btn.disabled = false;
                    return;
                }
                logoUrl = upData.url || upData.imageUrl || logoUrl;
            }
            if (span) span.textContent = 'Aanmelding versturen…';
            const payload = {
                name,
                category: trimOrUndef('org_reg_category'),
                description: trimOrUndef('org_reg_description'),
                bio: trimOrUndef('org_reg_bio'),
                website: trimOrUndef('org_reg_website'),
                email: trimOrUndef('org_reg_email'),
                phone: trimOrUndef('org_reg_phone'),
                whatsapp: trimOrUndef('org_reg_whatsapp'),
                address: trimOrUndef('org_reg_address'),
                brand_color: bcRaw || undefined,
                logo_url: logoUrl,
                facebook: trimOrUndef('org_reg_facebook'),
                instagram: trimOrUndef('org_reg_instagram'),
                twitter: trimOrUndef('org_reg_twitter'),
                linkedin: trimOrUndef('org_reg_linkedin'),
                privacy_statement: trimOrUndef('org_reg_privacy'),
            };
            const res = await fetch(`${apiBase}/organizations/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showOrgRegisterError(data.message || data.error || `Mislukt (${res.status})`);
                if (span) span.textContent = 'Aanmelding versturen';
                if (btn) btn.disabled = false;
                return;
            }
            showOrgRegisterError(data.message || 'Aanmelding ontvangen. Na goedkeuring neemt de beheerder contact op.', false);
            clearOrgLogoPreview();
            orgRegisterForm.reset();
            setTimeout(() => {
                if (registerOrgPanel) registerOrgPanel.style.display = 'none';
                if (loginPanel) loginPanel.style.display = 'block';
                if (orgRegisterError) {
                    orgRegisterError.textContent = '';
                    orgRegisterError.classList.remove('show');
                }
                if (span) span.textContent = 'Aanmelding versturen';
                if (btn) btn.disabled = false;
            }, 2800);
        } catch (err) {
            showOrgRegisterError(err.message || 'Netwerkfout');
            if (span) span.textContent = 'Aanmelding versturen';
            if (btn) btn.disabled = false;
        }
    });

    function showError(msg, isError = true) {
        if (!loginError) return;
        loginError.textContent = msg;
        loginError.style.color = isError ? '#c00' : '#080';
        loginError.classList.add('show');
    }

    function authHeaders() {
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    }

    /** Multipart naar backend; organisatiemap komt uit JWT (client kan die niet overschrijven). */
    async function uploadImageFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            throw new Error('Kies een afbeeldingsbestand (JPG, PNG, …).');
        }
        if (file.size > 9 * 1024 * 1024) {
            throw new Error('Bestand te groot (max. 9 MB).');
        }
        const fd = new FormData();
        fd.append('image', file, file.name);
        const r = await fetch(`${apiBase}/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
            throw new Error(j.message || j.error || `Upload mislukt (${r.status})`);
        }
        const url = j.imageUrl || j.url;
        if (!url) throw new Error('Geen afbeeldings-URL van server');
        return url;
    }

    async function login(email, password) {
        const res = await fetch(`${apiBase}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || 'Inloggen mislukt');
        return data;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        loginError.classList.remove('show');
        const btn = loginForm.querySelector('button[type="submit"]');
        const span = btn?.querySelector('span');
        if (span) span.textContent = 'Inloggen...';
        try {
            const data = await login(email, password);
            token = data.token;
            currentUser = data.user;
            setStoredToken(token);
            const elevated = new Set(['admin', 'superadmin', 'editor']);
            if (elevated.has(String(currentUser.role || '').toLowerCase())) {
                clearStoredToken();
                token = null;
                showError('Dit account hoort in het beheerderspaneel (/admin), niet in het dashboard.');
                if (span) span.textContent = 'Inloggen';
                return;
            }
            if (!currentUser.organization_id) {
                clearStoredToken();
                token = null;
                showError('Dit account is niet gekoppeld aan een organisatie. Neem contact op met de beheerder.');
                if (span) span.textContent = 'Inloggen';
                return;
            }
            if (span) span.textContent = 'Succesvol!';
            const meRes = await fetch(`${apiBase}/org/me`, { headers: authHeaders() });
            if (!meRes.ok) {
                const err = await meRes.json().catch(() => ({}));
                throw new Error(err.message || err.error || 'Geen toegang tot dashboard');
            }
            const meData = await meRes.json();
            organization = meData.organization;
            currentUser = meData.user;
            loginScreen.classList.remove('active');
            mainScreen.classList.add('active');
            if (userInfo) userInfo.textContent = organization?.name || currentUser.email;
            loadNews();
            loadEvents();
            loadProfile();
        } catch (err) {
            showError(err.message || 'Inloggen mislukt');
            if (span) span.textContent = 'Inloggen';
        }
    });

    logoutBtn?.addEventListener('click', () => {
        token = null;
        currentUser = null;
        organization = null;
        clearStoredToken();
        mainScreen.classList.remove('active');
        loginScreen.classList.add('active');
        if (registerOrgPanel) registerOrgPanel.style.display = 'none';
        if (loginPanel) loginPanel.style.display = 'block';
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
        loginError.classList.remove('show');
        if (orgRegisterError) {
            orgRegisterError.textContent = '';
            orgRegisterError.classList.remove('show');
        }
    });

    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            el.classList.add('active');
            const id = el.getAttribute('data-section');
            const section = document.getElementById(id);
            if (section) section.classList.add('active');
        });
    });

    async function loadNews() {
        const container = document.getElementById('newsList');
        if (!container) return;
        try {
            const res = await fetch(`${apiBase}/org/news?limit=50`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Laden mislukt');
            const list = data.news || [];
            container.innerHTML = list.length
                ? `<table class="data-table"><thead><tr><th>Titel</th><th>Status</th><th>Datum</th><th></th></tr></thead><tbody>${
                    list.map(n => `<tr>
                        <td>${escapeHtml(n.title || '')}</td>
                        <td>${n.is_published ? 'Gepubliceerd' : 'Concept'}</td>
                        <td>${n.published_at ? new Date(n.published_at).toLocaleDateString('nl-NL') : '-'}</td>
                        <td><button type="button" class="btn btn-secondary btn-sm" data-edit-news="${n.id}">Bewerken</button></td>
                    </tr>`).join('')
                }</tbody></table>`
                : '<p class="empty-message">Nog geen nieuwsartikelen.</p>';
            container.querySelectorAll('[data-edit-news]').forEach(b => {
                b.addEventListener('click', () => openNewsModal(parseInt(b.getAttribute('data-edit-news'), 10)));
            });
        } catch (e) {
            container.innerHTML = `<p class="empty-message">Fout: ${e.message}</p>`;
        }
    }

    document.getElementById('addNewsBtn')?.addEventListener('click', () => openNewsModal(null));

    function openNewsModal(id) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        const load = async () => {
            let article = null;
            if (id) {
                const r = await fetch(`${apiBase}/org/news/${id}`, { headers: authHeaders() });
                const d = await r.json();
                if (r.ok) article = d.article;
            }
            const imgPreview = article?.image_url
                ? `<p style="margin:0 0 8px"><img src="${escapeHtml(article.image_url)}" alt="" style="max-height:120px;border-radius:6px"></p>`
                : '';
            overlay.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${article ? 'Artikel bewerken' : 'Nieuw artikel'}</h3>
                        <button type="button" class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>Titel</label>
                            <input type="text" id="newsTitle" value="${escapeHtml(article?.title || '')}">
                        </div>
                        <div class="form-group">
                            <label>Samenvatting</label>
                            <textarea id="newsExcerpt" rows="2">${escapeHtml(article?.excerpt || '')}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Inhoud</label>
                            <textarea id="newsContent" rows="6">${escapeHtml(article?.content || '')}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Afbeelding</label>
                            ${imgPreview}
                            <input type="file" id="newsImageFile" accept="image/*">
                            <p class="form-hint">Optioneel: JPG/PNG, max. 9 MB. Wordt in jullie organisatiemap geplaatst.</p>
                            <label style="margin-top:8px;display:block">Of afbeeldings-URL (https)</label>
                            <input type="url" id="newsImageUrlInput" placeholder="https://..." value="${escapeHtml(article?.image_url || '')}">
                        </div>
                        <div class="form-group">
                            <label><input type="checkbox" id="newsPublished" ${article?.is_published ? 'checked' : ''}> Gepubliceerd</label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary modal-close-btn">Annuleren</button>
                        <button type="button" class="btn btn-primary" id="newsSaveBtn">Opslaan</button>
                    </div>
                </div>`;
            overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
            overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#newsSaveBtn').addEventListener('click', async () => {
                const btn = overlay.querySelector('#newsSaveBtn');
                const file = document.getElementById('newsImageFile')?.files?.[0];
                let imageUrl = (document.getElementById('newsImageUrlInput')?.value || '').trim();
                if (file) {
                    btn.disabled = true;
                    btn.textContent = 'Uploaden…';
                    try {
                        imageUrl = await uploadImageFile(file);
                    } catch (err) {
                        alert(err.message || 'Upload mislukt');
                        btn.disabled = false;
                        btn.textContent = 'Opslaan';
                        return;
                    }
                    btn.disabled = false;
                    btn.textContent = 'Opslaan';
                }
                const payload = {
                    title: document.getElementById('newsTitle').value.trim(),
                    excerpt: document.getElementById('newsExcerpt').value.trim(),
                    content: document.getElementById('newsContent').value.trim(),
                    is_published: document.getElementById('newsPublished').checked,
                    image_url: imageUrl || null
                };
                const url = id ? `${apiBase}/org/news/${id}` : `${apiBase}/org/news`;
                const method = id ? 'PUT' : 'POST';
                const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
                if (!r.ok) { alert((await r.json()).error || 'Opslaan mislukt'); return; }
                overlay.remove();
                loadNews();
            });
        };
        load();
        document.body.appendChild(overlay);
    }

    async function loadEvents() {
        const container = document.getElementById('eventsList');
        if (!container) return;
        try {
            const res = await fetch(`${apiBase}/org/events?limit=50`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Laden mislukt');
            const list = data.events || [];
            container.innerHTML = list.length
                ? `<table class="data-table"><thead><tr><th>Titel</th><th>Datum</th><th>Locatie</th><th></th></tr></thead><tbody>${
                    list.map(e => `<tr>
                        <td>${escapeHtml(e.title || '')}</td>
                        <td>${e.event_date ? new Date(e.event_date).toLocaleDateString('nl-NL') : '-'}</td>
                        <td>${escapeHtml(e.location || '-')}</td>
                        <td><button type="button" class="btn btn-secondary btn-sm" data-edit-event="${e.id}">Bewerken</button></td>
                    </tr>`).join('')
                }</tbody></table>`
                : '<p class="empty-message">Nog geen evenementen.</p>';
            container.querySelectorAll('[data-edit-event]').forEach(b => {
                b.addEventListener('click', () => openEventModal(parseInt(b.getAttribute('data-edit-event'), 10)));
            });
        } catch (e) {
            container.innerHTML = `<p class="empty-message">Fout: ${e.message}</p>`;
        }
    }

    document.getElementById('addEventBtn')?.addEventListener('click', () => openEventModal(null));

    function openEventModal(id) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        const load = async () => {
            let event = null;
            if (id) {
                const r = await fetch(`${apiBase}/org/events/${id}`, { headers: authHeaders() });
                const d = await r.json();
                if (r.ok) event = d.event;
            }
            const evImg = event?.image_url
                ? `<p style="margin:0 0 8px"><img src="${escapeHtml(event.image_url)}" alt="" style="max-height:120px;border-radius:6px"></p>`
                : '';
            overlay.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${event ? 'Evenement bewerken' : 'Nieuw evenement'}</h3>
                        <button type="button" class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>Titel</label>
                            <input type="text" id="eventTitle" value="${escapeHtml(event?.title || '')}">
                        </div>
                        <div class="form-group">
                            <label>Beschrijving</label>
                            <textarea id="eventDescription" rows="3">${escapeHtml(event?.description || '')}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Datum</label>
                            <input type="datetime-local" id="eventDate" value="${event?.event_date ? new Date(event.event_date).toISOString().slice(0, 16) : ''}">
                        </div>
                        <div class="form-group">
                            <label>Locatie</label>
                            <input type="text" id="eventLocation" value="${escapeHtml(event?.location || '')}">
                        </div>
                        <div class="form-group">
                            <label>Afbeelding</label>
                            ${evImg}
                            <input type="file" id="eventImageFile" accept="image/*">
                            <p class="form-hint">Optioneel, max. 9 MB.</p>
                            <label style="margin-top:8px;display:block">Of URL</label>
                            <input type="url" id="eventImageUrlInput" placeholder="https://..." value="${escapeHtml(event?.image_url || '')}">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary modal-close-btn">Annuleren</button>
                        <button type="button" class="btn btn-primary" id="eventSaveBtn">Opslaan</button>
                    </div>
                </div>`;
            overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
            overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#eventSaveBtn').addEventListener('click', async () => {
                const btn = overlay.querySelector('#eventSaveBtn');
                const file = document.getElementById('eventImageFile')?.files?.[0];
                let imageUrl = (document.getElementById('eventImageUrlInput')?.value || '').trim();
                if (file) {
                    btn.disabled = true;
                    btn.textContent = 'Uploaden…';
                    try {
                        imageUrl = await uploadImageFile(file);
                    } catch (err) {
                        alert(err.message || 'Upload mislukt');
                        btn.disabled = false;
                        btn.textContent = 'Opslaan';
                        return;
                    }
                    btn.disabled = false;
                    btn.textContent = 'Opslaan';
                }
                const payload = {
                    title: document.getElementById('eventTitle').value.trim(),
                    description: document.getElementById('eventDescription').value.trim(),
                    event_date: document.getElementById('eventDate').value || null,
                    location: document.getElementById('eventLocation').value.trim() || null,
                    image_url: imageUrl || null
                };
                const url = id ? `${apiBase}/org/events/${id}` : `${apiBase}/org/events`;
                const method = id ? 'PUT' : 'POST';
                const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
                if (!r.ok) { alert((await r.json()).error || 'Opslaan mislukt'); return; }
                overlay.remove();
                loadEvents();
            });
        };
        load();
        document.body.appendChild(overlay);
    }

    async function loadProfile() {
        try {
            const res = await fetch(`${apiBase}/org/profile`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Profiel laden mislukt');
            const org = data.organization || {};
            const fields = [
                { key: 'name', label: 'Naam', readonly: true },
                { key: 'description', label: 'Beschrijving' },
                { key: 'website', label: 'Website' },
                { key: 'email', label: 'E-mail' },
                { key: 'phone', label: 'Telefoon' },
                { key: 'address', label: 'Adres' }
            ];
            const logoBlock = org.logo_url
                ? `<p style="margin:0 0 8px"><img src="${escapeHtml(org.logo_url)}" alt="Logo" style="max-height:80px;border-radius:6px"></p>`
                : '<p class="form-hint">Nog geen logo geüpload.</p>';
            document.getElementById('profileForm').innerHTML = `
                <div class="form-group">
                    <label>Logo</label>
                    ${logoBlock}
                    <input type="file" id="profileLogoFile" accept="image/*">
                    <p class="form-hint">Nieuw logo: kies bestand (max. 9 MB) en klik op Opslaan.</p>
                </div>` + fields.map(f => `
                <div class="form-group">
                    <label>${f.label}</label>
                    <input type="text" id="profile_${f.key}" value="${escapeHtml(org[f.key] || '')}" ${f.readonly ? 'readonly' : ''}>
                </div>`).join('');
            document.getElementById('privacyForm').innerHTML = `
                <div class="form-group">
                    <label>Privacy statement (wordt in de app getoond)</label>
                    <textarea id="profile_privacy_statement" rows="8">${escapeHtml(org.privacy_statement || '')}</textarea>
                </div>`;
        } catch (e) {
            document.getElementById('profileForm').innerHTML = `<p class="empty-message">Fout: ${e.message}</p>`;
        }
    }

    document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('saveProfileBtn');
        const payload = {
            description: document.getElementById('profile_description')?.value?.trim(),
            website: document.getElementById('profile_website')?.value?.trim(),
            email: document.getElementById('profile_email')?.value?.trim(),
            phone: document.getElementById('profile_phone')?.value?.trim(),
            address: document.getElementById('profile_address')?.value?.trim(),
            privacy_statement: document.getElementById('profile_privacy_statement')?.value?.trim()
        };
        const logoFile = document.getElementById('profileLogoFile')?.files?.[0];
        if (logoFile) {
            if (btn) { btn.disabled = true; btn.textContent = 'Logo uploaden…'; }
            try {
                payload.logo_url = await uploadImageFile(logoFile);
            } catch (err) {
                alert(err.message || 'Logo-upload mislukt');
                if (btn) { btn.disabled = false; btn.textContent = 'Opslaan'; }
                return;
            }
            if (btn) { btn.disabled = false; btn.textContent = 'Opslaan'; }
        }
        const r = await fetch(`${apiBase}/org/profile`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { alert(data.error || 'Opslaan mislukt'); return; }
        alert('Opgeslagen.');
        organization = data.organization;
        loadProfile();
    });

    function escapeHtml(s) {
        if (s == null) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    if (token) {
        fetch(`${apiBase}/org/me`, { headers: authHeaders() })
            .then(r => {
                if (!r.ok) throw new Error();
                return r.json();
            })
            .then(data => {
                currentUser = data.user;
                organization = data.organization;
                loginScreen.classList.remove('active');
                mainScreen.classList.add('active');
                if (userInfo) userInfo.textContent = organization?.name || currentUser?.email;
                loadNews();
                loadEvents();
                loadProfile();
            })
            .catch(() => {
                clearStoredToken();
                token = null;
            });
    }
})();
