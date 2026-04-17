/**
 * Organisatieportaal –zelfde inlog als admin, alleen Nieuws / Agenda / Organisatie profiel.
 * API: /api/auth/login, /api/org/me, /api/org/news, /api/org/events, /api/org/profile
 */
(function () {
    const apiBase = window.location.hostname === 'localhost'
        ? 'http://localhost:3000/api'
        : 'https://holwert-backend.vercel.app/api';

    let token = localStorage.getItem('orgPortalToken');
    let currentUser = null;
    let organization = null;

    const loginScreen = document.getElementById('loginScreen');
    const mainScreen = document.getElementById('mainScreen');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const userInfo = document.getElementById('userInfo');
    const logoutBtn = document.getElementById('logoutBtn');

    function showError(msg, isError = true) {
        if (!loginError) return;
        loginError.textContent = msg;
        loginError.style.color = isError ? '#c00' : '#080';
        loginError.classList.add('show');
    }

    function authHeaders() {
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
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
            localStorage.setItem('orgPortalToken', token);
            // Alleen globale beheerders zonder org-koppeling naar /admin sturen; editor/user mét org mag hier
            const elevated = new Set(['admin', 'superadmin', 'editor']);
            const role = String(currentUser.role || '').toLowerCase();
            if (elevated.has(role) && !currentUser.organization_id) {
                localStorage.removeItem('orgPortalToken');
                token = null;
                showError('Dit account heeft geen organisatie gekoppeld. Gebruik het beheerderspaneel (/admin) of laat een organisatie koppelen.');
                if (span) span.textContent = 'Inloggen';
                return;
            }
            if (!currentUser.organization_id) {
                localStorage.removeItem('orgPortalToken');
                token = null;
                showError('Dit account is niet gekoppeld aan een organisatie. Neem contact op met de beheerder.');
                if (span) span.textContent = 'Inloggen';
                return;
            }
            if (span) span.textContent = 'Succesvol!';
            const meRes = await fetch(`${apiBase}/org/me`, { headers: authHeaders() });
            if (!meRes.ok) {
                const err = await meRes.json().catch(() => ({}));
                throw new Error(err.message || err.error || 'Geen toegang tot organisatieportaal');
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
        localStorage.removeItem('orgPortalToken');
        mainScreen.classList.remove('active');
        loginScreen.classList.add('active');
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
        loginError.classList.remove('show');
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
                const payload = {
                    title: document.getElementById('newsTitle').value.trim(),
                    excerpt: document.getElementById('newsExcerpt').value.trim(),
                    content: document.getElementById('newsContent').value.trim(),
                    is_published: document.getElementById('newsPublished').checked
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
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary modal-close-btn">Annuleren</button>
                        <button type="button" class="btn btn-primary" id="eventSaveBtn">Opslaan</button>
                    </div>
                </div>`;
            overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
            overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#eventSaveBtn').addEventListener('click', async () => {
                const payload = {
                    title: document.getElementById('eventTitle').value.trim(),
                    description: document.getElementById('eventDescription').value.trim(),
                    event_date: document.getElementById('eventDate').value || null,
                    location: document.getElementById('eventLocation').value.trim() || null
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
            document.getElementById('profileForm').innerHTML = fields.map(f => `
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
        const payload = {
            description: document.getElementById('profile_description')?.value?.trim(),
            website: document.getElementById('profile_website')?.value?.trim(),
            email: document.getElementById('profile_email')?.value?.trim(),
            phone: document.getElementById('profile_phone')?.value?.trim(),
            address: document.getElementById('profile_address')?.value?.trim(),
            privacy_statement: document.getElementById('profile_privacy_statement')?.value?.trim()
        };
        const r = await fetch(`${apiBase}/org/profile`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { alert(data.error || 'Opslaan mislukt'); return; }
        alert('Opgeslagen.');
        organization = data.organization;
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
                localStorage.removeItem('orgPortalToken');
                token = null;
            });
    }
})();
