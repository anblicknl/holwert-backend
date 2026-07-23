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

    const NEWS_CATEGORIES = [
        { id: 'dorpsnieuws', label: 'Dorpsnieuws' },
        { id: 'sport', label: 'Sport' },
        { id: 'cultuur', label: 'Cultuur' },
        { id: 'onderwijs', label: 'Onderwijs' },
        { id: 'zorg', label: 'Zorg' },
        { id: 'overig', label: 'Overig' },
    ];

    const ORG_CATEGORIES = [
        { id: 'vereniging', label: 'Vereniging' },
        { id: 'stichting', label: 'Stichting' },
        { id: 'gemeente', label: 'Gemeente' },
        { id: 'dorpsbelang', label: 'Dorpsbelang' },
        { id: 'activiteiten', label: 'Activiteiten' },
        { id: 'sport', label: 'Sport' },
        { id: 'cultuur', label: 'Cultuur' },
        { id: 'muziek', label: 'Muziek' },
        { id: 'onderwijs', label: 'Onderwijs' },
        { id: 'zorg', label: 'Zorg' },
        { id: 'welzijn', label: 'Welzijn' },
        { id: 'natuur', label: 'Natuur' },
        { id: 'kerk', label: 'Kerk' },
        { id: 'ondernemer', label: 'Onderneming' },
        { id: 'horeca', label: 'Horeca' },
        { id: 'overig', label: 'Overig' },
    ].sort((a, b) => a.label.localeCompare(b.label, 'nl'));

    const NEWS_SHARE_BASE_URL = 'https://holwert.appenvloed.com/app-link/';
    /** Publieke pagina met Open Graph op eigen domein — voor Facebook-deelvenster */
    const NEWS_PUBLIC_SHARE_BASE_URL = 'https://holwert.appenvloed.com/nieuws/';

    function getNewsShareUrl(newsId) {
        return `${NEWS_SHARE_BASE_URL}?t=news&id=${Number(newsId)}`;
    }

    function getNewsPublicShareUrl(newsId) {
        return `${NEWS_PUBLIC_SHARE_BASE_URL}${Number(newsId)}`;
    }

    function stripHtmlForShareText(html, maxLen = 300) {
        if (!html) return '';
        let text = String(html)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (maxLen > 0 && text.length > maxLen) {
            text = text.slice(0, maxLen).replace(/\s+\S*$/, '').trim();
            if (text) text += '…';
        }
        return text;
    }

    function buildFacebookShareMessage(title, content, shareUrl) {
        const parts = [];
        const heading = (title || '').trim();
        const preview = stripHtmlForShareText(content, 300);
        if (heading) parts.push(heading);
        if (preview) parts.push(preview);
        if (shareUrl) parts.push(`Lees meer: ${shareUrl}`);
        return parts.join('\n\n');
    }

    async function openFacebookShareForNews(newsId, title, content) {
        const id = Number(newsId);
        if (!Number.isFinite(id) || id <= 0) {
            alert('Kon geen geldige link voor dit bericht maken. Probeer opnieuw of deel later via de app.');
            return;
        }
        const shareUrl = getNewsPublicShareUrl(id);
        const message = buildFacebookShareMessage(title, content, shareUrl);
        if (message) {
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(message);
                }
            } catch (_) { /* klembord optioneel */ }
        }
        const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
        window.open(fbUrl, 'holwert-facebook-share', 'width=580,height=460,noopener,noreferrer');
        alert(message
            ? 'Facebook is geopend.\n\nTitel en inhoud staan op je klembord — plak die in het berichtveld (Ctrl+V / ⌘V). De link preview verschijnt eronder vanzelf.'
            : 'Facebook is geopend met de link preview van dit bericht.');
    }

    function syncNewsFacebookShareField(root) {
        const scope = root || document;
        const pub = scope.querySelector('#newsPublished');
        const fb = scope.querySelector('#newsShareFacebook');
        if (!pub || !fb) return;
        const enabled = pub.checked;
        fb.disabled = !enabled;
        if (!enabled) fb.checked = false;
    }

    function populateOrgRegistrationCategorySelect() {
        const sel = document.getElementById('org_reg_category');
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = ORG_CATEGORIES.map((c) =>
            `<option value="${c.id}">${c.label}</option>`
        ).join('');
        sel.value = prev && ORG_CATEGORIES.some((c) => c.id === prev) ? prev : 'vereniging';
    }

    function resolveOrgCategoryId(raw) {
        const s = (raw || '').trim();
        if (!s) return 'vereniging';
        const lower = s.toLowerCase();
        const byId = ORG_CATEGORIES.find((c) => c.id === lower);
        if (byId) return byId.id;
        const byLabel = ORG_CATEGORIES.find((c) => c.label.toLowerCase() === lower);
        if (byLabel) return byLabel.id;
        for (const c of ORG_CATEGORIES) {
            if (lower.includes(c.id) || lower.includes(c.label.toLowerCase())) return c.id;
        }
        return 'overig';
    }

    function orgCategoryLabel(raw) {
        const id = resolveOrgCategoryId(raw);
        const found = ORG_CATEGORIES.find((c) => c.id === id);
        return found ? found.label : 'Overig';
    }

    function orgCategorySelectHtml(selectId, rawSelected) {
        const selected = resolveOrgCategoryId(rawSelected);
        return `<select id="${selectId}">${ORG_CATEGORIES.map((c) =>
            `<option value="${c.id}"${selected === c.id ? ' selected' : ''}>${c.label}</option>`
        ).join('')}</select>`;
    }

    function syncNewsCustomCategoryField() {
        const select = document.getElementById('newsCategory');
        const group = document.getElementById('newsCustomCategoryGroup');
        if (!select || !group) return;
        group.style.display = select.value === 'overig' ? 'block' : 'none';
    }

    function newsCategoryLabel(category, customCategory) {
        const cat = (category || '').trim();
        const custom = (customCategory || '').trim();
        if (cat === 'overig' && custom) return custom;
        const found = NEWS_CATEGORIES.find((c) => c.id === cat);
        if (found) return found.label;
        if (custom) return custom;
        return 'Dorpsnieuws';
    }

    /** Eerste woorden uit artikel-inhoud (geen aparte samenvatting meer). */
    function newsContentPreview(content, maxLen = 100) {
        if (!content) return '';
        const text = String(content)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) return '';
        return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
    }

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
                    'Als dit adres bekend is, ontvang je een e-mail. Het kan enkele minuten duren — controleer ook je spam-map.';
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

    /** PDF via backend (organisatiemap uit JWT). */
    async function uploadPdfFile(file) {
        if (!file) return null;
        if (file.type && file.type !== 'application/pdf') {
            throw new Error('Alleen PDF-bestanden zijn toegestaan.');
        }
        if (file.size > 15 * 1024 * 1024) {
            throw new Error('PDF is te groot (max 15 MB).');
        }
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        const r = await fetch(`${apiBase}/upload/file`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                fileData: base64,
                filename: file.name || `document-${Date.now()}.pdf`,
                mimeType: 'application/pdf',
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
            throw new Error(j.message || j.error || 'PDF upload mislukt');
        }
        if (!j.fileUrl) throw new Error('Geen PDF-URL van server');
        return j.fileUrl;
    }

    function pdfAttachmentControlsHtml(pdfUrl, flagId) {
        if (!pdfUrl) return '';
        return `
            <input type="hidden" id="${flagId}" class="js-pdf-remove-flag" value="0">
            <div class="js-pdf-current" style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
                <small>Huidige PDF: <a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener">bekijken</a></small>
                <button type="button" class="btn btn-sm btn-danger js-pdf-remove-btn">Verwijder PDF</button>
            </div>
            <p class="form-hint js-pdf-marked" hidden style="margin-top:6px;color:#c0304f;">
                PDF wordt verwijderd bij opslaan.
                <button type="button" class="btn btn-sm btn-secondary js-pdf-undo-btn">Ongedaan maken</button>
            </p>
        `;
    }

    function wirePdfRemoveControl(scope) {
        const root = scope?.querySelector ? scope : document;
        root.querySelectorAll('.form-group').forEach((group) => {
            const flag = group.querySelector('.js-pdf-remove-flag');
            const btn = group.querySelector('.js-pdf-remove-btn');
            if (!flag || !btn || btn.dataset.wired) return;
            btn.dataset.wired = '1';
            const current = group.querySelector('.js-pdf-current');
            const marked = group.querySelector('.js-pdf-marked');
            const undo = group.querySelector('.js-pdf-undo-btn');
            const fileInput = group.querySelector('input[type="file"][accept*="pdf"]');
            btn.addEventListener('click', () => {
                flag.value = '1';
                if (current) current.hidden = true;
                if (marked) marked.hidden = false;
                if (fileInput) fileInput.value = '';
            });
            undo?.addEventListener('click', () => {
                flag.value = '0';
                if (current) current.hidden = false;
                if (marked) marked.hidden = true;
            });
            fileInput?.addEventListener('change', () => {
                if (fileInput.files?.[0]) {
                    flag.value = '0';
                    if (current) current.hidden = false;
                    if (marked) marked.hidden = true;
                }
            });
        });
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
            loadOverview();
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
            navigateToSection(el.getAttribute('data-section'));
        });
    });

    function initSidebarToggle() {
        const toggle = document.getElementById('sidebarToggle');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (!mainScreen || !toggle) return;

        const mq = window.matchMedia('(max-width: 768px)');

        const setOpen = (open) => {
            mainScreen.classList.toggle('sidebar-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? 'Menu sluiten' : 'Menu openen');
            if (backdrop) backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
            document.body.style.overflow = open && mq.matches ? 'hidden' : '';
        };

        const close = () => setOpen(false);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(!mainScreen.classList.contains('sidebar-open'));
        });

        if (backdrop) backdrop.addEventListener('click', close);

        document.querySelectorAll('.nav-item[data-section]').forEach((el) => {
            el.addEventListener('click', () => {
                if (mq.matches) close();
            });
        });

        window.addEventListener('resize', () => {
            if (!mq.matches) close();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mainScreen.classList.contains('sidebar-open')) close();
        });
    }

    initSidebarToggle();

    function followersSeenStorageKey(orgId) {
        return `holwert_followers_seen_${orgId}`;
    }

    function getSeenFollowersCount(orgId) {
        if (!orgId) return null;
        const stored = localStorage.getItem(followersSeenStorageKey(orgId));
        if (stored != null) return parseInt(stored, 10) || 0;
        const legacy = localStorage.getItem(`holwert_followers_${orgId}`);
        if (legacy != null) return parseInt(legacy, 10) || 0;
        return null;
    }

    function setSeenFollowersCount(orgId, count) {
        if (!orgId) return;
        localStorage.setItem(followersSeenStorageKey(orgId), String(count));
    }

    function updateFollowersNavDot(currentCount) {
        const orgId = organization?.id;
        const dot = document.getElementById('followersNavDot');
        const navItem = document.querySelector('.nav-item[data-section="followers"]');
        if (!orgId || !dot) return;

        let seen = getSeenFollowersCount(orgId);
        if (seen === null) {
            setSeenFollowersCount(orgId, currentCount);
            seen = currentCount;
        }

        const hasNew = currentCount > seen;
        dot.hidden = !hasNew;
        if (navItem) {
            navItem.setAttribute('title', hasNew ? 'Nieuwe volgers' : '');
        }
    }

    function markFollowersAsSeen(currentCount) {
        const orgId = organization?.id;
        if (!orgId) return;
        setSeenFollowersCount(orgId, currentCount);
        updateFollowersNavDot(currentCount);
    }

    function navigateToSection(sectionId) {
        if (!sectionId) return;
        document.querySelectorAll('.nav-item').forEach(n => {
            n.classList.toggle('active', n.getAttribute('data-section') === sectionId);
        });
        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
        const section = document.getElementById(sectionId);
        if (section) section.classList.add('active');
        if (sectionId === 'followers') loadFollowers();
        if (sectionId === 'overview') loadOverview();
        if (sectionId === 'profile-blocks') loadProfileBlocks();
    }

    async function loadFollowers() {
        const container = document.getElementById('followersContent');
        if (!container) return;
        container.innerHTML = '<p class="form-hint" style="padding:1rem">Volgers laden…</p>';
        try {
            const res = await fetch(`${apiBase}/org/followers?limit=500`, { headers: authHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || data.error || 'Laden mislukt');

            const list = Array.isArray(data.followers) ? data.followers : [];
            const count = data.count ?? list.length;

            markFollowersAsSeen(count);

            if (!list.length) {
                container.innerHTML = `
                    <p class="form-hint followers-privacy-hint">Nog niemand volgt jullie organisatie in de app. Zodra inwoners op «volgen» tikken, verschijnen ze hier (alleen voornaam).</p>
                    <p class="empty-message">0 volgers</p>`;
                return;
            }

            container.innerHTML = `
                <p class="form-hint followers-privacy-hint">${count} volger${count === 1 ? '' : 's'} in de app. We tonen alleen voornaam en sinds wanneer iemand volgt — geen e-mailadressen.</p>
                <ul class="followers-list">
                    ${list.map((f) => {
                        const name = (f.first_name && String(f.first_name).trim()) || 'App-gebruiker';
                        const since = f.followed_at
                            ? new Date(f.followed_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
                            : '—';
                        return `<li class="followers-list-item">
                            <span class="followers-list-name"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(name)}</span>
                            <span class="followers-list-since">Volgt sinds ${escapeHtml(since)}</span>
                        </li>`;
                    }).join('')}
                </ul>`;
        } catch (err) {
            container.innerHTML = `<p class="form-hint" style="padding:1rem;color:#c00">Kon volgers niet laden: ${escapeHtml(err.message || 'onbekende fout')}</p>`;
        }
    }

    async function loadNews() {
        const container = document.getElementById('newsList');
        if (!container) return;
        try {
            const res = await fetch(`${apiBase}/org/news?limit=50&_=${Date.now()}`, {
                headers: authHeaders(),
                cache: 'no-store',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Laden mislukt');
            const list = data.news || [];
            container.innerHTML = list.length
                ? `<div class="desktop-view">
                    <table class="data-table"><thead><tr><th>Titel</th><th>Onderwerp</th><th>Status</th><th>Datum</th><th class="cell-actions">Acties</th></tr></thead><tbody>${
                    list.map(n => `<tr>
                        <td>${escapeHtml(n.title || '')}</td>
                        <td>${escapeHtml(newsCategoryLabel(n.category, n.custom_category))}</td>
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
                }</tbody></table>
                </div>
                <div class="mobile-cards-container mobile-view">${
                    list.map(n => {
                        const dateStr = n.published_at
                            ? new Date(n.published_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
                            : 'Geen datum';
                        const statusClass = n.is_published ? 'status-published' : 'status-draft';
                        const statusLabel = n.is_published ? 'Gepubliceerd' : 'Concept';
                        const category = escapeHtml(newsCategoryLabel(n.category, n.custom_category));
                        return `<div class="list-card">
                            <div class="list-card-title">${escapeHtml(n.title || '')}</div>
                            <div class="list-card-meta">
                                <span>${dateStr}</span>
                                <span class="list-card-meta-sep" aria-hidden="true">·</span>
                                <span>${category}</span>
                                <span class="list-card-meta-sep" aria-hidden="true">·</span>
                                <span class="list-card-status ${statusClass}">${statusLabel}</span>
                            </div>
                            <div class="list-card-actions">
                                <button type="button" class="btn-icon btn-view" data-preview-news="${n.id}" title="Preview" aria-label="Preview"><i class="fas fa-eye"></i></button>
                                <button type="button" class="btn-icon btn-edit" data-edit-news="${n.id}" title="Bewerken" aria-label="Bewerken"><i class="fas fa-edit"></i></button>
                                <button type="button" class="btn-icon btn-delete" data-delete-news="${n.id}" data-news-title="${encodeURIComponent(n.title || '')}" title="Verwijderen" aria-label="Verwijderen"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>`;
                    }).join('')
                }</div>`
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
            document.querySelector(`[data-delete-news="${newsId}"]`)?.closest('tr')?.remove();
            await loadNews();
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
            const editorToolbar = isPreview ? '' : '<div class="editor-toolbar"><button type="button" class="editor-btn" onclick="adminFormatText(\'newsContent\',\'bold\')" title="Vet"><b>B</b></button><button type="button" class="editor-btn" onclick="adminFormatText(\'newsContent\',\'italic\')" title="Cursief"><i>I</i></button><button type="button" class="editor-btn" onclick="adminFormatText(\'newsContent\',\'link\')" title="Link">&#128279;</button></div><small class="form-hint">Selecteer tekst en klik een knop om op te maken. De eerste regels verschijnen automatisch in het nieuwsoverzicht in de app.</small>';
            const publishedAtValue = article?.published_at
                ? toDatetimeInputValue(article.published_at)
                : '';
            const selectedCategory = article?.category || 'dorpsnieuws';
            const categoryFieldsHtml = !isPreview
                ? `<div class="form-group">
                        <label for="newsCategory">Onderwerp / categorie</label>
                        <select id="newsCategory">
                            ${NEWS_CATEGORIES.map((cat) => `<option value="${cat.id}" ${selectedCategory === cat.id ? 'selected' : ''}>${cat.label}</option>`).join('')}
                        </select>
                   </div>
                   <div class="form-group" id="newsCustomCategoryGroup" style="display:${selectedCategory === 'overig' ? 'block' : 'none'}">
                        <label for="newsCustomCategory">Eigen onderwerp</label>
                        <input type="text" id="newsCustomCategory" maxlength="100" placeholder="bijv. Jaarverslag, Weersverwachting" value="${escapeHtml(article?.custom_category || '')}">
                        <p class="form-hint">Wordt boven het artikel in de app getoond (alleen bij Overig).</p>
                   </div>`
                : `<div class="form-group">
                        <label>Onderwerp</label>
                        <p style="margin:0">${escapeHtml(newsCategoryLabel(article?.category, article?.custom_category))}</p>
                   </div>`;
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
                        ${categoryFieldsHtml}
                        <div class="form-group">
                            <label>Inhoud</label>
                            ${editorToolbar}
                            <textarea id="newsContent" rows="6" ${ro}>${escapeHtml(article?.content || '')}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Bronvermelding (optioneel)</label>
                            ${!isPreview
                                ? `<div style="display:flex;gap:10px;flex-wrap:wrap;">
                                       <div style="flex:1;min-width:140px;">
                                           <label style="font-size:0.82rem;color:#555;margin-bottom:3px;display:block;">Naam bron</label>
                                           <input type="text" id="newsSourceName" placeholder="bijv. NOS, Leeuwarder Courant…" value="${escapeHtml(article?.source_name || '')}">
                                       </div>
                                       <div style="flex:2;min-width:180px;">
                                           <label style="font-size:0.82rem;color:#555;margin-bottom:3px;display:block;">URL (link naar bron)</label>
                                           <input type="url" id="newsSourceUrl" placeholder="https://…" value="${escapeHtml(article?.source_url || '')}">
                                       </div>
                                   </div>
                                   <p class="form-hint">Wordt onder het artikel in de app getoond als &quot;Bron: …&quot; (zelfde als in /admin).</p>`
                                : (article?.source_name
                                    ? `<p style="margin:0">Bron: <a href="${escapeHtml(article.source_url || '#')}" target="_blank" rel="noopener">${escapeHtml(article.source_name)}</a></p>`
                                    : '<p class="form-hint">Geen bronvermelding ingesteld. Klik op <strong>Bewerken</strong> (potlood) om naam en URL toe te voegen.</p>')
                            }
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
                            <label>PDF-bijlage (optioneel)</label>
                            ${!isPreview
                                ? `<input type="file" id="newsPdfFile" accept="application/pdf,.pdf">
                                   <p class="form-hint">Wordt in de app als downloadlink onder het artikel getoond (max 15 MB).</p>
                                   ${pdfAttachmentControlsHtml(article?.pdf_url, 'newsPdfRemove')}`
                                : (article?.pdf_url
                                    ? `<a href="${escapeHtml(article.pdf_url)}" target="_blank" rel="noopener">PDF openen</a>`
                                    : '<p class="form-hint">Geen PDF</p>')
                            }
                        </div>
                        <div class="form-group">
                            <label><input type="checkbox" id="newsPublished" ${article?.is_published ? 'checked' : ''} ${dis}> Gepubliceerd</label>
                        </div>
                        ${!isPreview ? `<div class="form-group">
                            <label><input type="checkbox" id="newsShareFacebook" ${dis}> Na opslaan delen op Facebook</label>
                            <p class="form-hint">Opent Facebook met linkpreview van dit bericht. Titel en begin van de inhoud staan op je klembord om te plakken.</p>
                        </div>` : ''}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary modal-close-btn">${isPreview ? 'Sluiten' : 'Annuleren'}</button>
                        ${!isPreview ? '<button type="button" class="btn btn-primary" id="newsSaveBtn">Opslaan</button>' : ''}
                    </div>
                </div>`;
            overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
            overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
            wirePdfRemoveControl(overlay);
            const catSelect = overlay.querySelector('#newsCategory');
            if (catSelect) catSelect.addEventListener('change', syncNewsCustomCategoryField);
            syncNewsCustomCategoryField();
            const pubCheckbox = overlay.querySelector('#newsPublished');
            if (pubCheckbox) {
                pubCheckbox.addEventListener('change', () => syncNewsFacebookShareField(overlay));
                syncNewsFacebookShareField(overlay);
            }
            if (!isPreview) {
                overlay.querySelector('#newsSaveBtn').addEventListener('click', async () => {
                    const btn = overlay.querySelector('#newsSaveBtn');
                    const file = document.getElementById('newsImageFile')?.files?.[0];
                    let imageUrl = (document.getElementById('newsImageUrlInput')?.value || '').trim();
                    if (!imageUrl && article?.image_url) imageUrl = article.image_url;
                    let pdfUrl = article?.pdf_url || null;
                    const pdfFile = document.getElementById('newsPdfFile')?.files?.[0];
                    const removePdf = document.getElementById('newsPdfRemove')?.value === '1';
                    if (file || pdfFile) {
                        btn.disabled = true;
                        btn.textContent = 'Uploaden…';
                        try {
                            if (file) imageUrl = await uploadImageFile(file);
                            if (pdfFile) pdfUrl = await uploadPdfFile(pdfFile);
                        } catch (err) {
                            alert(err.message || 'Upload mislukt');
                            btn.disabled = false;
                            btn.textContent = 'Opslaan';
                            return;
                        }
                        btn.disabled = false;
                        btn.textContent = 'Opslaan';
                    } else if (removePdf) {
                        pdfUrl = null;
                    }
                    const publishedAtInput = (document.getElementById('newsPublishedAt')?.value || '').trim();
                    const category = document.getElementById('newsCategory')?.value || 'dorpsnieuws';
                    const custom_category = category === 'overig'
                        ? ((document.getElementById('newsCustomCategory')?.value || '').trim() || null)
                        : null;
                    const payload = {
                        title: document.getElementById('newsTitle').value.trim(),
                        content: document.getElementById('newsContent').value.trim(),
                        category,
                        custom_category,
                        is_published: document.getElementById('newsPublished').checked,
                        image_url: imageUrl || null,
                        youtube_url:  (document.getElementById('newsYoutubeUrl')?.value  || '').trim() || null,
                        source_name: (document.getElementById('newsSourceName')?.value || '').trim() || null,
                        source_url:  (document.getElementById('newsSourceUrl')?.value  || '').trim() || null,
                        pdf_url: pdfUrl,
                        published_at: publishedAtInput || null,
                    };
                    const url = id ? `${apiBase}/org/news/${id}` : `${apiBase}/org/news`;
                    const method = id ? 'PUT' : 'POST';
                    const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
                    const newsSaveJson = await r.json().catch(() => ({}));
                    if (!r.ok) { alert(newsSaveJson.message || newsSaveJson.error || 'Opslaan mislukt'); return; }
                    const shareOnFacebook = document.getElementById('newsShareFacebook')?.checked;
                    const isPublished = payload.is_published;
                    const savedId = newsSaveJson.article?.id || id;
                    overlay.remove();
                    loadNews();
                    if (isPublished && shareOnFacebook && savedId) {
                        openFacebookShareForNews(savedId, payload.title, payload.content);
                    }
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
                ? `<div class="desktop-view">
                    <table class="data-table"><thead><tr><th>Titel</th><th>Datum</th><th>Locatie</th><th class="cell-actions">Acties</th></tr></thead><tbody>${
                    list.map(e => `<tr>
                        <td>${escapeHtml(e.title || '')}</td>
                        <td>${e.event_date ? new Date(e.event_date).toLocaleDateString('nl-NL') : '-'}</td>
                        <td>${escapeHtml(e.location || '-')}</td>
                        <td class="cell-actions">
                            <div class="action-buttons">
                                <button type="button" class="btn-icon btn-view" data-view-event="${e.id}" title="Bekijken" aria-label="Bekijken"><i class="fas fa-eye"></i></button>
                                <button type="button" class="btn-icon btn-edit" data-edit-event="${e.id}" title="Bewerken" aria-label="Bewerken"><i class="fas fa-edit"></i></button>
                                <button type="button" class="btn-icon btn-secondary" data-duplicate-event="${e.id}" title="Dupliceren" aria-label="Dupliceren"><i class="fas fa-copy"></i></button>
                                <button type="button" class="btn-icon btn-delete" data-delete-event="${e.id}" data-event-title="${encodeURIComponent(e.title || '')}" title="Verwijderen" aria-label="Verwijderen"><i class="fas fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>`).join('')
                }</tbody></table>
                </div>
                <div class="mobile-cards-container mobile-view">${
                    list.map(e => {
                        const dateStr = e.event_date
                            ? new Date(e.event_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
                            : 'Geen datum';
                        const location = escapeHtml(e.location || 'Geen locatie');
                        return `<div class="list-card">
                            <div class="list-card-title">${escapeHtml(e.title || '')}</div>
                            <div class="list-card-meta">
                                <span>${dateStr}</span>
                                <span class="list-card-meta-sep" aria-hidden="true">·</span>
                                <span>${location}</span>
                            </div>
                            <div class="list-card-actions">
                                <button type="button" class="btn-icon btn-view" data-view-event="${e.id}" title="Bekijken" aria-label="Bekijken"><i class="fas fa-eye"></i></button>
                                <button type="button" class="btn-icon btn-edit" data-edit-event="${e.id}" title="Bewerken" aria-label="Bewerken"><i class="fas fa-edit"></i></button>
                                <button type="button" class="btn-icon btn-secondary" data-duplicate-event="${e.id}" title="Dupliceren" aria-label="Dupliceren"><i class="fas fa-copy"></i></button>
                                <button type="button" class="btn-icon btn-delete" data-delete-event="${e.id}" data-event-title="${encodeURIComponent(e.title || '')}" title="Verwijderen" aria-label="Verwijderen"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>`;
                    }).join('')
                }</div>`
                : '<p class="empty-message">Nog geen evenementen.</p>';
            container.querySelectorAll('[data-view-event]').forEach(b => {
                b.addEventListener('click', () => openEventModal(parseInt(b.getAttribute('data-view-event'), 10), 'view'));
            });
            container.querySelectorAll('[data-edit-event]').forEach(b => {
                b.addEventListener('click', () => openEventModal(parseInt(b.getAttribute('data-edit-event'), 10), 'edit'));
            });
            container.querySelectorAll('[data-duplicate-event]').forEach(b => {
                b.addEventListener('click', () => openEventModal(parseInt(b.getAttribute('data-duplicate-event'), 10), 'duplicate'));
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

    function applyEventDuplicateDefaults(event) {
        if (!event) return event;
        const baseTitle = String(event.title || '').trim();
        return {
            ...event,
            title:
                baseTitle && !/\(kopie\)\s*$/i.test(baseTitle)
                    ? `${baseTitle} (kopie)`
                    : baseTitle || 'Evenement (kopie)',
            event_date: null,
            event_end_date: null,
        };
    }

    function openEventModal(id, mode = 'edit') {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        const isView = mode === 'view';
        const isDuplicate = mode === 'duplicate';
        const saveId = isDuplicate ? null : id;
        const load = async () => {
            let event = null;
            if (id) {
                const r = await fetch(`${apiBase}/org/events/${id}`, { headers: authHeaders() });
                const d = await r.json();
                if (r.ok) event = d.event;
            }
            if (isDuplicate && event) {
                event = applyEventDuplicateDefaults(event);
            }
            const evImg = event?.image_url
                ? `<p style="margin:0 0 8px"><img src="${escapeHtml(event.image_url)}" alt="" style="max-height:120px;border-radius:6px"></p>`
                : '';
            const titleHtml = isView
                ? 'Evenement bekijken'
                : isDuplicate
                  ? 'Evenement dupliceren'
                  : event
                    ? 'Evenement bewerken'
                    : 'Nieuw evenement';
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
                                ${isDuplicate ? '<p class="form-hint">Vul een nieuwe begindatum in.</p>' : ''}
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
                        <div class="form-group">
                            <label>PDF-bijlage (optioneel)</label>
                            ${!isView
                                ? `<input type="file" id="eventPdfFile" accept="application/pdf,.pdf">
                                   <p class="form-hint">Downloadlink onder het evenement in de app (max 15 MB).</p>
                                   ${pdfAttachmentControlsHtml(event?.pdf_url, 'eventPdfRemove')}`
                                : (event?.pdf_url
                                    ? `<a href="${escapeHtml(event.pdf_url)}" target="_blank" rel="noopener">PDF openen</a>`
                                    : '<p class="form-hint">Geen PDF</p>')
                            }
                        </div>
                        <div class="form-group">
                            <label>Ticketlink (optioneel)</label>
                            ${!isView
                                ? `<input type="url" id="eventTicketUrl" placeholder="https://…" value="${escapeHtml(event?.ticket_url || '')}">
                                   <p class="form-hint">Wordt in de app een knop (bijv. ticketverkoop).</p>`
                                : (event?.ticket_url
                                    ? `<a href="${escapeHtml(event.ticket_url)}" target="_blank" rel="noopener">${escapeHtml(event.ticket_url)}</a>`
                                    : '<p class="form-hint">Geen ticketlink</p>')
                            }
                        </div>
                        <div class="form-group">
                            <label>Tekst ticketknop (optioneel)</label>
                            ${!isView
                                ? `<input type="text" id="eventTicketLabel" placeholder="Koop hier de tickets" value="${escapeHtml(event?.ticket_label || '')}">`
                                : `<p>${escapeHtml(event?.ticket_label || 'Koop hier de tickets')}</p>`
                            }
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
            wirePdfRemoveControl(overlay);

            // Haal ALLE events van ALLE organisaties op voor de overlap-check.
            // Gebruik de publieke /api/events route (geen auth vereist, max 500 items).
            let allOrgEvents = [];
            try {
                const allRes = await fetch(`${apiBase}/events?limit=500`);
                if (allRes.ok) allOrgEvents = (await allRes.json()).events || [];
            } catch (e) { /* geen melding; waarschuwing werkt dan niet */ }

            const dateInputEl = document.getElementById('eventDate');
            const endDateInputEl = document.getElementById('eventEndDate');
            const runSameDayCheck = () => refreshEventSameDayWarning(allOrgEvents, saveId);
            if (!isView && dateInputEl) {
                dateInputEl.addEventListener('input', runSameDayCheck);
                dateInputEl.addEventListener('change', runSameDayCheck);
                if (endDateInputEl) {
                    endDateInputEl.addEventListener('input', runSameDayCheck);
                    endDateInputEl.addEventListener('change', runSameDayCheck);
                }
                runSameDayCheck();
                if (isDuplicate && dateInputEl) {
                    setTimeout(() => dateInputEl.focus(), 150);
                }
            }

            if (!isView) {
                overlay.querySelector('#eventSaveBtn').addEventListener('click', async () => {
                    const btn = overlay.querySelector('#eventSaveBtn');
                    const file = document.getElementById('eventImageFile')?.files?.[0];
                    let imageUrl = (document.getElementById('eventImageUrlInput')?.value || '').trim();
                    if (!imageUrl && event?.image_url) imageUrl = event.image_url;
                    let pdfUrl = event?.pdf_url || null;
                    const pdfFile = document.getElementById('eventPdfFile')?.files?.[0];
                    const removePdf = document.getElementById('eventPdfRemove')?.value === '1';
                    if (file || pdfFile) {
                        btn.disabled = true;
                        btn.textContent = 'Uploaden…';
                        try {
                            if (file) imageUrl = await uploadImageFile(file);
                            if (pdfFile) pdfUrl = await uploadPdfFile(pdfFile);
                        } catch (err) {
                            alert(err.message || 'Upload mislukt');
                            btn.disabled = false;
                            btn.textContent = 'Opslaan';
                            return;
                        }
                        btn.disabled = false;
                        btn.textContent = 'Opslaan';
                    } else if (removePdf) {
                        pdfUrl = null;
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
                        image_url: imageUrl || null,
                        pdf_url: pdfUrl,
                        ticket_url: (document.getElementById('eventTicketUrl')?.value || '').trim() || null,
                        ticket_label: (document.getElementById('eventTicketLabel')?.value || '').trim() || null,
                    };
                    const url = saveId ? `${apiBase}/org/events/${saveId}` : `${apiBase}/org/events`;
                    const method = saveId ? 'PUT' : 'POST';
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
                    ${orgCategorySelectHtml('profile_category', org.category || 'vereniging')}
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
                loadOverview();
            })
            .catch(() => {
                clearStoredToken();
                token = null;
            });
    }

    async function loadOverview() {
        const container = document.getElementById('overviewContent');
        const sidebar   = document.getElementById('sidebarStats');
        if (!container) return;

        container.innerHTML = '<p class="form-hint" style="padding:1rem">Statistieken laden…</p>';

        try {
            const orgId = organization?.id;
            const headers = authHeaders();

            const [newsRes, eventsRes, followersRes] = await Promise.all([
                fetch(`${apiBase}/org/news?limit=200`, { headers }),
                fetch(`${apiBase}/org/events?limit=200`, { headers }),
                orgId ? fetch(`${apiBase}/organizations/${orgId}/followers/count`) : Promise.resolve(null),
            ]);

            const newsData     = newsRes.ok     ? await newsRes.json()     : {};
            const eventsData   = eventsRes.ok   ? await eventsRes.json()   : {};
            const followersData = (followersRes && followersRes.ok) ? await followersRes.json() : { count: 0 };

            const allNews    = newsData.news   || [];
            const allEvents  = eventsData.events || [];
            const followers  = followersData.count ?? 0;

            const published  = allNews.filter(n => n.is_published !== false).length;
            const drafts     = allNews.length - published;
            const now        = new Date();
            const upcoming   = allEvents.filter(e => new Date(e.start_date || e.date) >= now).length;
            const past       = allEvents.length - upcoming;

            updateFollowersNavDot(followers);

            // Meest recente berichten (max 5)
            const recent = allNews
                .filter(n => n.is_published !== false)
                .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
                .slice(0, 5);

            // Eerstvolgende evenementen (max 5, vroegste eerst)
            const nextEvents = allEvents
                .filter(e => new Date(e.start_date || e.date) >= now)
                .sort((a, b) => new Date(a.start_date || a.date) - new Date(b.start_date || b.date))
                .slice(0, 5);

            // Voorbije evenementen (max 5, meest recent eerst)
            const pastEvents = allEvents
                .filter(e => new Date(e.start_date || e.date) < now)
                .sort((a, b) => new Date(b.start_date || b.date) - new Date(a.start_date || a.date))
                .slice(0, 5);

            const orgName = escapeHtml(organization?.name || 'Jouw organisatie');

            container.innerHTML = `
                <div class="overview-welcome">
                    <h3>Welkom terug, ${orgName}!</h3>
                    <p class="form-hint">Hier zie je een snel overzicht van jouw activiteit in de Holwert Dorpsapp.</p>
                </div>
                <div class="overview-stats">
                    <div class="stat-card stat-followers stat-card-clickable" role="button" tabindex="0" title="Bekijk wie jullie volgt" data-goto-followers="1">
                        <div class="stat-icon"><i class="fas fa-heart"></i></div>
                        <div class="stat-body">
                            <div class="stat-value">${followers}</div>
                            <div class="stat-label">Volger${followers === 1 ? '' : 's'}</div>
                        </div>
                    </div>
                    <div class="stat-card stat-news">
                        <div class="stat-icon"><i class="fas fa-newspaper"></i></div>
                        <div class="stat-body">
                            <div class="stat-value">${published}</div>
                            <div class="stat-label">Gepubliceerd${drafts > 0 ? ` <span class="stat-sub">(${drafts} concept${drafts === 1 ? '' : 'en'})</span>` : ''}</div>
                        </div>
                    </div>
                    <div class="stat-card stat-events">
                        <div class="stat-icon"><i class="fas fa-calendar-check"></i></div>
                        <div class="stat-body">
                            <div class="stat-value">${upcoming}</div>
                            <div class="stat-label">Komend${upcoming === 1 ? '' : 'e evenement' + (upcoming === 1 ? '' : 'en')}</div>
                        </div>
                    </div>
                    <div class="stat-card stat-past">
                        <div class="stat-icon"><i class="fas fa-calendar-alt"></i></div>
                        <div class="stat-body">
                            <div class="stat-value">${past}</div>
                            <div class="stat-label">Evenement${past === 1 ? '' : 'en'} geweest</div>
                        </div>
                    </div>
                </div>
                ${recent.length > 0 ? `
                <div class="overview-section">
                    <h4><i class="fas fa-newspaper"></i> Laatste berichten</h4>
                    <ul class="overview-list">
                        ${recent.map(n => `<li>
                            <span class="overview-list-title">${escapeHtml(n.title || '')}</span>
                            <span class="overview-list-date">${n.published_at ? new Date(n.published_at).toLocaleDateString('nl-NL', {day:'numeric',month:'short',year:'numeric'}) : ''}</span>
                        </li>`).join('')}
                    </ul>
                </div>` : ''}
                <div class="overview-events-grid">
                    ${nextEvents.length > 0 ? `
                    <div class="overview-section">
                        <h4><i class="fas fa-calendar-check" style="color:#2f9e44"></i> Komende evenementen</h4>
                        <ul class="overview-list">
                            ${nextEvents.map(e => `<li>
                                <span class="overview-list-title">${escapeHtml(e.title || '')}</span>
                                <span class="overview-list-date">${e.start_date || e.date ? new Date(e.start_date || e.date).toLocaleDateString('nl-NL', {day:'numeric',month:'short',year:'numeric'}) : ''}</span>
                            </li>`).join('')}
                        </ul>
                    </div>` : '<div class="overview-section"><p class="form-hint">Geen komende evenementen.</p></div>'}
                    ${pastEvents.length > 0 ? `
                    <div class="overview-section">
                        <h4><i class="fas fa-calendar-alt" style="color:#868e96"></i> Evenementen geweest</h4>
                        <ul class="overview-list overview-list-past">
                            ${pastEvents.map(e => `<li>
                                <span class="overview-list-title">${escapeHtml(e.title || '')}</span>
                                <span class="overview-list-date">${e.start_date || e.date ? new Date(e.start_date || e.date).toLocaleDateString('nl-NL', {day:'numeric',month:'short',year:'numeric'}) : ''}</span>
                            </li>`).join('')}
                        </ul>
                    </div>` : ''}
                </div>
            `;

            // Sidebar-stats
            if (sidebar) {
                sidebar.innerHTML = `
                    <button type="button" class="sidebar-stat sidebar-stat-btn" data-goto-followers="1" title="Bekijk volgers">
                        <i class="fas fa-heart"></i> <span>${followers} volger${followers === 1 ? '' : 's'}</span>
                    </button>
                    <div class="sidebar-stat"><i class="fas fa-newspaper"></i> <span>${published} bericht${published === 1 ? '' : 'en'}</span></div>
                    <div class="sidebar-stat"><i class="fas fa-calendar-check"></i> <span>${upcoming} komend</span></div>
                    <div class="sidebar-stat"><i class="fas fa-calendar-alt"></i> <span>${past} geweest</span></div>
                `;
            }

            container.querySelectorAll('[data-goto-followers]').forEach((el) => {
                const go = () => navigateToSection('followers');
                el.addEventListener('click', go);
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        go();
                    }
                });
            });
            document.getElementById('sidebarStats')?.querySelectorAll('[data-goto-followers]').forEach((el) => {
                const go = () => navigateToSection('followers');
                el.addEventListener('click', go);
            });
        } catch (err) {
            container.innerHTML = '<p class="form-hint" style="padding:1rem;color:#c00">Kon statistieken niet laden.</p>';
        }
    }

    populateOrgRegistrationCategorySelect();

    let profileBlocksMeta = { block_types: [], weekday_labels: [], suggested_types: [] };
    let profileBlocksCache = [];

    const DEFAULT_PROFILE_BLOCKS_META = {
        block_types: [
            { id: 'opening_hours', label: 'Openingstijden' },
            { id: 'service_schedule', label: 'Diensten / vieringen' },
            { id: 'match_schedule', label: 'Speelschema' },
            { id: 'membership', label: 'Lidmaatschap' },
            { id: 'facilities', label: 'Voorzieningen' },
            { id: 'team', label: 'Team / bestuur' },
            { id: 'links', label: 'Handige links' },
            { id: 'notice', label: 'Mededeling' },
        ],
        weekday_labels: ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'],
        suggested_types: ['notice', 'links', 'facilities'],
    };

    function normalizeProfileBlocksMeta(raw) {
        const base = raw && typeof raw === 'object' ? raw : {};
        return {
            block_types: Array.isArray(base.block_types) && base.block_types.length
                ? base.block_types
                : DEFAULT_PROFILE_BLOCKS_META.block_types,
            weekday_labels: Array.isArray(base.weekday_labels) && base.weekday_labels.length
                ? base.weekday_labels
                : DEFAULT_PROFILE_BLOCKS_META.weekday_labels,
            suggested_types: Array.isArray(base.suggested_types) && base.suggested_types.length
                ? base.suggested_types
                : DEFAULT_PROFILE_BLOCKS_META.suggested_types,
        };
    }

    async function ensureProfileBlocksMetaLoaded() {
        if (profileBlocksMeta.block_types?.length) return profileBlocksMeta;
        try {
            const metaRes = await fetch(`${apiBase}/org/profile-blocks/meta`, { headers: authHeaders() });
            const meta = await metaRes.json().catch(() => ({}));
            if (metaRes.ok) {
                profileBlocksMeta = normalizeProfileBlocksMeta(meta);
                return profileBlocksMeta;
            }
        } catch {
            /* fallback hieronder */
        }
        profileBlocksMeta = normalizeProfileBlocksMeta(null);
        return profileBlocksMeta;
    }

    document.getElementById('addProfileBlockBtn')?.addEventListener('click', () => {
        void openProfileBlockModal(null);
    });

    async function loadProfileBlocks() {
        const container = document.getElementById('profileBlocksList');
        if (!container) return;
        container.innerHTML = '<p class="form-hint">Profielblokken laden…</p>';
        let blocksError = null;
        try {
            const [metaRes, blocksRes] = await Promise.all([
                fetch(`${apiBase}/org/profile-blocks/meta`, { headers: authHeaders() }),
                fetch(`${apiBase}/org/profile-blocks`, { headers: authHeaders() }),
            ]);
            const meta = await metaRes.json().catch(() => ({}));
            const blocksData = await blocksRes.json().catch(() => ({}));
            if (metaRes.ok) {
                profileBlocksMeta = normalizeProfileBlocksMeta(meta);
            } else {
                profileBlocksMeta = normalizeProfileBlocksMeta(null);
            }
            if (!blocksRes.ok) {
                blocksError = blocksData.message || blocksData.error || 'Blokken laden mislukt';
                profileBlocksCache = [];
            } else {
                profileBlocksCache = Array.isArray(blocksData.blocks) ? blocksData.blocks : [];
            }
            if (!metaRes.ok && !blocksRes.ok) {
                throw new Error(blocksError || meta.error || meta.message || 'Laden mislukt');
            }
            renderProfileBlocksList(container, blocksError);
        } catch (err) {
            profileBlocksMeta = normalizeProfileBlocksMeta(profileBlocksMeta);
            container.innerHTML = `<p class="empty-message">Fout: ${escapeHtml(err.message || 'onbekende fout')}</p>`;
        }
    }

    function renderProfileBlocksList(container, blocksError = null) {
        const warn = blocksError
            ? `<p class="form-hint" style="color:#b45309;margin-bottom:1rem;">${escapeHtml(blocksError)}</p>`
            : '';
        if (!profileBlocksCache.length) {
            const suggested = (profileBlocksMeta.suggested_types || [])
                .map((t) => profileBlocksMeta.block_types?.find((b) => b.id === t)?.label || t)
                .filter(Boolean);
            container.innerHTML = `
                ${warn}
                <p class="empty-message">Nog geen profielblokken.</p>
                ${suggested.length ? `<p class="form-hint">Suggesties voor jullie categorie: ${suggested.map((s) => escapeHtml(s)).join(', ')}.</p>` : ''}`;
            return;
        }
        const typeLabel = (id) => profileBlocksMeta.block_types?.find((b) => b.id === id)?.label || id;
        container.innerHTML = `
            ${warn}
            <div class="profile-blocks-list">
                ${profileBlocksCache.map((block, idx) => `
                    <div class="profile-block-row" data-block-id="${block.id}">
                        <div class="profile-block-row-main">
                            <strong>${escapeHtml(block.title || '')}</strong>
                            <span class="form-hint">${escapeHtml(typeLabel(block.block_type))}${block.is_visible === false ? ' · verborgen' : ''}</span>
                        </div>
                        <div class="action-buttons">
                            <button type="button" class="btn-icon" data-block-move-up="${block.id}" title="Omhoog" ${idx === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button>
                            <button type="button" class="btn-icon" data-block-move-down="${block.id}" title="Omlaag" ${idx === profileBlocksCache.length - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down"></i></button>
                            <button type="button" class="btn-icon btn-edit" data-block-edit="${block.id}" title="Bewerken"><i class="fas fa-edit"></i></button>
                            <button type="button" class="btn-icon btn-delete" data-block-delete="${block.id}" title="Verwijderen"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>`).join('')}
            </div>`;
        container.querySelectorAll('[data-block-edit]').forEach((btn) => {
            btn.addEventListener('click', () => {
                void openProfileBlockModal(parseInt(btn.getAttribute('data-block-edit'), 10));
            });
        });
        container.querySelectorAll('[data-block-delete]').forEach((btn) => {
            btn.addEventListener('click', () => deleteProfileBlock(parseInt(btn.getAttribute('data-block-delete'), 10)));
        });
        container.querySelectorAll('[data-block-move-up]').forEach((btn) => {
            btn.addEventListener('click', () => moveProfileBlock(parseInt(btn.getAttribute('data-block-move-up'), 10), -1));
        });
        container.querySelectorAll('[data-block-move-down]').forEach((btn) => {
            btn.addEventListener('click', () => moveProfileBlock(parseInt(btn.getAttribute('data-block-move-down'), 10), 1));
        });
    }

    async function moveProfileBlock(id, direction) {
        const idx = profileBlocksCache.findIndex((b) => b.id === id);
        const swapIdx = idx + direction;
        if (idx < 0 || swapIdx < 0 || swapIdx >= profileBlocksCache.length) return;
        const a = profileBlocksCache[idx];
        const b = profileBlocksCache[swapIdx];
        try {
            await Promise.all([
                fetch(`${apiBase}/org/profile-blocks/${a.id}`, {
                    method: 'PUT',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sort_order: swapIdx }),
                }),
                fetch(`${apiBase}/org/profile-blocks/${b.id}`, {
                    method: 'PUT',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sort_order: idx }),
                }),
            ]);
            await loadProfileBlocks();
        } catch (err) {
            alert(err.message || 'Volgorde wijzigen mislukt');
        }
    }

    async function deleteProfileBlock(id) {
        const block = profileBlocksCache.find((b) => b.id === id);
        if (!block) return;
        if (!confirm(`Weet je zeker dat je "${block.title}" wilt verwijderen?`)) return;
        try {
            const res = await fetch(`${apiBase}/org/profile-blocks/${id}`, { method: 'DELETE', headers: authHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || data.message || 'Verwijderen mislukt');
            await loadProfileBlocks();
        } catch (err) {
            alert(err.message || 'Verwijderen mislukt');
        }
    }

    function profileBlockFormHtml(blockType, data, weekdayLabels) {
        const days = Array.isArray(data?.days) ? data.days : [];
        const items = Array.isArray(data?.items) ? data.items : [];
        switch (blockType) {
            case 'opening_hours':
                return `
                    <div class="form-group">
                        <label>Notitie (optioneel)</label>
                        <input type="text" id="pb_note" value="${escapeHtml(data?.note || '')}" maxlength="500" placeholder="Bijv. alleen op afspraak">
                    </div>
                    <div class="form-group">
                        <label>Weekschema</label>
                        ${(weekdayLabels || []).map((label, day) => {
                            const d = days.find((x) => Number(x.day) === day) || { day, closed: true };
                            return `<div class="form-row" style="align-items:center;margin-bottom:8px;">
                                <label class="checkbox-label" style="min-width:110px;margin:0;">
                                    <input type="checkbox" class="pb-day-closed" data-day="${day}" ${d.closed ? 'checked' : ''}> ${escapeHtml(label)}
                                </label>
                                <input type="time" class="pb-day-open" data-day="${day}" value="${escapeHtml(d.open || '09:00')}" ${d.closed ? 'disabled' : ''} style="flex:1;">
                                <span style="padding:0 6px;">–</span>
                                <input type="time" class="pb-day-close" data-day="${day}" value="${escapeHtml(d.close || '17:00')}" ${d.closed ? 'disabled' : ''} style="flex:1;">
                            </div>`;
                        }).join('')}
                    </div>`;
            case 'service_schedule':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockServiceItemHtml(it, i, weekdayLabels)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Dienst toevoegen</button>`;
            case 'match_schedule':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockMatchItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Wedstrijd toevoegen</button>`;
            case 'membership':
                return `
                    <div class="form-group"><label>Intro</label><textarea id="pb_intro" rows="3">${escapeHtml(data?.intro || '')}</textarea></div>
                    <div class="form-row">
                        <div class="form-group"><label>Contributie / tarief</label><input type="text" id="pb_fee" value="${escapeHtml(data?.fee || '')}"></div>
                        <div class="form-group"><label>Contact</label><input type="text" id="pb_contact" value="${escapeHtml(data?.contact || '')}"></div>
                    </div>
                    <div class="form-group"><label>Aanmeld-URL</label><input type="url" id="pb_signup_url" value="${escapeHtml(data?.signup_url || '')}" placeholder="https://…"></div>
                    <div id="pb_items_wrap">${(data?.items || []).map((it, i) => profileBlockKvItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Regel toevoegen</button>`;
            case 'facilities':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockFacilityItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Voorziening toevoegen</button>`;
            case 'team':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockTeamItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Persoon toevoegen</button>`;
            case 'links':
                return `
                    <div id="pb_items_wrap">${items.map((it, i) => profileBlockLinkItemHtml(it, i)).join('')}</div>
                    <button type="button" class="btn btn-secondary" id="pb_add_item"><i class="fas fa-plus"></i> Link toevoegen</button>`;
            case 'notice':
                return `
                    <div class="form-group"><label>Mededeling</label><textarea id="pb_text" rows="4" maxlength="500">${escapeHtml(data?.text || '')}</textarea></div>
                    <div class="form-group"><label>Tot en met (optioneel)</label><input type="date" id="pb_until" value="${escapeHtml(data?.until || '')}"><p class="form-hint">Na deze datum verdwijnt de mededeling automatisch uit de app.</p></div>`;
            default:
                return '<p class="form-hint">Onbekend bloktype.</p>';
        }
    }

    function profileBlockServiceItemHtml(it, i, weekdayLabels) {
        const opts = (weekdayLabels || []).map((label, w) =>
            `<option value="${w}" ${Number(it?.weekday) === w ? 'selected' : ''}>${escapeHtml(label)}</option>`
        ).join('');
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Dag</label><select class="pb-weekday">${opts}</select></div>
                <div class="form-group"><label>Tijd</label><input type="time" class="pb-time" value="${escapeHtml(it?.time || '')}"></div>
            </div>
            <div class="form-group"><label>Titel</label><input type="text" class="pb-title" value="${escapeHtml(it?.title || '')}"></div>
            <div class="form-row">
                <div class="form-group"><label>Locatie</label><input type="text" class="pb-location" value="${escapeHtml(it?.location || '')}"></div>
                <div class="form-group"><label>Notitie</label><input type="text" class="pb-note" value="${escapeHtml(it?.note || '')}"></div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockMatchItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Datum</label><input type="date" class="pb-date" value="${escapeHtml(it?.date || '')}"></div>
                <div class="form-group"><label>Tijd</label><input type="time" class="pb-time" value="${escapeHtml(it?.time || '')}"></div>
            </div>
            <div class="form-group"><label>Tegenstander</label><input type="text" class="pb-opponent" value="${escapeHtml(it?.opponent || '')}"></div>
            <div class="form-row">
                <div class="form-group"><label>Locatie</label><input type="text" class="pb-location" value="${escapeHtml(it?.location || '')}"></div>
                <div class="form-group"><label>Competitie</label><input type="text" class="pb-competition" value="${escapeHtml(it?.competition || '')}"></div>
            </div>
            <label class="checkbox-label"><input type="checkbox" class="pb-is-home" ${it?.is_home !== false ? 'checked' : ''}> Thuiswedstrijd</label>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockKvItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Label</label><input type="text" class="pb-label" value="${escapeHtml(it?.label || '')}"></div>
                <div class="form-group"><label>Waarde</label><input type="text" class="pb-value" value="${escapeHtml(it?.value || '')}"></div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockFacilityItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-group"><label>Naam</label><input type="text" class="pb-label" value="${escapeHtml(it?.label || '')}"></div>
            <div class="form-group"><label>Toelichting</label><input type="text" class="pb-text" value="${escapeHtml(it?.text || '')}"></div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockTeamItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Naam</label><input type="text" class="pb-name" value="${escapeHtml(it?.name || '')}"></div>
                <div class="form-group"><label>Rol</label><input type="text" class="pb-role" value="${escapeHtml(it?.role || '')}"></div>
            </div>
            <div class="form-group"><label>Notitie</label><input type="text" class="pb-note" value="${escapeHtml(it?.note || '')}"></div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function profileBlockLinkItemHtml(it, i) {
        return `<div class="profile-block-item" data-item-idx="${i}">
            <div class="form-row">
                <div class="form-group"><label>Label</label><input type="text" class="pb-label" value="${escapeHtml(it?.label || '')}"></div>
                <div class="form-group"><label>URL</label><input type="url" class="pb-url" value="${escapeHtml(it?.url || '')}"></div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm pb-remove-item">Verwijderen</button>
        </div>`;
    }

    function wireProfileBlockForm(overlay, blockType) {
        overlay.querySelectorAll('.pb-day-closed').forEach((cb) => {
            cb.addEventListener('change', () => {
                const day = cb.getAttribute('data-day');
                const open = overlay.querySelector(`.pb-day-open[data-day="${day}"]`);
                const close = overlay.querySelector(`.pb-day-close[data-day="${day}"]`);
                if (open) open.disabled = cb.checked;
                if (close) close.disabled = cb.checked;
            });
        });
        overlay.querySelector('#pb_add_item')?.addEventListener('click', () => {
            const wrap = overlay.querySelector('#pb_items_wrap');
            if (!wrap) return;
            const idx = wrap.querySelectorAll('.profile-block-item').length;
            let html = '';
            if (blockType === 'service_schedule') html = profileBlockServiceItemHtml({}, idx, profileBlocksMeta.weekday_labels);
            else if (blockType === 'match_schedule') html = profileBlockMatchItemHtml({}, idx);
            else if (blockType === 'membership') html = profileBlockKvItemHtml({}, idx);
            else if (blockType === 'facilities') html = profileBlockFacilityItemHtml({}, idx);
            else if (blockType === 'team') html = profileBlockTeamItemHtml({}, idx);
            else if (blockType === 'links') html = profileBlockLinkItemHtml({}, idx);
            if (!html) return;
            const div = document.createElement('div');
            div.innerHTML = html;
            const node = div.firstElementChild;
            wrap.appendChild(node);
            node.querySelector('.pb-remove-item')?.addEventListener('click', () => node.remove());
        });
        overlay.querySelectorAll('.pb-remove-item').forEach((btn) => {
            btn.addEventListener('click', () => btn.closest('.profile-block-item')?.remove());
        });
    }

    function collectProfileBlockData(overlay, blockType) {
        switch (blockType) {
            case 'opening_hours': {
                const days = [];
                for (let day = 0; day <= 6; day++) {
                    const closed = overlay.querySelector(`.pb-day-closed[data-day="${day}"]`)?.checked;
                    days.push({
                        day,
                        closed: !!closed,
                        open: overlay.querySelector(`.pb-day-open[data-day="${day}"]`)?.value || '09:00',
                        close: overlay.querySelector(`.pb-day-close[data-day="${day}"]`)?.value || '17:00',
                    });
                }
                return { note: overlay.querySelector('#pb_note')?.value?.trim() || '', days, exceptions: [] };
            }
            case 'service_schedule':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        weekday: parseInt(el.querySelector('.pb-weekday')?.value, 10) || 0,
                        time: el.querySelector('.pb-time')?.value || '',
                        title: el.querySelector('.pb-title')?.value?.trim() || '',
                        location: el.querySelector('.pb-location')?.value?.trim() || '',
                        note: el.querySelector('.pb-note')?.value?.trim() || '',
                    })),
                };
            case 'match_schedule':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        date: el.querySelector('.pb-date')?.value || '',
                        time: el.querySelector('.pb-time')?.value || '',
                        opponent: el.querySelector('.pb-opponent')?.value?.trim() || '',
                        location: el.querySelector('.pb-location')?.value?.trim() || '',
                        is_home: el.querySelector('.pb-is-home')?.checked !== false,
                        competition: el.querySelector('.pb-competition')?.value?.trim() || '',
                    })),
                };
            case 'membership':
                return {
                    intro: overlay.querySelector('#pb_intro')?.value?.trim() || '',
                    fee: overlay.querySelector('#pb_fee')?.value?.trim() || '',
                    contact: overlay.querySelector('#pb_contact')?.value?.trim() || '',
                    signup_url: overlay.querySelector('#pb_signup_url')?.value?.trim() || '',
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        label: el.querySelector('.pb-label')?.value?.trim() || '',
                        value: el.querySelector('.pb-value')?.value?.trim() || '',
                    })),
                };
            case 'facilities':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        label: el.querySelector('.pb-label')?.value?.trim() || '',
                        text: el.querySelector('.pb-text')?.value?.trim() || '',
                    })),
                };
            case 'team':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        name: el.querySelector('.pb-name')?.value?.trim() || '',
                        role: el.querySelector('.pb-role')?.value?.trim() || '',
                        note: el.querySelector('.pb-note')?.value?.trim() || '',
                    })),
                };
            case 'links':
                return {
                    items: [...overlay.querySelectorAll('.profile-block-item')].map((el) => ({
                        label: el.querySelector('.pb-label')?.value?.trim() || '',
                        url: el.querySelector('.pb-url')?.value?.trim() || '',
                        icon: 'link',
                    })),
                };
            case 'notice':
                return {
                    text: overlay.querySelector('#pb_text')?.value?.trim() || '',
                    until: overlay.querySelector('#pb_until')?.value || '',
                };
            default:
                return {};
        }
    }

    async function openProfileBlockModal(blockId) {
        await ensureProfileBlocksMetaLoaded();
        const existing = blockId ? profileBlocksCache.find((b) => b.id === blockId) : null;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        const typeOptions = (profileBlocksMeta.block_types || []).map((t) =>
            `<option value="${escapeHtml(t.id)}" ${existing?.block_type === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
        ).join('');
        const initialType = existing?.block_type || profileBlocksMeta.suggested_types?.[0] || profileBlocksMeta.block_types?.[0]?.id || 'notice';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:640px;">
                <div class="modal-header">
                    <h3>${existing ? 'Profielblok bewerken' : 'Nieuw profielblok'}</h3>
                    <button type="button" class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="pb_title">Titel</label>
                        <input type="text" id="pb_title" maxlength="255" value="${escapeHtml(existing?.title || '')}">
                    </div>
                    <div class="form-group">
                        <label for="pb_block_type">Type</label>
                        <select id="pb_block_type" ${existing ? 'disabled' : ''}>${typeOptions}</select>
                        ${existing ? '<p class="form-hint">Het type kan na aanmaken niet meer worden gewijzigd.</p>' : ''}
                    </div>
                    <label class="checkbox-label"><input type="checkbox" id="pb_visible" ${existing?.is_visible === false ? '' : 'checked'}> Zichtbaar in de app</label>
                    <div id="pb_form_body" style="margin-top:1rem;"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary modal-close-btn">Annuleren</button>
                    <button type="button" class="btn btn-primary" id="pb_save_btn">Opslaan</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const renderFormBody = () => {
            const type = existing?.block_type || overlay.querySelector('#pb_block_type')?.value || initialType;
            const data = existing?.data || {};
            const body = overlay.querySelector('#pb_form_body');
            if (body) {
                body.innerHTML = profileBlockFormHtml(type, data, profileBlocksMeta.weekday_labels);
                wireProfileBlockForm(overlay, type);
            }
        };
        renderFormBody();
        if (!existing) {
            overlay.querySelector('#pb_block_type')?.addEventListener('change', renderFormBody);
        }

        const close = () => overlay.remove();
        overlay.querySelector('.modal-close')?.addEventListener('click', close);
        overlay.querySelector('.modal-close-btn')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        overlay.querySelector('#pb_save_btn')?.addEventListener('click', async () => {
            const title = overlay.querySelector('#pb_title')?.value?.trim();
            if (!title) { alert('Titel is verplicht'); return; }
            const blockType = existing?.block_type || overlay.querySelector('#pb_block_type')?.value;
            const payload = {
                title,
                data: collectProfileBlockData(overlay, blockType),
                is_visible: overlay.querySelector('#pb_visible')?.checked !== false,
            };
            try {
                let res;
                if (existing) {
                    res = await fetch(`${apiBase}/org/profile-blocks/${existing.id}`, {
                        method: 'PUT',
                        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                } else {
                    res = await fetch(`${apiBase}/org/profile-blocks`, {
                        method: 'POST',
                        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...payload, block_type: blockType }),
                    });
                }
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || data.message || 'Opslaan mislukt');
                close();
                await loadProfileBlocks();
            } catch (err) {
                alert(err.message || 'Opslaan mislukt');
            }
        });
    }
})();

/**
 * Opmaak-toolbar: wraps de geselecteerde tekst in de opgegeven textarea met HTML-tags.
 * @param {string} textareaId
 * @param {'bold'|'italic'|'link'} format
 */
function adminFormatText(textareaId, format) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const selected = ta.value.substring(start, end);
    let before, after, newCursor;
    if (format === 'bold')        { before = '<strong>'; after = '</strong>'; }
    else if (format === 'italic') { before = '<em>';     after = '</em>'; }
    else if (format === 'link') {
        const url = prompt('URL van de link:', 'https://');
        if (!url) return;
        before = `<a href="${url}">`; after = '</a>';
    }
    const replacement = before + (selected || 'tekst') + after;
    ta.value = ta.value.substring(0, start) + replacement + ta.value.substring(end);
    if (selected) {
        ta.setSelectionRange(start, start + replacement.length);
    } else {
        newCursor = start + before.length;
        ta.setSelectionRange(newCursor, newCursor + 5);
    }
    ta.focus();
}
