/**
 * Dashboard (organisaties) – zelfde inlog als admin, alleen eigen Nieuws / Agenda / Profiel.
 * API: /api/auth/login, /api/org/me, /api/org/me/password, /api/org/news, /api/org/events, /api/org/profile, /api/upload
 */
(function () {
    const _host = window.location.hostname;
    const apiBase = _host === 'localhost' || _host === '127.0.0.1'
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
    const forgotPasswordPanel = document.getElementById('forgotPasswordPanel');
    const resetPasswordPanel = document.getElementById('resetPasswordPanel');
    const forgotPasswordForm = document.getElementById('forgotPasswordForm');
    const forgotPasswordMsg = document.getElementById('forgotPasswordMsg');
    const resetPasswordForm = document.getElementById('resetPasswordForm');
    const resetPasswordMsg = document.getElementById('resetPasswordMsg');

    function showAuthPanel(which) {
        const map = {
            login: () => {
                if (loginPanel) loginPanel.style.display = 'block';
                if (registerOrgPanel) registerOrgPanel.style.display = 'none';
                if (forgotPasswordPanel) forgotPasswordPanel.style.display = 'none';
                if (resetPasswordPanel) resetPasswordPanel.style.display = 'none';
            },
            register: () => {
                if (loginPanel) loginPanel.style.display = 'none';
                if (registerOrgPanel) registerOrgPanel.style.display = 'block';
                if (forgotPasswordPanel) forgotPasswordPanel.style.display = 'none';
                if (resetPasswordPanel) resetPasswordPanel.style.display = 'none';
            },
            forgot: () => {
                if (loginPanel) loginPanel.style.display = 'none';
                if (registerOrgPanel) registerOrgPanel.style.display = 'none';
                if (forgotPasswordPanel) forgotPasswordPanel.style.display = 'block';
                if (resetPasswordPanel) resetPasswordPanel.style.display = 'none';
            },
            reset: () => {
                if (loginPanel) loginPanel.style.display = 'none';
                if (registerOrgPanel) registerOrgPanel.style.display = 'none';
                if (forgotPasswordPanel) forgotPasswordPanel.style.display = 'none';
                if (resetPasswordPanel) resetPasswordPanel.style.display = 'block';
            },
        };
        const fn = map[which];
        if (fn) fn();
    }

    function clearForgotResetMessages() {
        if (forgotPasswordMsg) {
            forgotPasswordMsg.textContent = '';
            forgotPasswordMsg.classList.remove('show', 'login-feedback--success', 'login-feedback--error');
        }
        if (resetPasswordMsg) {
            resetPasswordMsg.textContent = '';
            resetPasswordMsg.classList.remove('show', 'login-feedback--success', 'login-feedback--error');
        }
    }

    function clearResetQueryFromUrl() {
        try {
            const u = new URL(window.location.href);
            u.searchParams.delete('reset');
            const q = u.searchParams.toString();
            window.history.replaceState({}, '', u.pathname + (q ? `?${q}` : '') + u.hash);
        } catch (_) {
            /* ignore */
        }
    }

    (function initPasswordResetFromUrl() {
        const p = new URLSearchParams(window.location.search);
        const rt = (p.get('reset') || '').trim();
        if (rt && /^[a-f0-9]{64}$/i.test(rt)) {
            showAuthPanel('reset');
            const hid = document.getElementById('resetPwToken');
            if (hid) hid.value = rt;
            const rp1 = document.getElementById('resetPw1');
            const rp2 = document.getElementById('resetPw2');
            if (rp1) rp1.value = '';
            if (rp2) rp2.value = '';
        }
    })();

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
        showAuthPanel('register');
        if (loginError) loginError.classList.remove('show', 'login-feedback--success', 'login-feedback--error');
        if (orgRegisterError) orgRegisterError.classList.remove('show');
    });

    document.getElementById('backToLoginBtn')?.addEventListener('click', () => {
        clearOrgLogoPreview();
        showAuthPanel('login');
        if (orgRegisterError) {
            orgRegisterError.textContent = '';
            orgRegisterError.classList.remove('show');
        }
    });

    document.getElementById('showForgotPasswordBtn')?.addEventListener('click', () => {
        showAuthPanel('forgot');
        clearForgotResetMessages();
        if (loginError) loginError.classList.remove('show', 'login-feedback--success', 'login-feedback--error');
        const fe = document.getElementById('forgotEmail');
        const loginEmail = document.getElementById('email');
        if (fe && loginEmail) fe.value = (loginEmail.value || '').trim();
    });

    document.getElementById('backFromForgotBtn')?.addEventListener('click', () => {
        showAuthPanel('login');
        clearForgotResetMessages();
    });

    document.getElementById('backFromResetBtn')?.addEventListener('click', () => {
        clearResetQueryFromUrl();
        showAuthPanel('login');
        clearForgotResetMessages();
    });

    forgotPasswordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearForgotResetMessages();
        const email = (document.getElementById('forgotEmail')?.value || '').trim().toLowerCase();
        if (!email) return;
        const btn = document.getElementById('forgotPasswordSubmitBtn');
        const span = btn?.querySelector('span');
        if (span) span.textContent = 'Verzenden…';
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(`${apiBase}/auth/org-forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || data.message || 'Mislukt');
            if (forgotPasswordMsg) {
                forgotPasswordMsg.textContent =
                    data.message ||
                    'Als dit adres bekend is, ontvang je een e-mail. Controleer ook je spam-map.';
                forgotPasswordMsg.style.color = '';
                forgotPasswordMsg.classList.remove('login-feedback--error');
                forgotPasswordMsg.classList.add('login-feedback--success', 'show');
            }
        } catch (err) {
            if (forgotPasswordMsg) {
                forgotPasswordMsg.textContent = err.message || 'Netwerkfout';
                forgotPasswordMsg.style.color = '';
                forgotPasswordMsg.classList.remove('login-feedback--success');
                forgotPasswordMsg.classList.add('login-feedback--error', 'show');
            }
        } finally {
            if (span) span.textContent = 'Verstuur link';
            if (btn) btn.disabled = false;
        }
    });

    resetPasswordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearForgotResetMessages();
        const t = (document.getElementById('resetPwToken')?.value || '').trim();
        const p1 = document.getElementById('resetPw1')?.value || '';
        const p2 = document.getElementById('resetPw2')?.value || '';
        if (!/^[a-f0-9]{64}$/i.test(t)) {
            if (resetPasswordMsg) {
                resetPasswordMsg.textContent = 'Ongeldige link. Vraag opnieuw een reset aan.';
                resetPasswordMsg.style.color = '';
                resetPasswordMsg.classList.remove('login-feedback--success');
                resetPasswordMsg.classList.add('login-feedback--error', 'show');
            }
            return;
        }
        if (p1.length < 6) {
            if (resetPasswordMsg) {
                resetPasswordMsg.textContent = 'Minimaal 6 tekens.';
                resetPasswordMsg.style.color = '';
                resetPasswordMsg.classList.remove('login-feedback--success');
                resetPasswordMsg.classList.add('login-feedback--error', 'show');
            }
            return;
        }
        if (p1 !== p2) {
            if (resetPasswordMsg) {
                resetPasswordMsg.textContent = 'Wachtwoorden komen niet overeen.';
                resetPasswordMsg.style.color = '';
                resetPasswordMsg.classList.remove('login-feedback--success');
                resetPasswordMsg.classList.add('login-feedback--error', 'show');
            }
            return;
        }
        const btn = document.getElementById('resetPasswordSubmitBtn');
        const span = btn?.querySelector('span');
        if (span) span.textContent = 'Opslaan…';
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(`${apiBase}/auth/org-reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: t, password: p1 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || data.message || 'Mislukt');
            clearResetQueryFromUrl();
            showAuthPanel('login');
            showError(data.message || 'Je wachtwoord is bijgewerkt. Je kunt nu inloggen.', false);
        } catch (err) {
            if (resetPasswordMsg) {
                resetPasswordMsg.textContent = err.message || 'Netwerkfout';
                resetPasswordMsg.style.color = '';
                resetPasswordMsg.classList.remove('login-feedback--success');
                resetPasswordMsg.classList.add('login-feedback--error', 'show');
            }
        } finally {
            if (span) span.textContent = 'Opslaan';
            if (btn) btn.disabled = false;
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
        loginError.style.color = '';
        loginError.classList.remove('login-feedback--success', 'login-feedback--error');
        loginError.classList.add(isError ? 'login-feedback--error' : 'login-feedback--success');
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
        loginError.classList.remove('show', 'login-feedback--success', 'login-feedback--error');
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
            const meRes = await fetch(`${apiBase}/org/me`, { headers: authHeaders() });
            if (!meRes.ok) {
                const err = await meRes.json().catch(() => ({}));
                throw new Error(err.message || err.error || 'Geen toegang tot dashboard');
            }
            const meData = await meRes.json();
            organization = meData.organization;
            currentUser = meData.user;
            if (span) span.textContent = 'Succesvol!';
            showError('Je bent ingelogd.', false);
            await new Promise((r) => setTimeout(r, 450));
            loginError.classList.remove('show', 'login-feedback--success', 'login-feedback--error');
            loginScreen.classList.remove('active');
            mainScreen.classList.add('active');
            if (userInfo) userInfo.textContent = organization?.name || currentUser.email;
            loadNews();
            loadEvents();
            loadProfile();
            if (span) span.textContent = 'Inloggen';
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
        showAuthPanel('login');
        clearForgotResetMessages();
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
        const loginSubmitSpan = loginForm?.querySelector('button[type="submit"] span');
        if (loginSubmitSpan) loginSubmitSpan.textContent = 'Inloggen';
        loginError.classList.remove('show', 'login-feedback--success', 'login-feedback--error');
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
                ? `<table class="data-table"><thead><tr><th>Titel</th><th>Status</th><th>Datum</th><th class="cell-actions">Acties</th></tr></thead><tbody>${
                    list.map(n => `<tr>
                        <td>${escapeHtml(n.title || '')}</td>
                        <td>${n.is_published ? 'Gepubliceerd' : 'Concept'}</td>
                        <td>${n.published_at ? new Date(n.published_at).toLocaleDateString('nl-NL') : '-'}</td>
                        <td class="cell-actions">
                            <div class="action-buttons">
                                <button type="button" class="btn-icon btn-view" data-preview-news="${n.id}" title="Preview" aria-label="Preview"><i class="fas fa-eye"></i></button>
                                <button type="button" class="btn-icon btn-edit" data-edit-news="${n.id}" title="Bewerken" aria-label="Bewerken"><i class="fas fa-edit"></i></button>
                                <button type="button" class="btn-icon btn-delete" data-delete-news="${n.id}" data-news-title="${encodeURIComponent(n.title || '')}" title="Verwijderen" aria-label="Verwijderen"><i class="fas fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>`).join('')
                }</tbody></table>`
                : '<p class="empty-message">Nog geen nieuwsartikelen.</p>';
            container.querySelectorAll('[data-preview-news]').forEach(b => {
                b.addEventListener('click', () => openNewsModal(parseInt(b.getAttribute('data-preview-news'), 10), true));
            });
            container.querySelectorAll('[data-edit-news]').forEach(b => {
                b.addEventListener('click', () => openNewsModal(parseInt(b.getAttribute('data-edit-news'), 10), false));
            });
            container.querySelectorAll('[data-delete-news]').forEach(b => {
                b.addEventListener('click', () => {
                    const id = parseInt(b.getAttribute('data-delete-news'), 10);
                    const t = b.getAttribute('data-news-title') || '';
                    deleteOrgNews(id, t);
                });
            });
        } catch (e) {
            container.innerHTML = `<p class="empty-message">Fout: ${e.message}</p>`;
        }
    }

    async function deleteOrgNews(newsId, encodedTitle) {
        const title = encodedTitle ? decodeURIComponent(encodedTitle) : 'dit artikel';
        if (!confirm(`Weet je zeker dat je "${title}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
        try {
            const r = await fetch(`${apiBase}/org/news/${newsId}`, { method: 'DELETE', headers: authHeaders() });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { alert(j.message || j.error || 'Verwijderen mislukt'); return; }
            loadNews();
        } catch (err) {
            alert(err.message || 'Verwijderen mislukt');
        }
    }

    document.getElementById('addNewsBtn')?.addEventListener('click', () => openNewsModal(null, false));

    function openNewsModal(id, isPreview = false) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        const ro = isPreview ? 'readonly' : '';
        const dis = isPreview ? 'disabled' : '';
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
            const titleHtml = isPreview ? 'Artikel bekijken' : (article ? 'Artikel bewerken' : 'Nieuw artikel');
            const publishedAtValue = article?.published_at
                ? toDatetimeInputValue(article.published_at)
                : '';
            const imageEditable = !isPreview
                ? `${imgPreview}
                            <input type="file" id="newsImageFile" accept="image/*">
                            <p class="form-hint">Optioneel: JPG/PNG, max. 9 MB. Wordt in jullie organisatiemap geplaatst.</p>
                            <label style="margin-top:8px;display:block">Of afbeeldings-URL (https)</label>
                            <input type="url" id="newsImageUrlInput" placeholder="https://..." value="${escapeHtml(article?.image_url || '')}">`
                : (imgPreview || '<p class="form-hint">Geen afbeelding</p>');
            overlay.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${titleHtml}</h3>
                        <button type="button" class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>Titel</label>
                            <input type="text" id="newsTitle" value="${escapeHtml(article?.title || '')}" ${ro}>
                        </div>
                        <div class="form-group">
                            <label>Samenvatting</label>
                            <textarea id="newsExcerpt" rows="2" ${ro}>${escapeHtml(article?.excerpt || '')}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Inhoud</label>
                            <textarea id="newsContent" rows="6" ${ro}>${escapeHtml(article?.content || '')}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Publicatiedatum</label>
                            <input type="datetime-local" id="newsPublishedAt" value="${publishedAtValue}" ${ro}>
                            <p class="form-hint">Leeg laten = huidige datum bij opslaan.</p>
                        </div>
                        <div class="form-group">
                            <label>Afbeelding</label>
                            ${imageEditable}
                        </div>
                        <div class="form-group">
                            <label>YouTube-video (optioneel)</label>
                            ${!isPreview
                                ? `<input type="url" id="newsYoutubeUrl" placeholder="https://www.youtube.com/watch?v=... of https://youtu.be/..." value="${escapeHtml(article?.youtube_url || '')}">
                                   <p class="form-hint">Als je een YouTube-link invult, wordt de video als Hero getoond in de app (vervangt de afbeelding).</p>`
                                : (article?.youtube_url
                                    ? `<a href="${escapeHtml(article.youtube_url)}" target="_blank" rel="noopener">${escapeHtml(article.youtube_url)}</a>`
                                    : '<p class="form-hint">Geen video</p>')
                            }
                        </div>
                        <div class="form-group">
                            <label><input type="checkbox" id="newsPublished" ${article?.is_published ? 'checked' : ''} ${dis}> Gepubliceerd</label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary modal-close-btn">${isPreview ? 'Sluiten' : 'Annuleren'}</button>
                        ${!isPreview ? '<button type="button" class="btn btn-primary" id="newsSaveBtn">Opslaan</button>' : ''}
                    </div>
                </div>`;
            overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
            overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
            if (!isPreview) {
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
                    const publishedAtInput = (document.getElementById('newsPublishedAt')?.value || '').trim();
                    const payload = {
                        title: document.getElementById('newsTitle').value.trim(),
                        excerpt: document.getElementById('newsExcerpt').value.trim(),
                        content: document.getElementById('newsContent').value.trim(),
                        is_published: document.getElementById('newsPublished').checked,
                        image_url: imageUrl || null,
                        youtube_url: (document.getElementById('newsYoutubeUrl')?.value || '').trim() || null,
                        published_at: publishedAtInput || null,
                    };
                    const url = id ? `${apiBase}/org/news/${id}` : `${apiBase}/org/news`;
                    const method = id ? 'PUT' : 'POST';
                    const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
                    const newsSaveJson = await r.json().catch(() => ({}));
                    if (!r.ok) { alert(newsSaveJson.message || newsSaveJson.error || 'Opslaan mislukt'); return; }
                    overlay.remove();
                    loadNews();
                });
            }
        };
        load();
        document.body.appendChild(overlay);
    }

    async function deleteOrgEvent(evId, encodedTitle) {
        const title = encodedTitle ? decodeURIComponent(encodedTitle) : 'dit evenement';
        if (!confirm(`Weet je zeker dat je "${title}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
        try {
            const r = await fetch(`${apiBase}/org/events/${evId}`, { method: 'DELETE', headers: authHeaders() });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) {
                alert(j.message || j.error || 'Verwijderen mislukt');
                return;
            }
            loadEvents();
        } catch (err) {
            alert(err.message || 'Verwijderen mislukt');
        }
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
                ? `<table class="data-table"><thead><tr><th>Titel</th><th>Datum</th><th>Locatie</th><th class="cell-actions">Acties</th></tr></thead><tbody>${
                    list.map(e => `<tr>
                        <td>${escapeHtml(e.title || '')}</td>
                        <td>${e.event_date ? new Date(e.event_date).toLocaleDateString('nl-NL') : '-'}</td>
                        <td>${escapeHtml(e.location || '-')}</td>
                        <td class="cell-actions">
                            <div class="action-buttons">
                                <button type="button" class="btn-icon btn-view" data-view-event="${e.id}" title="Bekijken" aria-label="Bekijken"><i class="fas fa-eye"></i></button>
                                <button type="button" class="btn-icon btn-edit" data-edit-event="${e.id}" title="Bewerken" aria-label="Bewerken"><i class="fas fa-edit"></i></button>
                                <button type="button" class="btn-icon btn-delete" data-delete-event="${e.id}" data-event-title="${encodeURIComponent(e.title || '')}" title="Verwijderen" aria-label="Verwijderen"><i class="fas fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>`).join('')
                }</tbody></table>`
                : '<p class="empty-message">Nog geen evenementen.</p>';
            container.querySelectorAll('[data-view-event]').forEach(b => {
                b.addEventListener('click', () => openEventModal(parseInt(b.getAttribute('data-view-event'), 10), 'view'));
            });
            container.querySelectorAll('[data-edit-event]').forEach(b => {
                b.addEventListener('click', () => openEventModal(parseInt(b.getAttribute('data-edit-event'), 10), 'edit'));
            });
            container.querySelectorAll('[data-delete-event]').forEach(b => {
                b.addEventListener('click', () => {
                    const id = parseInt(b.getAttribute('data-delete-event'), 10);
                    const t = b.getAttribute('data-event-title') || '';
                    deleteOrgEvent(id, t);
                });
            });
        } catch (e) {
            container.innerHTML = `<p class="empty-message">Fout: ${e.message}</p>`;
        }
    }

    document.getElementById('addEventBtn')?.addEventListener('click', () => openEventModal(null, 'edit'));

    /**
     * Zet een datum-string (MySQL "YYYY-MM-DD HH:MM:SS" of ISO met Z) om naar
     * een waarde voor <input type="datetime-local"> ZONDER UTC-conversie.
     * Evenementtijden worden als naïeve lokale Amsterdam-tijd behandeld.
     */
    function toDatetimeInputValue(val) {
        if (!val) return '';
        return String(val).replace(' ', 'T').replace(/Z$/, '').replace(/\+\d{2}:\d{2}$/, '').slice(0, 16);
    }

    /**
     * Kalenderdag als YYYY-MM-DD (zelfde logica voor datetime-local en API-datums).
     * Begint de string met een datum, dan die eerste 10 tekens (voorkomt timezone-shift).
     */
    function calendarDayKey(val) {
        if (val == null || val === '') return null;
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function otherEventsOnSameCalendarDay(allEvents, dayKey, excludeId) {
        if (!dayKey || !Array.isArray(allEvents) || !allEvents.length) return [];
        return allEvents.filter((ev) => {
            if (excludeId != null && Number(ev.id) === Number(excludeId)) return false;
            const k = calendarDayKey(ev.event_date);
            return k === dayKey;
        });
    }

    function refreshEventSameDayWarning(allEvents, excludeId) {
        const box = document.getElementById('eventSameDayWarning');
        const dateInput = document.getElementById('eventDate');
        if (!box || !dateInput) return;
        // Gebruik ook de einddatuminput als datetime-local nog geen volledige waarde heeft
        const rawVal = dateInput.value || document.getElementById('eventEndDate')?.value || '';
        const dayKey = calendarDayKey(rawVal);
        const others = otherEventsOnSameCalendarDay(allEvents, dayKey, excludeId);
        if (!others.length) {
            box.hidden = true;
            box.style.display = '';
            box.textContent = '';
            return;
        }
        const nameList = others.map((e) => {
            const org = e.organization_name ? ` (${escapeHtml(e.organization_name)})` : '';
            return '<em>' + escapeHtml(e.title || 'Zonder titel') + '</em>' + org;
        }).join(', ');
        box.hidden = false;
        box.style.display = 'block';
        box.innerHTML =
            '⚠️ <strong>LET OP:</strong> er staat op <strong>deze dag</strong> al een evenement in de agenda: ' +
            nameList +
            '. Je kunt dit evenement gewoon opslaan — kies bewust of je liever een andere dag pakt om meer bezoekers te trekken.';
    }

    function openEventModal(id, mode = 'edit') {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        const isView = mode === 'view';
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
            const titleHtml = isView ? 'Evenement bekijken' : event ? 'Evenement bewerken' : 'Nieuw evenement';
            const ro = isView ? 'readonly' : '';
            const dis = isView ? 'disabled' : '';
            const imageEditable = !isView
                ? `${evImg}
                            <input type="file" id="eventImageFile" accept="image/*">
                            <p class="form-hint">Optioneel, max. 9 MB.</p>
                            <label style="margin-top:8px;display:block">Of URL</label>
                            <input type="url" id="eventImageUrlInput" placeholder="https://..." value="${escapeHtml(event?.image_url || '')}">`
                : (evImg || '<p class="form-hint">Geen afbeelding</p>');
            overlay.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${titleHtml}</h3>
                        <button type="button" class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>Titel</label>
                            <input type="text" id="eventTitle" value="${escapeHtml(event?.title || '')}" ${ro}>
                        </div>
                        <div class="form-group">
                            <label>Beschrijving</label>
                            <textarea id="eventDescription" rows="3" ${ro}>${escapeHtml(event?.description || '')}</textarea>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Begindatum &amp; -tijd *</label>
                                <input type="datetime-local" id="eventDate" value="${event?.event_date ? toDatetimeInputValue(event.event_date) : ''}" ${dis}>
                                <div id="eventSameDayWarning" class="event-same-day-warning" hidden role="status" aria-live="polite"></div>
                            </div>
                            <div class="form-group">
                                <label>Einddatum &amp; -tijd</label>
                                <input type="datetime-local" id="eventEndDate" value="${event?.event_end_date ? toDatetimeInputValue(event.event_end_date) : ''}" ${dis}>
                                <p class="form-hint">Leeg laten voor eendaags evenement.</p>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Locatie</label>
                                <input type="text" id="eventLocation" value="${escapeHtml(event?.location || '')}" ${ro}>
                            </div>
                            <div class="form-group">
                                <label>Prijs</label>
                                <input type="number" id="eventPrice" min="0" step="0.01" placeholder="0.00 = gratis" value="${event?.price != null ? event.price : ''}" ${ro}>
                                <p class="form-hint">Leeg laten of 0 = gratis toegang.</p>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Afbeelding</label>
                            ${imageEditable}
                        </div>
                    </div>
                    <div class="modal-footer">
                        ${isView
                            ? '<button type="button" class="btn btn-primary modal-close-btn">Sluiten</button>'
                            : '<button type="button" class="btn btn-secondary modal-close-btn">Annuleren</button>\n                        <button type="button" class="btn btn-primary" id="eventSaveBtn">Opslaan</button>'}
                    </div>
                </div>`;
            overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
            overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());

            // Haal ALLE events van ALLE organisaties op voor de overlap-check.
            // Gebruik de publieke /api/events route (geen auth vereist, max 500 items).
            let allOrgEvents = [];
            try {
                const allRes = await fetch(`${apiBase}/events?limit=500`);
                if (allRes.ok) allOrgEvents = (await allRes.json()).events || [];
            } catch (e) { /* geen melding; waarschuwing werkt dan niet */ }

            const dateInputEl = document.getElementById('eventDate');
            const endDateInputEl = document.getElementById('eventEndDate');
            const runSameDayCheck = () => refreshEventSameDayWarning(allOrgEvents, id);
            if (!isView && dateInputEl) {
                dateInputEl.addEventListener('input', runSameDayCheck);
                dateInputEl.addEventListener('change', runSameDayCheck);
                if (endDateInputEl) {
                    endDateInputEl.addEventListener('input', runSameDayCheck);
                    endDateInputEl.addEventListener('change', runSameDayCheck);
                }
                runSameDayCheck();
            }

            if (!isView) {
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
                    const rawEndDate = document.getElementById('eventEndDate')?.value || '';
                    const rawPrice = document.getElementById('eventPrice')?.value || '';
                    const payload = {
                        title: document.getElementById('eventTitle').value.trim(),
                        description: document.getElementById('eventDescription').value.trim(),
                        event_date: document.getElementById('eventDate').value || null,
                        event_end_date: rawEndDate || null,
                        location: document.getElementById('eventLocation').value.trim() || null,
                        price: rawPrice !== '' ? parseFloat(rawPrice) : null,
                        image_url: imageUrl || null
                    };
                    const url = id ? `${apiBase}/org/events/${id}` : `${apiBase}/org/events`;
                    const method = id ? 'PUT' : 'POST';
                    const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
                    const evSaveJson = await r.json().catch(() => ({}));
                    if (!r.ok) { alert(evSaveJson.message || evSaveJson.error || 'Opslaan mislukt'); return; }
                    overlay.remove();
                    loadEvents();
                });
            }
        };
        load();
        document.body.appendChild(overlay);
    }

    function profileBrandPickerDefault(brandColor) {
        const s = (brandColor && String(brandColor).trim()) || '';
        return /^#[0-9A-Fa-f]{6}$/i.test(s) ? s : '#0f46ae';
    }

    async function loadProfile() {
        const root = document.getElementById('profileForm');
        if (!root) return;
        try {
            const res = await fetch(`${apiBase}/org/profile`, { headers: authHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Profiel laden mislukt');
            const org = data.organization || {};
            const brandVal = profileBrandPickerDefault(org.brand_color);
            const logoBlock = org.logo_url
                ? `<p style="margin:0 0 8px"><img src="${escapeHtml(org.logo_url)}" alt="Logo" style="max-height:100px;border-radius:8px;border:1px solid #e8ecf4"></p>`
                : '<p class="form-hint">Nog geen logo.</p>';
            root.innerHTML = `
                <p class="form-hint" style="margin-bottom:1.25rem;">Dezelfde gegevens als in het beheerderspaneel (behalve <strong>goedkeuring</strong> — dat blijft bij de beheerder).</p>

                <h3 class="profile-subheading">Basis</h3>
                <div class="form-group">
                    <label for="profile_name">Naam *</label>
                    <input type="text" id="profile_name" required maxlength="255" value="${escapeHtml(org.name || '')}">
                </div>
                <div class="form-group">
                    <label for="profile_category">Categorie</label>
                    <input type="text" id="profile_category" maxlength="120" placeholder="bijv. Muziek, Vereniging" value="${escapeHtml(org.category || '')}">
                </div>
                <div class="form-group">
                    <label for="profile_description">Beschrijving</label>
                    <textarea id="profile_description" rows="3" placeholder="Korte beschrijving">${escapeHtml(org.description || '')}</textarea>
                </div>
                <div class="form-group">
                    <label for="profile_bio">Bio</label>
                    <textarea id="profile_bio" rows="2" placeholder="Optionele bio">${escapeHtml(org.bio || '')}</textarea>
                </div>

                <h3 class="profile-subheading">Contact &amp; website</h3>
                <div class="form-group">
                    <label for="profile_website">Website</label>
                    <input type="url" id="profile_website" placeholder="https://…" value="${escapeHtml(org.website || '')}">
                </div>
                <div class="form-group">
                    <label for="profile_email">E-mail (contact)</label>
                    <input type="email" id="profile_email" value="${escapeHtml(org.email || '')}" placeholder="Optioneel">
                    <label class="checkbox-label" style="margin-top:6px;font-size:0.85rem;">
                        <input type="checkbox" id="profile_show_email" ${org.show_email !== false ? 'checked' : ''}>
                        Toon e-mailadres publiek in de app
                    </label>
                    <small class="text-muted">Als je dit uitschakelt, sla je het e-mailadres intern op maar is het niet zichtbaar voor bezoekers.</small>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="profile_phone">Telefoon</label>
                        <input type="text" id="profile_phone" value="${escapeHtml(org.phone || '')}">
                    </div>
                    <div class="form-group">
                        <label for="profile_whatsapp">WhatsApp</label>
                        <input type="text" id="profile_whatsapp" placeholder="Nummer of link" value="${escapeHtml(org.whatsapp || '')}">
                    </div>
                </div>
                <div class="form-group">
                    <label for="profile_address">Adres</label>
                    <input type="text" id="profile_address" value="${escapeHtml(org.address || '')}">
                </div>

                <h3 class="profile-subheading">Social media</h3>
                <div class="form-row">
                    <div class="form-group">
                        <label for="profile_facebook">Facebook</label>
                        <input type="url" id="profile_facebook" placeholder="https://…" value="${escapeHtml(org.facebook || '')}">
                    </div>
                    <div class="form-group">
                        <label for="profile_instagram">Instagram</label>
                        <input type="url" id="profile_instagram" placeholder="https://…" value="${escapeHtml(org.instagram || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="profile_twitter">X / Twitter</label>
                        <input type="url" id="profile_twitter" placeholder="https://…" value="${escapeHtml(org.twitter || '')}">
                    </div>
                    <div class="form-group">
                        <label for="profile_linkedin">LinkedIn</label>
                        <input type="url" id="profile_linkedin" placeholder="https://…" value="${escapeHtml(org.linkedin || '')}">
                    </div>
                </div>

                <h3 class="profile-subheading">Huisstijl</h3>
                <div class="form-group">
                    <label for="profile_brand_color_hex">Brandkleur (hex)</label>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                        <input type="color" id="profile_brand_color_picker" value="${escapeHtml(brandVal)}" style="width:48px;height:40px;padding:0;border:1px solid #ddd;border-radius:6px;cursor:pointer;" title="Kies kleur">
                        <input type="text" id="profile_brand_color_hex" placeholder="#RRGGBB" style="flex:1;min-width:140px;" value="${escapeHtml((org.brand_color && String(org.brand_color).trim()) || '')}">
                    </div>
                    <p class="form-hint">Wordt o.a. in de app gebruikt bij jullie organisatie.</p>
                </div>
                <div class="form-group">
                    <label>Logo</label>
                    ${logoBlock}
                    <input type="file" id="profileLogoFile" accept="image/*">
                    <p class="form-hint">Nieuw bestand uploaden: kies afbeelding (max. 9 MB) en klik bovenaan op Opslaan.</p>
                    <label style="margin-top:10px;display:block">Of logo-URL</label>
                    <input type="url" id="profile_logo_url" placeholder="https://…" value="${escapeHtml(org.logo_url || '')}">
                </div>

                <h3 class="profile-subheading"><i class="fas fa-shield-alt" style="margin-right:6px;"></i>Privacy statement</h3>
                <div class="form-group">
                    <label for="profile_privacy_statement">Tekst voor in de app</label>
                    <textarea id="profile_privacy_statement" rows="6" placeholder="Optioneel">${escapeHtml(org.privacy_statement || '')}</textarea>
                </div>

                <h3 class="profile-subheading">Account (dashboard-inlog)</h3>
                <p class="form-hint" style="margin-bottom:1rem;">Wachtwoord voor <strong>dit dashboard</strong>, los van het contact-e-mailadres hierboven.</p>
                <div class="form-group">
                    <label for="accountCurrentPassword">Huidig wachtwoord</label>
                    <input type="password" id="accountCurrentPassword" autocomplete="current-password">
                </div>
                <div class="form-group">
                    <label for="accountNewPassword">Nieuw wachtwoord</label>
                    <input type="password" id="accountNewPassword" autocomplete="new-password" minlength="6" placeholder="Minimaal 6 tekens">
                </div>
                <div class="form-group">
                    <label for="accountNewPassword2">Nieuw wachtwoord (herhalen)</label>
                    <input type="password" id="accountNewPassword2" autocomplete="new-password" minlength="6">
                </div>
                <button type="button" class="btn btn-secondary" id="changeAccountPasswordBtn"><i class="fas fa-key"></i> Alleen wachtwoord wijzigen</button>
                <p id="accountPasswordMsg" class="form-hint" style="margin-top:0.75rem;display:none;" aria-live="polite"></p>`;

            const picker = document.getElementById('profile_brand_color_picker');
            const hexEl = document.getElementById('profile_brand_color_hex');
            if (picker && hexEl) {
                picker.addEventListener('input', () => {
                    hexEl.value = picker.value.toUpperCase();
                });
                hexEl.addEventListener('change', () => {
                    const v = hexEl.value.trim();
                    if (/^#[0-9A-Fa-f]{6}$/i.test(v)) picker.value = v;
                });
            }
        } catch (e) {
            root.innerHTML = `<p class="empty-message">Fout: ${escapeHtml(e.message)}</p>`;
        }
        document.getElementById('changeAccountPasswordBtn')?.addEventListener('click', onChangeAccountPasswordClick);
    }

    async function onChangeAccountPasswordClick() {
        const msgEl = document.getElementById('accountPasswordMsg');
        const setMsg = (text, isError) => {
            if (!msgEl) return;
            msgEl.textContent = text;
            msgEl.style.display = text ? 'block' : 'none';
            msgEl.style.color = isError ? '#b00020' : '#1a6b1a';
        };
        setMsg('', false);
        const cur = document.getElementById('accountCurrentPassword')?.value || '';
        const n1 = document.getElementById('accountNewPassword')?.value || '';
        const n2 = document.getElementById('accountNewPassword2')?.value || '';
        if (!cur) {
            setMsg('Vul je huidige wachtwoord in.', true);
            return;
        }
        if (n1.length < 6) {
            setMsg('Nieuw wachtwoord: minimaal 6 tekens.', true);
            return;
        }
        if (n1 !== n2) {
            setMsg('De twee nieuwe wachtwoorden komen niet overeen.', true);
            return;
        }
        const btn = document.getElementById('changeAccountPasswordBtn');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(`${apiBase}/org/me/password`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify({ current_password: cur, new_password: n1 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || data.message || 'Wijzigen mislukt');
            }
            setMsg(data.message || 'Wachtwoord bijgewerkt.', false);
            const c = document.getElementById('accountCurrentPassword');
            const a = document.getElementById('accountNewPassword');
            const b = document.getElementById('accountNewPassword2');
            if (c) c.value = '';
            if (a) a.value = '';
            if (b) b.value = '';
        } catch (err) {
            setMsg(err.message || 'Netwerkfout', true);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('saveProfileBtn');
        const name = document.getElementById('profile_name')?.value?.trim() || '';
        if (!name) {
            alert('Vul een organisatienaam in.');
            return;
        }
        const hexRaw = document.getElementById('profile_brand_color_hex')?.value?.trim() || '';
        const brand_color = /^#[0-9A-Fa-f]{6}$/i.test(hexRaw) ? hexRaw : undefined;

        let logo_url = (document.getElementById('profile_logo_url')?.value || '').trim();
        const logoFile = document.getElementById('profileLogoFile')?.files?.[0];
        if (logoFile) {
            if (btn) { btn.disabled = true; btn.textContent = 'Logo uploaden…'; }
            try {
                logo_url = await uploadImageFile(logoFile);
            } catch (err) {
                alert(err.message || 'Logo-upload mislukt');
                if (btn) { btn.disabled = false; btn.textContent = 'Opslaan'; }
                return;
            }
            if (btn) { btn.disabled = false; btn.textContent = 'Opslaan'; }
        } else if (logo_url === '') {
            logo_url = null;
        }

        const norm = (id) => {
            const el = document.getElementById(id);
            if (!el) return undefined;
            const t = el.value != null ? String(el.value).trim() : '';
            return t === '' ? null : t;
        };

        const payload = {
            name,
            category: norm('profile_category'),
            description: norm('profile_description'),
            bio: norm('profile_bio'),
            website: norm('profile_website'),
            email: norm('profile_email'),
            show_email: document.getElementById('profile_show_email')?.checked !== false,
            phone: norm('profile_phone'),
            whatsapp: norm('profile_whatsapp'),
            address: norm('profile_address'),
            facebook: norm('profile_facebook'),
            instagram: norm('profile_instagram'),
            twitter: norm('profile_twitter'),
            linkedin: norm('profile_linkedin'),
            privacy_statement: norm('profile_privacy_statement'),
        };
        if (brand_color !== undefined) payload.brand_color = brand_color;
        if (logo_url !== undefined) payload.logo_url = logo_url;

        if (btn) { btn.disabled = true; btn.textContent = 'Opslaan…'; }
        try {
            const r = await fetch(`${apiBase}/org/profile`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                alert(data.message || data.error || 'Opslaan mislukt');
                return;
            }
            alert('Opgeslagen.');
            organization = data.organization;
            if (userInfo) userInfo.textContent = organization?.name || currentUser?.email;
            loadProfile();
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Opslaan'; }
        }
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
