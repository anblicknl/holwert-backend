console.log('=== SCRIPT LOADED - VERSION 2026-03-03-21:PRAKTISCH-ICONS ===');

class HolwertAdmin {
    constructor() {
        // Lokaal (localhost of 127.0.0.1) → backend op poort 3000; anders productie-API
        const host = window.location.hostname;
        const isLocalDev = host === 'localhost' || host === '127.0.0.1';
        this.apiBaseUrl = isLocalDev
            ? 'http://localhost:3000/api'
            : 'https://holwert-backend.vercel.app/api';
        this.token = localStorage.getItem('authToken');
        this.currentUser = null;

        // Gebruikers-tab state (Dorpsbewoners / Organisaties)
        this.currentUsersTab = 'dorpsbewoners';
        this.allUsersCache = [];

        // Events-tab state (Actief / Archief)
        this.currentEventsTab = 'actief';
        this.allEventsCache = [];

        /** Gevulde na loadOrganizations / ensureOrganizationsListForUsers (dropdown bij gebruikers). */
        this.organizationsList = [];

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
    }

    /** Tekst veilig in HTML (moderatie-items). */
    escHtml(s) {
        if (s == null || s === '') return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    /** Gelijk aan server `normalizeAdminRole`: robuuste vergelijking van rollen. */
    normalizeAdminPanelRole(roleRaw) {
        if (roleRaw == null || roleRaw === '') return '';
        const s = String(roleRaw).trim().toLowerCase();
        if (!s || s === 'null' || s === 'undefined') return '';
        return s;
    }

    /** Rol uit JWT-payload (zonder verify) als fallback wanneer `user.role` ontbreekt in het login-antwoord. */
    roleFromAccessToken(jwtToken) {
        if (!jwtToken || typeof jwtToken !== 'string') return '';
        try {
            const parts = jwtToken.split('.');
            if (parts.length < 2) return '';
            let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const pad = b64.length % 4;
            if (pad) b64 += '='.repeat(4 - pad);
            const payload = JSON.parse(atob(b64));
            return this.normalizeAdminPanelRole(payload.role);
        } catch {
            return '';
        }
    }

    setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        const loginPwToggle = document.getElementById('loginPasswordToggle');
        const loginPwInput = document.getElementById('password');
        if (loginPwToggle && loginPwInput) {
            loginPwToggle.addEventListener('click', () => {
                const tonen = loginPwInput.type === 'password';
                loginPwInput.type = tonen ? 'text' : 'password';
                loginPwToggle.setAttribute('aria-pressed', tonen ? 'true' : 'false');
                loginPwToggle.setAttribute('aria-label', tonen ? 'Wachtwoord verbergen' : 'Wachtwoord tonen');
                loginPwToggle.title = tonen ? 'Wachtwoord verbergen' : 'Wachtwoord tonen';
                const icon = loginPwToggle.querySelector('i');
                if (icon) {
                    icon.className = tonen ? 'fas fa-eye-slash' : 'fas fa-eye';
                }
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.handleLogout();
            });
        }

        // Add News button
        const addNewsBtn = document.getElementById('addNewsBtn');
        if (addNewsBtn) {
            addNewsBtn.addEventListener('click', () => {
                this.showCreateNewsModal();
            });
        }

        // Add Organization button
        const addOrganizationBtn = document.getElementById('addOrganizationBtn');
        if (addOrganizationBtn) {
            addOrganizationBtn.addEventListener('click', () => {
                this.showCreateOrganizationModal();
            });
        }

        const addOrgDashboardAccountBtn = document.getElementById('addOrgDashboardAccountBtn');
        if (addOrgDashboardAccountBtn) {
            addOrgDashboardAccountBtn.addEventListener('click', () => {
                void this.showCreateOrgDashboardUserModal();
            });
        }

        // Add User button
        const addUserBtn = document.getElementById('addUserBtn');
        if (addUserBtn) {
            addUserBtn.addEventListener('click', () => {
                void this.showCreateUserModal();
            });
        }

        // Add Event button
        const addEventBtn = document.getElementById('addEventBtn');
        if (addEventBtn) {
            addEventBtn.addEventListener('click', () => {
                console.log('[Admin] + Nieuw evenement klik geregistreerd');
                this.openCreateEventModal();
            });
        }

        // Events tabs (Actief / Archief)
        const eventTabs = document.querySelectorAll('.events-tab');
        if (eventTabs && eventTabs.length) {
            eventTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const tabKey = tab.getAttribute('data-events-tab') || 'actief';
                    console.log('[Admin] Events tab klik:', tabKey);
                    this.currentEventsTab = tabKey;

                    // Active styling
                    eventTabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Herteken events-lijst op basis van geselecteerde tab
                    this.updateEventsView();
                });
            });
        }

        // Users tabs (Dorpsbewoners / Organisaties)
        const userTabs = document.querySelectorAll('.users-tab');
        if (userTabs && userTabs.length) {
            userTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const tabKey = tab.getAttribute('data-users-tab') || 'dorpsbewoners';
                    console.log('[Admin] Users tab klik:', tabKey);
                    this.currentUsersTab = tabKey;

                    // Active styling
                    userTabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Herteken gebruikerslijst op basis van geselecteerde tab
                    this.updateUsersView();
                });
            });
        }

        // Gebruikers: oog / bewerken / verwijderen (geen inline onclick — werkt niet bij CSP op sommige hosts)
        const usersContentEl = document.getElementById('usersContent');
        if (usersContentEl && !usersContentEl.dataset.actionsBound) {
            usersContentEl.dataset.actionsBound = '1';
            usersContentEl.addEventListener('click', (e) => {
                const el = e.target.closest('[data-user-action]');
                if (!el || !usersContentEl.contains(el)) return;
                e.preventDefault();
                const action = el.getAttribute('data-user-action');
                const id = parseInt(el.getAttribute('data-user-id'), 10);
                if (!action || Number.isNaN(id)) return;
                if (action === 'view') {
                    this.viewUser(id);
                    return;
                }
                if (action === 'edit') {
                    this.editUser(id);
                    return;
                }
                if (action === 'delete') {
                    this.deleteUser(id);
                    return;
                }
                if (action === 'role') {
                    this.changeUserRole(id);
                    return;
                }
                if (action === 'status') {
                    const a = el.getAttribute('data-user-active');
                    const isActive = a === '1' || a === 'true';
                    this.toggleUserStatus(id, isActive);
                }
            });
        }

        // Evenementen: bekijken / bewerken / verwijderen (geen inline onclick — CSP)
        const eventsContentEl = document.getElementById('eventsContent');
        if (eventsContentEl && !eventsContentEl.dataset.actionsBound) {
            eventsContentEl.dataset.actionsBound = '1';
            eventsContentEl.addEventListener('click', (e) => {
                const el = e.target.closest('[data-event-action]');
                if (!el || !eventsContentEl.contains(el)) return;
                e.preventDefault();
                const action = el.getAttribute('data-event-action');
                const id = parseInt(el.getAttribute('data-event-id'), 10);
                if (Number.isNaN(id)) return;
                if (action === 'view') {
                    this.viewEvent(id);
                    return;
                }
                if (action === 'edit') {
                    this.editEvent(id);
                    return;
                }
                if (action === 'delete') {
                    let title = '';
                    const enc = el.getAttribute('data-event-title');
                    if (enc) {
                        try {
                            title = decodeURIComponent(enc);
                        } catch {
                            title = '';
                        }
                    }
                    this.deleteEvent(id, title || 'dit evenement');
                }
            });
        }

        // Organizations table actions (edit/delete) via event delegation
        const organizationsTableBody = document.getElementById('organizationsTableBody');
        if (organizationsTableBody) {
            organizationsTableBody.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.organization-edit-btn');
                const deleteBtn = e.target.closest('.organization-delete-btn');
                const approveBtn = e.target.closest('.organization-approve-btn');
                if (editBtn && editBtn.dataset.orgId) {
                    const orgId = parseInt(editBtn.dataset.orgId, 10);
                    console.log('[Admin] Edit organization klik geregistreerd, id =', orgId);
                    if (!isNaN(orgId)) {
                        this.editOrganization(orgId);
                    }
                } else if (approveBtn && approveBtn.dataset.orgId) {
                    const orgId = parseInt(approveBtn.dataset.orgId, 10);
                    if (!isNaN(orgId)) {
                        void this.approveContent('organization', orgId);
                    }
                } else if (deleteBtn && deleteBtn.dataset.orgId) {
                    const orgId = parseInt(deleteBtn.dataset.orgId, 10);
                    console.log('[Admin] Delete organization klik geregistreerd, id =', orgId);
                    if (!isNaN(orgId)) {
                        this.deleteOrganization(orgId);
                    }
                }
            });
        }

        // Navigation
        const navLinks = document.querySelectorAll('.nav-item');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.currentTarget.getAttribute('data-section');
                this.showSection(section);
            });
        });

        // Praktisch (tegels) - nieuw item
        const addPracticalBtn = document.getElementById('addPracticalBtn');
        if (addPracticalBtn) {
            addPracticalBtn.addEventListener('click', () => this.createPracticalItem());
        }

        // Afvalkalender (Content sectie)
        const saveAfvalkalenderBtn = document.getElementById('saveAfvalkalenderBtn');
        if (saveAfvalkalenderBtn) {
            saveAfvalkalenderBtn.addEventListener('click', () => this.saveAfvalkalender());
        }
        const afvalOudPapierType = document.getElementById('afvalOudPapierType');
        if (afvalOudPapierType) {
            afvalOudPapierType.addEventListener('change', (e) => {
                const isRecurring = e.target.value === 'recurring';
                const recurringEl = document.getElementById('afvalOudPapierRecurring');
                const datesEl = document.getElementById('afvalOudPapierDates');
                if (recurringEl) recurringEl.style.display = isRecurring ? 'block' : 'none';
                if (datesEl) datesEl.style.display = isRecurring ? 'none' : 'block';
            });
        }
    }

    checkAuth() {
        console.log('=== CHECK AUTH ===');
        console.log('HolwertAdmin initialized');
        console.log('API Base URL:', this.apiBaseUrl);
        console.log('Token:', this.token);
        
        if (this.token) {
            console.log('Token found, showing main screen');
            this.showMainScreen();
            console.log('Calling showSection(dashboard)');
            this.showSection('dashboard');
            console.log('Calling loadDashboard()');
            this.loadDashboard();
        } else {
            console.log('No token, showing login screen');
            this.showLoginScreen();
        }
        console.log('=== END CHECK AUTH ===');
    }

    showLoginScreen() {
        const loginScreen = document.getElementById('loginScreen');
        const mainScreen = document.getElementById('mainScreen');
        
        if (loginScreen) {
            loginScreen.classList.add('active');
            loginScreen.style.display = 'block';
        }
        if (mainScreen) {
            mainScreen.classList.remove('active');
            mainScreen.style.display = 'none';
        }
    }

    showMainScreen() {
        console.log('=== SHOW MAIN SCREEN ===');
        const loginScreen = document.getElementById('loginScreen');
        const mainScreen = document.getElementById('mainScreen');
        
        console.log('Login screen element:', loginScreen);
        console.log('Main screen element:', mainScreen);
        console.log('All elements with id containing "dashboard":', document.querySelectorAll('[id*="dashboard"]'));
        console.log('All elements with class "screen":', document.querySelectorAll('.screen'));
        
        if (loginScreen) {
            loginScreen.classList.remove('active');
            loginScreen.style.display = 'none';
            console.log('Login screen hidden');
        }
        if (mainScreen) {
            mainScreen.classList.add('active');
            mainScreen.style.display = 'block';
            console.log('Main screen shown');
            console.log('Main screen classes:', mainScreen.className);
            console.log('Main screen style:', mainScreen.style.display);
        } else {
            console.error('Main screen element not found!');
        }

        // Start automatische polling van notificatie-badges (elke 30 seconden)
        this.startBadgePolling();
        
        console.log('=== END SHOW MAIN SCREEN ===');
    }

    startBadgePolling() {
        // Voorkomen dat er meerdere intervals tegelijk lopen
        if (this._badgePollTimer) clearInterval(this._badgePollTimer);
        this._badgePollTimer = setInterval(() => {
            if (this.token) {
                this.loadNotificationCounts();
            } else {
                this.stopBadgePolling();
            }
        }, 30_000); // elke 30 seconden
    }

    stopBadgePolling() {
        if (this._badgePollTimer) {
            clearInterval(this._badgePollTimer);
            this._badgePollTimer = null;
        }
    }

    async handleLogin() {
        console.log('=== LOGIN START ===');
        /** Voorkomt dat `finally` meteen «Succesvol!» overschrijft (daardoor leek inloggen «niets» te doen). */
        let loginSucceeded = false;

        const emailEl = document.getElementById('email');
        const passwordEl = document.getElementById('password');
        const errorDiv = document.getElementById('loginError');
        const submitBtn = document.querySelector('#loginForm button[type="submit"]')
            || document.querySelector('#loginForm input[type="submit"]')
            || document.querySelector('#loginForm .btn')
            || document.querySelector('button[type="submit"]');
        let span = null;

        const email = emailEl ? emailEl.value : '';
        const password = passwordEl ? passwordEl.value : '';

        console.log('Email element present:', !!emailEl);
        console.log('Password element present:', !!passwordEl);
        console.log('Submit button present:', !!submitBtn);
        console.log('Email:', email);
        console.log('Password length:', password ? password.length : 0);

        // Clear previous errors
        if (errorDiv) {
            errorDiv.innerHTML = '';
            errorDiv.style.display = 'none';
        }

        // Basic validation
        if (!email || !password) {
            console.log('Validation failed: missing fields');
            if (errorDiv) {
                errorDiv.innerHTML = 'Vul alle velden in';
                errorDiv.style.display = 'block';
            }
            return;
        }

        // Show loading state (null-safe)
        if (submitBtn) {
            submitBtn.disabled = true;
            span = submitBtn.querySelector('span');
            if (span) span.textContent = 'Inloggen...';
        }

        try {
            console.log('Sending request to:', `${this.apiBaseUrl}/auth/login`);
            
            const response = await fetch(`${this.apiBaseUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            console.log('Response status:', response.status);

            const data = await response.json();
            console.log('Response data:', data);

            if (response.ok) {
                console.log('Login successful!');
                this.token = data.token;
                const elevated = new Set(['admin', 'superadmin', 'editor']);
                // Toegang baseren op login-antwoord + JWT-payload; profiel-fetch blokkeert niet meer de login
                // (was: lege rol als /auth/profile faalt of JSON breekt → geen toegang).
                let panelRole = this.normalizeAdminPanelRole(data.user && data.user.role);
                if (!panelRole) panelRole = this.roleFromAccessToken(data.token);

                if (!panelRole || !elevated.has(panelRole)) {
                    this.token = null;
                    if (errorDiv) {
                        errorDiv.innerHTML = 'Dit account heeft geen rechten voor het beheerderspaneel. Je rol moet <strong>admin</strong>, <strong>superadmin</strong> of <strong>editor</strong> zijn (niet alleen «gebruiker»).';
                        errorDiv.style.display = 'block';
                        errorDiv.style.color = 'red';
                    }
                    return;
                }

                this.currentUser = data.user || null;
                try {
                    const profRes = await fetch(`${this.apiBaseUrl}/auth/profile`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                    if (profRes.ok) {
                        const profData = await profRes.json();
                        if (profData.user) this.currentUser = profData.user;
                    }
                } catch (e) {
                    console.warn('Kon profiel na login niet laden (niet kritiek):', e);
                }

                loginSucceeded = true;
                localStorage.setItem('authToken', this.token);
                
                if (span) span.textContent = 'Succesvol!';
                
                // Show success message
                if (errorDiv) {
                    errorDiv.innerHTML = 'Inloggen succesvol!';
                    errorDiv.style.display = 'block';
                    errorDiv.style.color = 'green';
                }
                
                setTimeout(() => {
                    console.log('Switching to main screen');
                    const loginSpan = document.querySelector('#loginForm button[type="submit"] span');
                    if (loginSpan) loginSpan.textContent = 'Inloggen';
                    this.showMainScreen();
                    this.showSection('dashboard');
                }, 1000);
            } else {
                console.log('Login failed:', data);
                if (errorDiv) {
                    const msg = data.error || data.message || 'Inloggen mislukt';
                    errorDiv.textContent = typeof msg === 'string' ? msg : 'Inloggen mislukt';
                    errorDiv.style.display = 'block';
                    errorDiv.style.color = 'red';
                }
            }
        } catch (error) {
            console.error('Login error:', error);
            if (errorDiv) {
                errorDiv.innerHTML = 'Verbindingsfout: ' + error.message;
                errorDiv.style.display = 'block';
                errorDiv.style.color = 'red';
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (!loginSucceeded && span) span.textContent = 'Inloggen';
            console.log('=== LOGIN END ===');
        }
    }

    handleLoginError(data, email, password) {
        const errorDiv = document.getElementById('loginError');
        
        // Clear field errors first
        this.clearFieldErrors();

        if (data.field === 'email') {
            this.showFieldError('email', data.error);
            this.showError(data.suggestion || data.error);
        } else if (data.field === 'password') {
            this.showFieldError('password', data.error);
            this.showError(data.suggestion || data.error);
        } else if (data.field === 'account') {
            this.showError(data.error + '. ' + (data.suggestion || ''));
        } else {
            this.showError(data.error || 'Inloggen mislukt');
        }
    }

    showFieldError(fieldName, message) {
        const field = document.getElementById(fieldName);
        if (field) {
            field.style.borderColor = '#ff3b30';
            field.style.boxShadow = '0 0 0 4px rgba(255, 59, 48, 0.1)';
            
            // Add error message below field
            let errorMsg = field.parentNode.querySelector('.field-error');
            if (!errorMsg) {
                errorMsg = document.createElement('div');
                errorMsg.className = 'field-error';
                errorMsg.style.color = '#ff3b30';
                errorMsg.style.fontSize = '12px';
                errorMsg.style.marginTop = '4px';
                field.parentNode.appendChild(errorMsg);
            }
            errorMsg.textContent = message;
        }
    }

    clearFieldErrors() {
        // Clear email field error
        const emailField = document.getElementById('email');
        if (emailField) {
            emailField.style.borderColor = '';
            emailField.style.boxShadow = '';
            const emailError = emailField.parentNode.querySelector('.field-error');
            if (emailError) emailError.remove();
        }

        // Clear password field error
        const passwordField = document.getElementById('password');
        if (passwordField) {
            passwordField.style.borderColor = '';
            passwordField.style.boxShadow = '';
            const passwordError = passwordField.parentNode.querySelector('.field-error');
            if (passwordError) passwordError.remove();
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('loginError');
        errorDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-exclamation-triangle" style="color: #ff3b30;"></i>
                <span>${message}</span>
            </div>
        `;
        errorDiv.classList.add('show');
    }

    handleLogout() {
        this.stopBadgePolling();
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('authToken');
        this.showLoginScreen();
    }

    showSection(sectionName) {
        console.log('=== SHOW SECTION ===');
        console.log('Section name:', sectionName);
        
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(link => {
            link.classList.remove('active');
        });
        const navLink = document.querySelector(`.nav-item[data-section="${sectionName}"]`);
        if (navLink) {
            navLink.classList.add('active');
            console.log('Nav link activated:', navLink);
        } else {
            console.error('Nav link not found for section:', sectionName);
        }

        // Show section content - support both .section and .content-section
        document.querySelectorAll('.section, .content-section').forEach(section => {
            section.classList.remove('active');
            console.log('Removed active from section:', section.id);
        });
        const targetSection = document.getElementById(sectionName);
        if (targetSection) {
            targetSection.classList.add('active');
            console.log('Activated section:', targetSection);
            console.log('Section classes:', targetSection.className);
        } else {
            console.error('Target section not found:', sectionName);
        }

        // Load section data
        this.loadSectionData(sectionName);
        
        // Refresh notification counts when navigating
        this.loadNotificationCounts();
        
        console.log('=== END SHOW SECTION ===');
    }

    async loadSectionData(sectionName) {
        switch (sectionName) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'users':
                this.loadUsers();
                break;
            case 'organizations':
                console.log('Loading organizations section...');
                this.loadOrganizations();
                break;
            case 'news':
                this.loadNews();
                break;
            case 'events':
                this.loadEvents();
                break;
            case 'found-lost':
                this.loadFoundLost();
                break;
            case 'moderation':
                this.loadModeration();
                break;
            case 'practical':
                this.loadPractical();
                this.loadAfvalkalender();
                break;
            case 'content-pages':
                this.loadContentPages();
                break;
        }
    }

    async loadDashboard() {
        try {
            console.log('=== LOADING DASHBOARD ===');
            console.log('API Base URL:', this.apiBaseUrl);
            console.log('Token:', this.token);
            
            // Load dashboard statistics from original admin routes
            // Load stats from single endpoint
            const statsRes = await fetch(`${this.apiBaseUrl}/admin/stats`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
            });

            console.log('Stats response status:', statsRes.status);
            console.log('Stats response ok:', statsRes.ok);

            if (statsRes.ok) {
                const statsData = await statsRes.json();
                console.log('Stats loaded:', statsData);
                console.log('Users count:', statsData.users);
                console.log('Organizations count:', statsData.organizations);
                
                // Update DOM elements
                const totalUsersEl = document.getElementById('totalUsers');
                const totalOrgsEl = document.getElementById('totalOrganizations');
                const totalNewsEl = document.getElementById('totalNews');
                const totalEventsEl = document.getElementById('totalEvents');
                
                console.log('DOM elements found:', {
                    totalUsers: !!totalUsersEl,
                    totalOrganizations: !!totalOrgsEl,
                    totalNews: !!totalNewsEl,
                    totalEvents: !!totalEventsEl
                });
                
                if (totalUsersEl) {
                    totalUsersEl.textContent = statsData.users || 0;
                    console.log('Updated totalUsers to:', totalUsersEl.textContent);
                }
                if (totalOrgsEl) {
                    totalOrgsEl.textContent = statsData.organizations || 0;
                    console.log('Updated totalOrganizations to:', totalOrgsEl.textContent);
                }
                if (totalNewsEl) {
                    totalNewsEl.textContent = statsData.news || 0;
                    console.log('Updated totalNews to:', totalNewsEl.textContent);
                }
                if (totalEventsEl) {
                    totalEventsEl.textContent = statsData.events || 0;
                    console.log('Updated totalEvents to:', totalEventsEl.textContent);
                }
            } else {
                console.error('Failed to load stats:', statsRes.status);
                const errorText = await statsRes.text();
                console.error('Error response:', errorText);
            }

            // Load pending content
            this.loadPendingContent();
            this.loadRecentActivity();
            
            // Load notification counts
            this.loadNotificationCounts();

        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    }

    async loadNotificationCounts() {
        try {
            // Haal notificatie counts op van verschillende endpoints
            const [moderationCount, pendingOrgsCount, pendingEventsCount] = await Promise.all([
                this.getModerationCount(),
                this.getPendingOrganizationsCount(),
                this.getPendingEventsCount()
            ]);

            // Update notificatie bolletjes
            this.updateNotificationBadge('moderation', moderationCount);
            this.updateNotificationBadge('organizations', pendingOrgsCount);
            this.updateNotificationBadge('events', pendingEventsCount);

        } catch (error) {
            console.error('Error loading notification counts:', error);
        }
    }

    async getModerationCount() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/moderation/count`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
                cache: 'no-store',
            });
            if (response.ok) {
                const data = await response.json();
                // Totaal openstaande items (organisaties + nieuws + evenementen)
                return (parseInt(data.organizations, 10) || 0)
                     + (parseInt(data.news, 10) || 0)
                     + (parseInt(data.events, 10) || 0);
            }
        } catch (error) {
            console.error('Error getting moderation count:', error);
        }
        return 0;
    }

    async getPendingOrganizationsCount() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations?status=pending&limit=1`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
                cache: 'no-store',
            });
            if (response.ok) {
                const data = await response.json();
                return data.pagination?.total ?? (Array.isArray(data.organizations) ? data.organizations.length : 0) ?? 0;
            }
        } catch (error) {
            console.error('Error getting pending organizations count:', error);
        }
        return 0;
    }

    async getPendingEventsCount() {
        // Events zijn automatisch goedgekeurd, geen pending count nodig
        return 0;
    }

    updateNotificationBadge(section, count) {
        const navLink = document.querySelector(`[data-section="${section}"]`);
        if (!navLink) return;

        // Verwijder bestaande badge
        const existingBadge = navLink.querySelector('.notification-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // Badge: zelfde vorm als organisaties (cirkel met cijfer); moderatie = rood, overig = grijs
        if (count > 0) {
            const badge = document.createElement('span');
            const label = count > 99 ? '99+' : String(count);
            if (section === 'moderation') {
                badge.className = 'notification-badge notification-badge--moderation';
                badge.textContent = label;
                badge.title = `${count} item(s) wachten op moderatie`;
                badge.setAttribute('aria-label', `${count} item(s) wachten op moderatie`);
            } else {
                badge.className = 'notification-badge';
                badge.textContent = label;
            }
            navLink.appendChild(badge);
        }
    }

    updateDashboardStats(data) {
        // Update statistics
        if (data.statistics) {
            document.getElementById('totalUsers').textContent = data.statistics.totalUsers || 0;
            document.getElementById('totalOrganizations').textContent = data.statistics.totalOrganizations || 0;
            document.getElementById('totalNews').textContent = data.statistics.totalNews || 0;
            document.getElementById('totalEvents').textContent = data.statistics.totalEvents || 0;
        }

        // Update pending content
        if (data.pendingContent) {
            this.updatePendingContent(data.pendingContent);
        }

        // Update recent activity
        if (data.recentActivity) {
            this.updateRecentActivity(data.recentActivity);
        }
    }

    updatePendingContent(pendingContent) {
        const container = document.getElementById('pendingContent');
        if (!container) return;

        if (pendingContent.length === 0) {
            container.innerHTML = '<p class="text-muted">Geen wachtende content</p>';
            return;
        }

        container.innerHTML = pendingContent.map(item => `
            <div class="pending-item">
                <div class="content-icon">
                    <i class="fas fa-${this.getContentIcon(item.type)}"></i>
                </div>
                <div class="content-info">
                    <div class="content-title">${item.title}</div>
                    <div class="content-meta">${item.organization_name || 'Gebruiker'} • ${this.formatDate(item.timestamp)}</div>
                </div>
                <div class="content-actions">
                    <button class="btn btn-sm btn-primary" onclick="admin.approveContent('${item.type}', ${item.id})">
                        Goedkeuren
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="admin.rejectContent('${item.type}', ${item.id})">
                        Afwijzen
                    </button>
                </div>
            </div>
        `).join('');
    }

    updateRecentActivity(recentActivity) {
        const container = document.getElementById('recentActivity');
        if (!container) return;

        if (recentActivity.length === 0) {
            container.innerHTML = '<p class="text-muted">Geen recente activiteit</p>';
            return;
        }

        container.innerHTML = recentActivity.map(item => `
            <div class="activity-item">
                <div class="content-icon">
                    <i class="fas fa-${this.getActivityIcon(item.type)}"></i>
                </div>
                <div class="content-info">
                    <div class="content-title">${item.title}</div>
                    <div class="content-meta">${item.description} • ${this.formatDate(item.timestamp)}</div>
                </div>
            </div>
        `).join('');
    }

    getContentIcon(type) {
        const icons = {
            news: 'newspaper',
            event: 'calendar',
            organization: 'building',
            found_lost: 'search',
        };
        return icons[type] || 'file';
    }

    getActivityIcon(type) {
        const icons = {
            'user': 'user-plus',
            'news': 'newspaper',
            'event': 'calendar',
            'organization': 'building'
        };
        return icons[type] || 'activity';
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));

        if (diffInHours < 1) {
            return 'Zojuist';
        } else if (diffInHours < 24) {
            return `${diffInHours} uur geleden`;
        } else {
            const diffInDays = Math.floor(diffInHours / 24);
            return `${diffInDays} dag${diffInDays > 1 ? 'en' : ''} geleden`;
        }
    }

    /** Publieke inlog-URL van het organisatie-dashboard (zelfde domein als dit beheer). */
    getOrganizationDashboardPublicUrl() {
        try {
            return new URL('/dashboard/', window.location.origin).href;
        } catch {
            return `${window.location.origin}/dashboard/`;
        }
    }

    async copyTextToClipboard(text, okMsg = 'Gekopieerd naar het klembord') {
        const t = text != null ? String(text) : '';
        if (!t) {
            this.showNotification('Niets om te kopiëren.', 'error');
            return;
        }
        try {
            await navigator.clipboard.writeText(t);
            this.showNotification(okMsg, 'success');
        } catch {
            this.showNotification('Kopiëren mislukt; selecteer de tekst handmatig.', 'error');
        }
    }

    /** Eenmalig tonen na auto-aanmaak dashboard-gebruiker bij goedkeuren organisatie. */
    showOrganizationDashboardCredentialsModal(result) {
        const email = result.dashboard_login_email != null ? String(result.dashboard_login_email) : '';
        const pw = result.temporary_password != null ? String(result.temporary_password) : '';
        const notice = result.user_notice != null ? String(result.user_notice) : '';
        const dashUrl = this.getOrganizationDashboardPublicUrl();

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 32rem;">
                <div class="modal-header">
                    <h3>Dashboard-account</h3>
                    <button type="button" class="modal-close" aria-label="Sluiten">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p style="margin-top:0;">Er is een inlog voor het <strong>organisatie-dashboard</strong> aangemaakt (zelfde e-mail als bij de organisatie).</p>
                    <p style="margin-bottom:0.75rem;">
                        <a href="${this.escHtml(dashUrl)}" target="_blank" rel="noopener noreferrer">Open inlogpagina dashboard</a>
                        <small style="display:block;margin-top:0.35rem;color:#666;">Als het pad bij jullie anders is, gebruik dan die URL (meestal <code>/dashboard/</code> op hetzelfde domein).</small>
                    </p>
                    <div id="orgDashCredNotice" class="org-dash-cred-notice" style="display:none;margin-bottom:1rem;padding:0.65rem 0.75rem;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;color:#664d03;font-size:0.9rem;"></div>
                    <div class="form-group">
                        <label for="orgDashCredEmail">E-mail (inlognaam)</label>
                        <div style="display:flex;gap:0.5rem;align-items:center;">
                            <input type="text" id="orgDashCredEmail" readonly class="org-dash-cred-field" style="flex:1;font-family:ui-monospace,monospace;">
                            <button type="button" class="btn btn-secondary" id="orgDashCredCopyEmail">Kopiëren</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="orgDashCredPw">Tijdelijk wachtwoord</label>
                        <div style="display:flex;gap:0.5rem;align-items:center;">
                            <input type="text" id="orgDashCredPw" readonly class="org-dash-cred-field" style="flex:1;font-family:ui-monospace,monospace;">
                            <button type="button" class="btn btn-secondary" id="orgDashCredCopyPw">Kopiëren</button>
                        </div>
                    </div>
                    <p style="margin-bottom:0;font-size:0.9rem;color:#666;">Bewaar dit wachtwoord niet in e-mail of chat; geef het zo mogelijk persoonlijk door. De organisatie kan daarna het wachtwoord wijzigen na inloggen (of jij wijzigt het onder Gebruikers).</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" data-org-dash-cred-close>Sluiten</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const emailInput = modal.querySelector('#orgDashCredEmail');
        const pwInput = modal.querySelector('#orgDashCredPw');
        if (emailInput) emailInput.value = email;
        if (pwInput) pwInput.value = pw;

        const noticeEl = modal.querySelector('#orgDashCredNotice');
        if (noticeEl && notice) {
            noticeEl.textContent = notice;
            noticeEl.style.display = 'block';
        }

        const close = () => modal.remove();
        modal.querySelector('.modal-close')?.addEventListener('click', close);
        modal.querySelector('[data-org-dash-cred-close]')?.addEventListener('click', close);
        modal.querySelector('.modal-content')?.addEventListener('click', (e) => e.stopPropagation());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        modal.querySelector('#orgDashCredCopyEmail')?.addEventListener('click', () => {
            void this.copyTextToClipboard(emailInput?.value, 'E-mail gekopieerd');
        });
        modal.querySelector('#orgDashCredCopyPw')?.addEventListener('click', () => {
            void this.copyTextToClipboard(pwInput?.value, 'Wachtwoord gekopieerd');
        });
    }

    // Content moderation functions
    async approveContent(type, id) {
        try {
            console.log(`Approving ${type} with id ${id}`);
            const headers = {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            };
            let response;

            if (type === 'organization') {
                response = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}/approve`, {
                    method: 'POST',
                    headers,
                });
            } else if (type === 'news') {
                response = await fetch(`${this.apiBaseUrl}/admin/news/${id}/publish`, {
                    method: 'POST',
                    headers,
                });
            } else if (type === 'event') {
                response = await fetch(`${this.apiBaseUrl}/admin/events/${id}/publish`, {
                    method: 'POST',
                    headers,
                });
            } else {
                this.showNotification(`Goedkeuren voor type "${type}" is niet geconfigureerd.`, 'error');
                return;
            }

            if (response.ok) {
                const result = await response.json().catch(() => ({}));
                this.showNotification(result.message || 'Goedgekeurd', 'success');
                if (type === 'organization' && result) {
                    if (result.temporary_password && result.dashboard_login_email) {
                        this.showOrganizationDashboardCredentialsModal(result);
                    } else if (result.user_notice) {
                        this.showNotification(this.escHtml(result.user_notice), 'info');
                    }
                }
                this.loadDashboard();
                this.loadPendingContent();
                this.loadModeration();
                this.loadNotificationCounts();
                if (typeof this.loadOrganizations === 'function') {
                    this.loadOrganizations();
                }
                if (typeof this.loadUsers === 'function') {
                    this.loadUsers();
                }
            } else {
                const error = await response.json().catch(() => ({}));
                this.showNotification(error.message || error.error || 'Fout bij goedkeuren', 'error');
            }
        } catch (error) {
            console.error('Error approving content:', error);
            this.showNotification('Verbindingsfout bij goedkeuren', 'error');
        }
    }

    async rejectContent(type, id) {
        try {
            console.log(`Rejecting ${type} with id ${id}`);
            const msg =
                type === 'organization'
                    ? 'Deze organisatie-aanmelding definitief verwijderen? Dit kan niet ongedaan worden gemaakt.'
                    : 'Weet je zeker dat je dit item wilt verwijderen? Dit kan niet ongedaan worden gemaakt.';
            if (!confirm(msg)) {
                return;
            }

            let url;
            if (type === 'organization') {
                url = `${this.apiBaseUrl}/admin/organizations/${id}`;
            } else if (type === 'news') {
                url = `${this.apiBaseUrl}/admin/news/${id}`;
            } else if (type === 'event') {
                url = `${this.apiBaseUrl}/admin/events/${id}`;
            } else {
                this.showNotification(`Afwijzen voor type "${type}" is niet geconfigureerd.`, 'error');
                return;
            }

            const response = await fetch(url, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.token}` },
            });

            if (response.ok) {
                const result = await response.json().catch(() => ({}));
                this.showNotification(result.message || 'Verwijderd', 'success');
                this.loadDashboard();
                this.loadPendingContent();
                this.loadModeration();
                this.loadNotificationCounts();
                if (type === 'organization' && typeof this.loadOrganizations === 'function') {
                    this.loadOrganizations();
                }
            } else {
                const error = await response.json().catch(() => ({}));
                this.showNotification(error.message || error.error || 'Fout bij afwijzen', 'error');
            }
        } catch (error) {
            console.error('Error rejecting content:', error);
            this.showNotification('Verbindingsfout bij afwijzen', 'error');
        }
    }

    // Bulk operations
    async bulkApproveContent(items) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/moderate/bulk-approve`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ items })
            });

            if (response.ok) {
                const result = await response.json();
                this.showNotification(result.message, 'success');
                this.loadDashboard(); // Refresh dashboard
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Fout bij bulk goedkeuring', 'error');
            }
        } catch (error) {
            console.error('Error bulk approving content:', error);
            this.showNotification('Verbindingsfout', 'error');
        }
    }

    // Search functionality
    async searchContent(query, type = null) {
        try {
            const params = new URLSearchParams({ q: query });
            if (type) params.append('type', type);

            const response = await fetch(`${this.apiBaseUrl}/admin/search?${params}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                return data.results;
            } else {
                console.error('Search failed');
                return null;
            }
        } catch (error) {
            console.error('Error searching:', error);
            return null;
        }
    }

    /** Zelfde logica als backend/API: id kan number of string zijn (MySQL/driver). */
    findUserById(id, list) {
        const n = Number(id);
        if (Number.isNaN(n)) return undefined;
        return (Array.isArray(list) ? list : []).find((u) => Number(u.id) === n);
    }

    // User management
    async loadUsers() {
        try {
            console.log('Loading users...');
            const response = await fetch(`${this.apiBaseUrl}/admin/users?limit=5000`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Users loaded:', data);
                this.allUsersCache = Array.isArray(data.users) ? data.users : [];
                this.updateUsersView();
            } else {
                console.error('Failed to load users:', response.status);
                let msg = `Gebruikers laden mislukt (HTTP ${response.status})`;
                try {
                    const error = await response.json();
                    console.error('Error:', error);
                    if (error.message) {
                        msg = error.message;
                    } else if (error.error) {
                        msg = error.error;
                    }
                    if (response.status === 403 && error.dbRole != null) {
                        msg += ` (rol in database: ${error.dbRole})`;
                    }
                } catch (_) { /* body geen JSON */ }
                this.showNotification(msg, 'error');
            }
        } catch (error) {
            console.error('Error loading users:', error);
            this.showNotification('Gebruikers laden mislukt. Controleer verbinding en probeer opnieuw.', 'error');
        }
    }

    updateUsersView() {
        const users = Array.isArray(this.allUsersCache) ? [...this.allUsersCache] : [];
        if (!users.length) {
            this.displayUsers([]);
            return;
        }

        let filtered;
        if (this.currentUsersTab === 'organisaties') {
            // Toon hier beheerders / organisatie-accounts (alles wat geen gewone dorpsbewoner is)
            filtered = users.filter(u => (u.role || '').toLowerCase() !== 'user');
        } else {
            // Dorpsbewoners: alleen echte app-gebruikers
            filtered = users.filter(u => (u.role || '').toLowerCase() === 'user');
        }

        // Zorg dat super-admins niet in Dorpsbewoners verschijnen
        if (this.currentUsersTab === 'dorpsbewoners') {
            filtered = filtered.filter(u => (u.role || '').toLowerCase() !== 'superadmin');
        }

        // Sorteer alfabetisch op volledige naam
        filtered.sort((a, b) => {
            const nameA = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase();
            const nameB = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        });

        this.displayUsers(filtered);
    }

    displayUsers(users) {
        const container = document.getElementById('usersContent');
        if (!container) return;

        if (users.length === 0) {
            const cache = Array.isArray(this.allUsersCache) ? this.allUsersCache : [];
            const tabLabel = this.currentUsersTab === 'organisaties' ? 'Organisaties' : 'Dorpsbewoners';
            const otherTab = this.currentUsersTab === 'organisaties' ? 'Dorpsbewoners' : 'Organisaties';
            let extra = '';
            if (cache.length > 0) {
                extra = `<p class="text-muted" style="margin-top:8px;">Er zijn wél accounts geladen (${cache.length}). Probeer het tabblad <strong>${otherTab}</strong>: daar staan accounts die niet onder «${tabLabel}» vallen (filter op rol).</p>`;
            }
            container.innerHTML = `<p class="text-muted">Geen gebruikers in dit overzicht.</p>${extra}`;
            return;
        }

        container.innerHTML = `
            <!-- Desktop Table View -->
            <div class="data-table-container desktop-view">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Profielfoto</th>
                            <th>Naam</th>
                            <th>Rol</th>
                            <th>Status</th>
                            <th>Acties</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map(user => `
                            <tr>
                                <td>
                                    <div class="user-avatar">
                                        ${user.profile_image_url && user.profile_image_url !== '' ? 
                                            `<img src="${user.profile_image_url}" alt="Profielfoto" class="avatar-img">` : 
                                            `<div class="avatar-placeholder">
                                                <i class="fas fa-user"></i>
                                            </div>`
                                        }
                                    </div>
                                </td>
                                <td>
                                    <div class="user-name">
                                        <strong>${user.first_name} ${user.last_name}</strong>
                                    </div>
                                </td>
                                <td>
                                    <span class="role-badge role-${user.role}" data-user-action="role" data-user-id="${user.id}" style="cursor: pointer;" title="Klik om rol te wijzigen">
                                        ${user.role}
                                    </span>
                                </td>
                                <td>
                                    <span class="status-badge status-${user.is_active ? 'active' : 'inactive'}" data-user-action="status" data-user-id="${user.id}" data-user-active="${user.is_active ? 1 : 0}" style="cursor: pointer;" title="Klik om status te wijzigen">
                                        ${user.is_active ? 'Actief' : 'Inactief'}
                                    </span>
                                </td>
                                <td>
                                    <div class="action-buttons">
                                        <button type="button" class="btn-icon btn-view" data-user-action="view" data-user-id="${user.id}" title="Bekijk volledig profiel">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                        <button type="button" class="btn-icon btn-edit" data-user-action="edit" data-user-id="${user.id}" title="Bewerken">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button type="button" class="btn-icon btn-delete" data-user-action="delete" data-user-id="${user.id}" title="Verwijderen">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Mobile Card View -->
            <div class="mobile-cards-container mobile-view">
                ${users.map(user => `
                    <div class="user-card">
                        <div class="user-card-header">
                            <div class="user-avatar">
                                ${user.profile_image_url && user.profile_image_url !== '' ? 
                                    `<img src="${user.profile_image_url}" alt="Profielfoto" class="avatar-img">` : 
                                    `<div class="avatar-placeholder">
                                        <i class="fas fa-user"></i>
                                    </div>`
                                }
                            </div>
                            <div class="user-info">
                                <div class="user-name">
                                    <strong>${user.first_name} ${user.last_name}</strong>
                                </div>
                                <div class="user-badges">
                                    <span class="role-badge role-${user.role}" data-user-action="role" data-user-id="${user.id}" style="cursor: pointer;" title="Klik om rol te wijzigen">
                                        ${user.role}
                                    </span>
                                    <span class="status-badge status-${user.is_active ? 'active' : 'inactive'}" data-user-action="status" data-user-id="${user.id}" data-user-active="${user.is_active ? 1 : 0}" style="cursor: pointer;" title="Klik om status te wijzigen">
                                        ${user.is_active ? 'Actief' : 'Inactief'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="user-card-actions">
                            <button type="button" class="btn-icon btn-view" data-user-action="view" data-user-id="${user.id}" title="Bekijk volledig profiel">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button type="button" class="btn-icon btn-edit" data-user-action="edit" data-user-id="${user.id}" title="Bewerken">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button type="button" class="btn-icon btn-delete" data-user-action="delete" data-user-id="${user.id}" title="Verwijderen">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    async showCreateUserModal() {
        const self = this;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Nieuwe dorpsbewoner (app)</h3>
                    <button type="button" class="modal-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="createUserForm" class="edit-form">
                        <p class="text-muted" style="font-size:0.9rem;margin-bottom:1rem;line-height:1.45;">
                            Account voor de dorpsapp. Voor een organisatie-webdashboard: ga naar <strong>Organisaties</strong> en kies <strong>Dashboard-account</strong>.
                        </p>
                        <div class="form-group">
                            <label for="createEmail">E-mail *</label>
                            <input type="email" id="createEmail" name="email" required autocomplete="email">
                        </div>
                        <div class="form-group">
                            <label for="createPassword">Wachtwoord *</label>
                            <input type="password" id="createPassword" name="password" required minlength="6" autocomplete="new-password">
                        </div>
                        <div class="form-row" id="createNameRow">
                            <div class="form-group">
                                <label for="createFirstName">Voornaam *</label>
                                <input type="text" id="createFirstName" name="first_name" required autocomplete="given-name">
                            </div>
                            <div class="form-group">
                                <label for="createLastName">Achternaam *</label>
                                <input type="text" id="createLastName" name="last_name" required autocomplete="family-name">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="createPhone">Telefoon</label>
                            <input type="tel" id="createPhone" name="phone" autocomplete="tel" placeholder="Optioneel">
                        </div>
                        <div class="form-group">
                            <label for="createRelationship">Relatie met Holwert *</label>
                            <select id="createRelationship" name="relationship_with_holwert" required>
                                <option value="" disabled selected>— Kies —</option>
                                <option value="resident">Inwoner</option>
                                <option value="former_resident">Oud-inwoner</option>
                                <option value="vacation_home">Vakantiewoning</option>
                                <option value="interested">Geïnteresseerde</option>
                                <option value="tourist">Toerist</option>
                            </select>
                            <small style="display:block;margin-top:0.35rem;color:#666;">Zelfde opties als in de app; nodig voor een volledig profiel.</small>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-modal-close>Annuleren</button>
                    <button type="button" class="btn btn-primary" id="createUserSubmitBtn">Aanmaken</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.querySelector('[data-modal-close]').addEventListener('click', () => modal.remove());
        modal.querySelector('#createUserSubmitBtn').addEventListener('click', function(e) {
            e.preventDefault();
            self.saveNewUser();
        });
        modal.querySelector('.modal-content').addEventListener('click', (e) => e.stopPropagation());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }

    async saveNewUser() {
        try {
            const first_name = document.getElementById('createFirstName')?.value?.trim();
            const last_name = document.getElementById('createLastName')?.value?.trim();
            const email = document.getElementById('createEmail')?.value?.trim();
            const password = document.getElementById('createPassword')?.value;
            const phoneRaw = document.getElementById('createPhone')?.value?.trim();
            const relationship_with_holwert = document.getElementById('createRelationship')?.value?.trim();
            if (!email || !password || password.length < 6) {
                this.showNotification('Vul e-mail en wachtwoord in (minimaal 6 tekens).', 'error');
                return;
            }
            if (!first_name || !last_name) {
                this.showNotification('Voornaam en achternaam zijn verplicht.', 'error');
                return;
            }
            if (!relationship_with_holwert) {
                this.showNotification('Kies een relatie met Holwert.', 'error');
                return;
            }
            if (!this.token) {
                this.showNotification('Niet ingelogd. Log opnieuw in.', 'error');
                return;
            }
            const payload = {
                email,
                password,
                role: 'user',
                is_active: true,
                first_name,
                last_name,
                relationship_with_holwert,
            };
            if (phoneRaw) payload.phone = phoneRaw;
            const res = await fetch(`${this.apiBaseUrl}/admin/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                this.showNotification('Dorpsbewoner succesvol aangemaakt', 'success');
                document.getElementById('createFirstName')?.closest('.modal-overlay')?.remove();
                this.loadUsers();
            } else {
                const msg = data.error || data.message || `HTTP ${res.status}`;
                this.showNotification(msg, 'error');
            }
        } catch (e) {
            this.showNotification('Fout: ' + (e?.message || e), 'error');
        }
    }

    /** Organisatie-dashboard: alleen e-mail, wachtwoord en organisatie (naam volgt organisatie op de server). */
    async showCreateOrgDashboardUserModal() {
        const self = this;
        if (!this.token) {
            this.showNotification('Niet ingelogd. Log opnieuw in.', 'error');
            return;
        }
        this.organizationsList = [];
        await this.ensureOrganizationsListForUsers();
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        const hasOrgs = (this.organizationsList || []).length > 0;
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Dashboard-account (organisatie)</h3>
                    <button type="button" class="modal-close" aria-label="Sluiten">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="createOrgDashUserForm" class="edit-form">
                        <p class="text-muted" style="font-size:0.9rem;margin-bottom:1rem;line-height:1.45;">
                            Alleen voor inlog op het organisatie-webdashboard. De weergavenaam wordt de organisatienaam. Voor dorpsapp-bewoners: gebruik <strong>Gebruikers → Nieuwe dorpsbewoner</strong>.
                        </p>
                        ${
                            !hasOrgs
                                ? `<p class="text-muted" style="margin-bottom:1rem;">Er is nog geen organisatie. Maak eerst een organisatie aan (knop hieronder), daarna kun je het account koppelen.</p>`
                                : ''
                        }
                        <div class="form-group">
                            <label for="createOrgDashOrganizationId">Organisatie *</label>
                            <select id="createOrgDashOrganizationId" name="organization_id" required ${!hasOrgs ? 'disabled' : ''}>
                                ${hasOrgs ? this.buildOrganizationSelectHtml(null, { requiredPick: true }) : '<option value="">— Geen organisaties —</option>'}
                            </select>
                        </div>
                        <div class="form-group">
                            <button type="button" class="btn btn-secondary btn-sm" id="createOrgDashNewOrgBtn">
                                <i class="fas fa-plus"></i> Eerst nieuwe organisatie aanmaken
                            </button>
                        </div>
                        <div class="form-group">
                            <label for="createOrgDashEmail">E-mail *</label>
                            <input type="email" id="createOrgDashEmail" required autocomplete="email">
                        </div>
                        <div class="form-group">
                            <label for="createOrgDashPassword">Wachtwoord *</label>
                            <input type="password" id="createOrgDashPassword" required minlength="6" autocomplete="new-password">
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-modal-close>Annuleren</button>
                    <button type="button" class="btn btn-primary" id="createOrgDashSubmitBtn" ${!hasOrgs ? 'disabled' : ''}>Account aanmaken</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('.modal-close')?.addEventListener('click', close);
        modal.querySelector('[data-modal-close]')?.addEventListener('click', close);
        modal.querySelector('.modal-content')?.addEventListener('click', (e) => e.stopPropagation());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('#createOrgDashNewOrgBtn')?.addEventListener('click', () => {
            self.showCreateOrganizationModal((createdOrg) => {
                const sel = document.getElementById('createOrgDashOrganizationId');
                const submitBtn = document.getElementById('createOrgDashSubmitBtn');
                if (!sel) return;
                sel.removeAttribute('disabled');
                sel.innerHTML = self.buildOrganizationSelectHtml(createdOrg?.id, { requiredPick: true });
                sel.value = String(createdOrg.id);
                if (submitBtn) submitBtn.removeAttribute('disabled');
            });
        });
        modal.querySelector('#createOrgDashSubmitBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            void self.saveNewOrgDashboardUser();
        });
    }

    async saveNewOrgDashboardUser() {
        try {
            const orgRaw = document.getElementById('createOrgDashOrganizationId')?.value;
            const email = document.getElementById('createOrgDashEmail')?.value?.trim();
            const password = document.getElementById('createOrgDashPassword')?.value;
            const n = parseInt(orgRaw, 10);
            if (!orgRaw || Number.isNaN(n) || n <= 0) {
                this.showNotification('Kies een organisatie.', 'error');
                return;
            }
            if (!email || !password || password.length < 6) {
                this.showNotification('Vul e-mail en wachtwoord in (minimaal 6 tekens).', 'error');
                return;
            }
            if (!this.token) {
                this.showNotification('Niet ingelogd. Log opnieuw in.', 'error');
                return;
            }
            const payload = {
                email,
                password,
                role: 'user',
                is_active: true,
                organization_id: n,
                first_name: '',
                last_name: '',
            };
            const res = await fetch(`${this.apiBaseUrl}/admin/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                this.showNotification('Dashboard-account aangemaakt', 'success');
                document.getElementById('createOrgDashEmail')?.closest('.modal-overlay')?.remove();
                this.loadUsers();
                if (typeof this.loadOrganizations === 'function') this.loadOrganizations();
            } else {
                const msg = data.error || data.message || `HTTP ${res.status}`;
                this.showNotification(msg, 'error');
            }
        } catch (e) {
            this.showNotification('Fout: ' + (e?.message || e), 'error');
        }
    }

    // Organization management
    displayOrganizations(organizations) {
        const container = document.getElementById('organizationsTableBody');
        if (!container) {
            console.error('organizationsTableBody container not found');
            return;
        }

        if (!organizations || organizations.length === 0) {
            container.innerHTML = '<tr><td colspan="6" class="empty-message">Geen organisaties gevonden</td></tr>';
            return;
        }

        container.innerHTML = organizations.map(org => `
            <tr>
                <td>
                    <div class="user-avatar">
                        ${
                            org.logo_url
                                ? `<img src="${org.logo_url}" alt="Logo ${org.name || ''}" class="avatar-img">`
                                : `<div class="avatar-placeholder">
                                        <i class="fas fa-building"></i>
                                   </div>`
                        }
                    </div>
                </td>
                <td>${org.name || '-'}</td>
                <td>${org.category || 'Geen categorie'}</td>
                <td>${org.user_count || 0}</td>
                <td>
                    <span class="status-badge ${org.is_approved ? 'status-published' : 'status-draft'}">
                        ${org.is_approved ? 'Goedgekeurd' : 'In afwachting'}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        ${
                            !org.is_approved
                                ? `<button
                            type="button"
                            class="btn-icon btn-approve organization-approve-btn"
                            data-org-id="${org.id}"
                            title="Goedkeuren">
                            <i class="fas fa-check"></i>
                        </button>`
                                : ''
                        }
                        <button 
                            class="btn-icon btn-edit organization-edit-btn" 
                            data-org-id="${org.id}" 
                            title="Bewerken">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button 
                            class="btn-icon btn-delete organization-delete-btn" 
                            data-org-id="${org.id}" 
                            title="Verwijderen">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async loadOrganizations() {
        try {
            console.log('Loading organizations from:', `${this.apiBaseUrl}/admin/organizations`);
            console.log('Token exists:', !!this.token);
            
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);

            if (response.ok) {
                const data = await response.json();
                console.log('Organizations data:', data);
                console.log('Organizations count:', data.organizations ? data.organizations.length : 0);
                
                if (data.organizations && data.organizations.length > 0) {
                    // Sorteer alfabetisch op naam, zoals gewenst in de admin
                    const sorted = [...data.organizations].sort((a, b) => {
                        const nameA = (a.name || '').toLowerCase();
                        const nameB = (b.name || '').toLowerCase();
                        if (nameA < nameB) return -1;
                        if (nameA > nameB) return 1;
                        return 0;
                    });
                    this.organizationsList = sorted;
                    this.displayOrganizations(sorted);
                } else {
                    console.log('No organizations found in response');
                    this.organizationsList = [];
                    const container = document.getElementById('organizationsTableBody');
                    if (container) {
                        container.innerHTML = '<tr><td colspan="5" class="empty-message">Geen organisaties gevonden</td></tr>';
                    }
                }
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error('Failed to load organizations:', response.status, errorData);
                
                // Als token verlopen is, log uit
                if (response.status === 401 || errorData.error === 'Invalid token') {
                    this.showNotification('Sessie verlopen. Log opnieuw in.', 'error');
                    setTimeout(() => this.logout(), 2000);
                    return;
                }
                
                this.showNotification(`Fout bij laden organisaties: ${errorData.message || errorData.error || response.statusText}`, 'error');
                
                const container = document.getElementById('organizationsTableBody');
                if (container) {
                    container.innerHTML = `<tr><td colspan="5" class="empty-message">Fout: ${errorData.message || errorData.error || response.statusText}</td></tr>`;
                }
            }
        } catch (error) {
            console.error('Error loading organizations:', error);
            this.showNotification(`Fout bij laden organisaties: ${error.message}`, 'error');
            
            const container = document.getElementById('organizationsTableBody');
            if (container) {
                container.innerHTML = `<tr><td colspan="5" class="empty-message">Fout: ${error.message}</td></tr>`;
            }
        }
    }

    /** Voor gebruikersbeheer: organisatielijst als die nog niet uit het Organisaties-tabblad geladen is. */
    async ensureOrganizationsListForUsers() {
        if (this.organizationsList && this.organizationsList.length) return;
        if (!this.token) return;
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            const list = data.organizations || [];
            this.organizationsList = [...list].sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;
                return 0;
            });
        } catch (e) {
            console.warn('ensureOrganizationsListForUsers:', e);
        }
    }

    /**
     * @param {number|string|null|undefined} selectedId
     * @param {{ requiredPick?: boolean }} [opts] — `requiredPick`: geen «geen organisatie»; eerste optie is placeholder.
     */
    buildOrganizationSelectHtml(selectedId, opts = {}) {
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const requiredPick = !!opts.requiredPick;
        let html = '';
        if (requiredPick) {
            const selPh = selectedId == null || selectedId === '' ? ' selected' : '';
            html += `<option value="" disabled${selPh}>${esc('— Kies een organisatie —')}</option>`;
        } else {
            html += `<option value="">${esc('— Geen (geen organisatie-dashboard) —')}</option>`;
        }
        for (const org of this.organizationsList || []) {
            const sel = String(selectedId ?? '') === String(org.id) ? ' selected' : '';
            html += `<option value="${org.id}"${sel}>${esc(org.name || `Organisatie ${org.id}`)}</option>`;
        }
        return html;
    }

    /** Logo naar CDN via backend-upload; `organizationId` bepaalt de server-map (twee cijfers). */
    async uploadOrganizationLogo(organizationId, file) {
        if (!this.token || !organizationId || !file) return null;
        const compressedBase64 = await this.compressNewsImage(file);
        if (compressedBase64.length > 4 * 1024 * 1024) {
            throw new Error('Afbeelding is te groot (max. ca. 4 MB na compressie).');
        }
        const uploadRes = await fetch(`${this.apiBaseUrl}/upload/image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify({
                imageData: compressedBase64,
                filename: `org-logo-${organizationId}-${Date.now()}.jpg`,
                organizationId
            })
        });
        if (!uploadRes.ok) {
            let msg = `HTTP ${uploadRes.status}`;
            try {
                const j = await uploadRes.json();
                msg = j.message || j.error || msg;
            } catch (_) { /* */ }
            throw new Error(msg);
        }
        const uploadJson = await uploadRes.json();
        return uploadJson.imageUrl || null;
    }

    /**
     * @param {(createdOrganization: object) => void} [onCreatedOrg] — optioneel, na succesvol aanmaken (bijv. dashboard-accountmodal bijwerken).
     */
    showCreateOrganizationModal(onCreatedOrg) {
        const self = this;
        if (!this.token) {
            this.showNotification('Niet ingelogd. Log opnieuw in.', 'error');
            return;
        }
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h3>Nieuwe organisatie</h3>
                    <button type="button" class="modal-close" data-modal-close aria-label="Sluiten"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <form id="createOrganizationForm">
                        <div class="form-group">
                            <label for="createOrgName">Naam *</label>
                            <input type="text" id="createOrgName" required placeholder="Naam van de organisatie">
                        </div>
                        <div class="form-group">
                            <label for="createOrgCategory">Categorie</label>
                            <input type="text" id="createOrgCategory" placeholder="bijv. Vereniging, Gemeente, Sport">
                        </div>
                        <div class="form-group">
                            <label for="createOrgDescription">Beschrijving</label>
                            <textarea id="createOrgDescription" rows="3" placeholder="Korte beschrijving"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="createOrgBio">Bio</label>
                            <textarea id="createOrgBio" rows="2" placeholder="Optionele bio"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="createOrgEmail">E-mail</label>
                            <input type="email" id="createOrgEmail" placeholder="contact@voorbeeld.nl">
                        </div>
                        <div class="form-group">
                            <label for="createOrgWebsite">Website</label>
                            <input type="url" id="createOrgWebsite" placeholder="https://">
                        </div>
                        <div class="form-group">
                            <label for="createOrgPhone">Telefoon</label>
                            <input type="text" id="createOrgPhone" placeholder="Telefoonnummer">
                        </div>
                        <div class="form-group">
                            <label for="createOrgWhatsapp">WhatsApp</label>
                            <input type="text" id="createOrgWhatsapp" placeholder="Nummer of link">
                        </div>
                        <div class="form-group">
                            <label for="createOrgAddress">Adres</label>
                            <input type="text" id="createOrgAddress" placeholder="Straat, postcode, plaats">
                        </div>
                        <div class="form-row">
                            <div class="form-group" style="flex:1">
                                <label for="createOrgFacebook">Facebook</label>
                                <input type="url" id="createOrgFacebook" placeholder="https://facebook.com/...">
                            </div>
                            <div class="form-group" style="flex:1">
                                <label for="createOrgInstagram">Instagram</label>
                                <input type="url" id="createOrgInstagram" placeholder="https://instagram.com/...">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group" style="flex:1">
                                <label for="createOrgTwitter">Twitter / X</label>
                                <input type="url" id="createOrgTwitter" placeholder="https://">
                            </div>
                            <div class="form-group" style="flex:1">
                                <label for="createOrgLinkedin">LinkedIn</label>
                                <input type="url" id="createOrgLinkedin" placeholder="https://">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="createOrgBrandColorHex">Brandkleur (hex, bijv. #0066CC)</label>
                            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                                <input type="color" id="createOrgBrandColorPicker" value="#0066CC" style="width:48px;height:40px;padding:0;border:1px solid #ddd;border-radius:6px;cursor:pointer;">
                                <input type="text" id="createOrgBrandColorHex" placeholder="#RRGGBB" style="flex:1;min-width:120px;">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="createOrgLogoUrl">Logo-URL</label>
                            <input type="url" id="createOrgLogoUrl" placeholder="https://... (of alleen upload hieronder)">
                            <p class="text-muted" style="font-size:12px;margin-top:6px;margin-bottom:0;">Na opslaan kun je ook een bestand uploaden; dat krijgt voorrang boven de URL.</p>
                            <input type="file" id="createOrgLogoFile" accept="image/*" style="margin-top:8px;">
                        </div>
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="createOrgApproved" checked>
                                Direct goedgekeurd (zichtbaar in app)
                            </label>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-modal-close>Annuleren</button>
                    <button type="button" class="btn btn-primary" id="createOrganizationSubmitBtn">Organisatie aanmaken</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const picker = modal.querySelector('#createOrgBrandColorPicker');
        const hexEl = modal.querySelector('#createOrgBrandColorHex');
        if (picker && hexEl) {
            picker.addEventListener('input', () => { hexEl.value = picker.value.toUpperCase(); });
            hexEl.addEventListener('change', () => {
                const v = hexEl.value.trim();
                if (/^#[0-9A-Fa-f]{6}$/i.test(v)) picker.value = v;
            });
        }
        const close = () => modal.remove();
        modal.querySelectorAll('.modal-close, [data-modal-close]').forEach((el) => el.addEventListener('click', close));
        modal.querySelector('.modal-content')?.addEventListener('click', (e) => e.stopPropagation());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('#createOrganizationSubmitBtn')?.addEventListener('click', async () => {
            const name = document.getElementById('createOrgName')?.value?.trim();
            if (!name) {
                self.showNotification('Naam is verplicht', 'error');
                return;
            }
            const hexRaw = document.getElementById('createOrgBrandColorHex')?.value?.trim() || '';
            const brand_color = /^#[0-9A-Fa-f]{6}$/i.test(hexRaw) ? hexRaw : undefined;
            const logoUrlField = document.getElementById('createOrgLogoUrl')?.value?.trim() || '';
            const logoFile = document.getElementById('createOrgLogoFile')?.files?.[0];
            const body = {
                name,
                category: document.getElementById('createOrgCategory')?.value?.trim() || undefined,
                description: document.getElementById('createOrgDescription')?.value?.trim() || undefined,
                bio: document.getElementById('createOrgBio')?.value?.trim() || undefined,
                email: document.getElementById('createOrgEmail')?.value?.trim() || undefined,
                website: document.getElementById('createOrgWebsite')?.value?.trim() || undefined,
                phone: document.getElementById('createOrgPhone')?.value?.trim() || undefined,
                whatsapp: document.getElementById('createOrgWhatsapp')?.value?.trim() || undefined,
                address: document.getElementById('createOrgAddress')?.value?.trim() || undefined,
                facebook: document.getElementById('createOrgFacebook')?.value?.trim() || undefined,
                instagram: document.getElementById('createOrgInstagram')?.value?.trim() || undefined,
                twitter: document.getElementById('createOrgTwitter')?.value?.trim() || undefined,
                linkedin: document.getElementById('createOrgLinkedin')?.value?.trim() || undefined,
                brand_color,
                logo_url: !logoFile && logoUrlField ? logoUrlField : undefined,
                is_approved: document.getElementById('createOrgApproved')?.checked !== false
            };
            try {
                const res = await fetch(`${self.apiBaseUrl}/admin/organizations`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${self.token}`
                    },
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    self.showNotification(data.message || data.error || `Aanmaken mislukt (${res.status})`, 'error');
                    return;
                }
                const newId = data.organization?.id;
                const createdOrg = data.organization;
                if (logoFile && newId) {
                    try {
                        const uploaded = await self.uploadOrganizationLogo(newId, logoFile);
                        if (uploaded) {
                            await fetch(`${self.apiBaseUrl}/admin/organizations/${newId}`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${self.token}`
                                },
                                body: JSON.stringify({ logo_url: uploaded })
                            });
                        }
                    } catch (upErr) {
                        console.error(upErr);
                        self.showNotification(`Organisatie aangemaakt, maar logo upload mislukt: ${upErr.message || upErr}`, 'warning');
                    }
                }
                await self.loadOrganizations();
                self.showNotification('Organisatie aangemaakt', 'success');
                if (typeof onCreatedOrg === 'function' && createdOrg) {
                    try {
                        onCreatedOrg(createdOrg);
                    } catch (cbErr) {
                        console.warn('onCreatedOrg:', cbErr);
                    }
                }
                close();
            } catch (e) {
                console.error(e);
                self.showNotification('Fout bij aanmaken organisatie', 'error');
            }
        });
    }

    async editOrganization(id) {
        try {
            console.log('[Admin] editOrganization gestart, id =', id);
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            console.log('[Admin] editOrganization response status:', response.status, 'ok:', response.ok);
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                console.error('[Admin] editOrganization error response:', err);
                this.showNotification(err.error || 'Organisatie laden mislukt', 'error');
                return;
            }
            const data = await response.json();
            console.log('[Admin] editOrganization data:', data);
            const org = data.organization;
            if (!org) {
                console.error('[Admin] editOrganization: geen organization in response');
                this.showNotification('Organisatie niet gevonden', 'error');
                return;
            }
            const escQ = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            const escTA = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const brandPickerVal = (org.brand_color && /^#[0-9A-Fa-f]{6}$/i.test(org.brand_color)) ? org.brand_color : '#0066CC';
            const logoPreview = org.logo_url
                ? `<div class="form-group"><label>Huidig logo</label><img src="${escQ(org.logo_url)}" alt="Logo" class="avatar-img" style="max-height:80px;border-radius:8px;display:block;" onerror="this.style.display='none'"></div>`
                : '';
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content modal-large">
                    <div class="modal-header">
                        <h3>Organisatie bewerken</h3>
                        <button type="button" class="modal-close" data-modal-close aria-label="Sluiten"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body">
                        <form id="editOrganizationForm">
                            <div class="form-group">
                                <label for="editOrgName">Naam *</label>
                                <input type="text" id="editOrgName" value="${escQ(org.name)}" required>
                            </div>
                            <div class="form-group">
                                <label for="editOrgCategory">Categorie</label>
                                <input type="text" id="editOrgCategory" value="${escQ(org.category)}" placeholder="bijv. Vereniging">
                            </div>
                            <div class="form-group">
                                <label for="editOrgDescription">Beschrijving</label>
                                <textarea id="editOrgDescription" rows="3">${escTA(org.description)}</textarea>
                            </div>
                            <div class="form-group">
                                <label for="editOrgBio">Bio</label>
                                <textarea id="editOrgBio" rows="2">${escTA(org.bio)}</textarea>
                            </div>
                            <div class="form-group">
                                <label for="editOrgEmail">E-mail</label>
                                <input type="email" id="editOrgEmail" value="${escQ(org.email)}">
                            </div>
                            <div class="form-group">
                                <label for="editOrgWebsite">Website</label>
                                <input type="url" id="editOrgWebsite" value="${escQ(org.website)}" placeholder="https://">
                            </div>
                            <div class="form-group">
                                <label for="editOrgPhone">Telefoon</label>
                                <input type="text" id="editOrgPhone" value="${escQ(org.phone)}">
                            </div>
                            <div class="form-group">
                                <label for="editOrgWhatsapp">WhatsApp</label>
                                <input type="text" id="editOrgWhatsapp" value="${escQ(org.whatsapp)}">
                            </div>
                            <div class="form-group">
                                <label for="editOrgAddress">Adres</label>
                                <input type="text" id="editOrgAddress" value="${escQ(org.address)}">
                            </div>
                            <div class="form-row">
                                <div class="form-group" style="flex:1">
                                    <label for="editOrgFacebook">Facebook</label>
                                    <input type="url" id="editOrgFacebook" value="${escQ(org.facebook)}" placeholder="https://">
                                </div>
                                <div class="form-group" style="flex:1">
                                    <label for="editOrgInstagram">Instagram</label>
                                    <input type="url" id="editOrgInstagram" value="${escQ(org.instagram)}" placeholder="https://">
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group" style="flex:1">
                                    <label for="editOrgTwitter">Twitter / X</label>
                                    <input type="url" id="editOrgTwitter" value="${escQ(org.twitter)}" placeholder="https://">
                                </div>
                                <div class="form-group" style="flex:1">
                                    <label for="editOrgLinkedin">LinkedIn</label>
                                    <input type="url" id="editOrgLinkedin" value="${escQ(org.linkedin)}" placeholder="https://">
                                </div>
                            </div>
                            <div class="form-group">
                                <label for="editOrgBrandColorHex">Brandkleur (hex)</label>
                                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                                    <input type="color" id="editOrgBrandColorPicker" value="${brandPickerVal}" style="width:48px;height:40px;padding:0;border:1px solid #ddd;border-radius:6px;cursor:pointer;">
                                    <input type="text" id="editOrgBrandColorHex" placeholder="#RRGGBB" value="${escQ(org.brand_color || '')}" style="flex:1;min-width:120px;">
                                </div>
                            </div>
                            ${logoPreview}
                            <div class="form-group">
                                <label for="editOrgLogoUrl">Logo-URL</label>
                                <input type="url" id="editOrgLogoUrl" value="${escQ(org.logo_url)}" placeholder="https://...">
                                <p class="text-muted" style="font-size:12px;margin-top:6px;">Nieuw bestand uploaden overschrijft de URL hierboven.</p>
                                <input type="file" id="editOrgLogoFile" accept="image/*" style="margin-top:8px;">
                            </div>
                            <div class="form-group">
                                <label for="editOrgPrivacy">Privacyverklaring (tekst voor in de app)</label>
                                <textarea id="editOrgPrivacy" rows="4" placeholder="Optioneel">${escTA(org.privacy_statement)}</textarea>
                            </div>
                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="editOrgApproved" ${org.is_approved ? 'checked' : ''}>
                                    Goedgekeurd (zichtbaar in app)
                                </label>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-modal-close>Annuleren</button>
                        <button type="button" class="btn btn-primary" id="editOrganizationSubmitBtn">Opslaan</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            console.log('[Admin] editOrganization: modal toegevoegd aan DOM');
            const picker = modal.querySelector('#editOrgBrandColorPicker');
            const hexEl = modal.querySelector('#editOrgBrandColorHex');
            if (picker && hexEl) {
                picker.addEventListener('input', () => { hexEl.value = picker.value.toUpperCase(); });
                hexEl.addEventListener('change', () => {
                    const v = hexEl.value.trim();
                    if (/^#[0-9A-Fa-f]{6}$/i.test(v)) picker.value = v;
                });
            }
            modal.querySelectorAll('.modal-close, [data-modal-close]').forEach(el => {
                el.addEventListener('click', () => modal.remove());
            });
            modal.querySelector('.modal-content').addEventListener('click', (e) => e.stopPropagation());
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
            modal.querySelector('#editOrganizationSubmitBtn').addEventListener('click', async () => {
                console.log('[Admin] editOrganization: Opslaan-knop geklikt');
                const name = document.getElementById('editOrgName').value.trim();
                if (!name) {
                    this.showNotification('Naam is verplicht', 'error');
                    return;
                }
                let logo_url = document.getElementById('editOrgLogoUrl').value.trim();
                const logoFile = document.getElementById('editOrgLogoFile')?.files?.[0];
                if (logoFile) {
                    try {
                        const up = await this.uploadOrganizationLogo(id, logoFile);
                        if (up) logo_url = up;
                    } catch (e) {
                        console.error(e);
                        this.showNotification(e.message || 'Logo upload mislukt', 'error');
                        return;
                    }
                } else if (logo_url === '') {
                    logo_url = null;
                }
                const hexRaw = document.getElementById('editOrgBrandColorHex').value.trim();
                const brand_color = /^#[0-9A-Fa-f]{6}$/i.test(hexRaw) ? hexRaw : undefined;
                const body = {
                    name,
                    category: document.getElementById('editOrgCategory').value.trim() || undefined,
                    description: document.getElementById('editOrgDescription').value.trim() || undefined,
                    bio: document.getElementById('editOrgBio').value.trim() || undefined,
                    email: document.getElementById('editOrgEmail').value.trim() || undefined,
                    website: document.getElementById('editOrgWebsite').value.trim() || undefined,
                    phone: document.getElementById('editOrgPhone').value.trim() || undefined,
                    whatsapp: document.getElementById('editOrgWhatsapp').value.trim() || undefined,
                    address: document.getElementById('editOrgAddress').value.trim() || undefined,
                    facebook: document.getElementById('editOrgFacebook').value.trim() || undefined,
                    instagram: document.getElementById('editOrgInstagram').value.trim() || undefined,
                    twitter: document.getElementById('editOrgTwitter').value.trim() || undefined,
                    linkedin: document.getElementById('editOrgLinkedin').value.trim() || undefined,
                    brand_color,
                    logo_url,
                    privacy_statement: document.getElementById('editOrgPrivacy').value.trim() || undefined,
                    is_approved: document.getElementById('editOrgApproved').checked
                };
                const res = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify(body)
                });
                console.log('[Admin] editOrganization save response status:', res.status, 'ok:', res.ok);
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    console.error('[Admin] editOrganization save error response:', err);
                    this.showNotification(err.error || 'Opslaan mislukt', 'error');
                    return;
                }
                this.showNotification('Organisatie bijgewerkt', 'success');
                modal.remove();
                this.loadOrganizations();
            });
        } catch (e) {
            console.error('editOrganization error:', e);
            this.showNotification(e.message || 'Fout bij laden organisatie', 'error');
        }
    }

    deleteOrganization(id) {
        this.showNotification('Organisatie verwijderen functie is nog niet geïmplementeerd', 'info');
        // TODO: Implementeer delete organization
    }


    // Notification system
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-message">${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    // Load pending content
    async loadPendingContent() {
        const container = document.getElementById('pendingContent');
        if (!container) return;

        try {
            console.log('Loading pending content...');
            const response = await fetch(`${this.apiBaseUrl}/admin/pending`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Pending content loaded:', data);
                
                // Combine all pending items
                const allPending = [];
                
                // Add pending users
                if (data.users && data.users.length > 0) {
                    data.users.forEach(user => {
                        allPending.push({
                            type: 'user',
                            id: user.id,
                            title: `${user.first_name} ${user.last_name}`,
                            meta: `${user.email} • ${this.formatDate(user.created_at)}`,
                            icon: 'user-plus'
                        });
                    });
                }
                
                // Add pending organizations
                if (data.organizations && data.organizations.length > 0) {
                    data.organizations.forEach(org => {
                        allPending.push({
                            type: 'organization',
                            id: org.id,
                            title: org.name,
                            meta: `${org.contact_email || 'Geen email'} • ${this.formatDate(org.created_at)}`,
                            icon: 'building'
                        });
                    });
                }
                
                // Geen nieuws in moderatie: organisaties beheren publicatie/concept zelf in hun dashboard.

                if (data.events && data.events.length > 0) {
                    data.events.forEach((event) => {
                        allPending.push({
                            type: 'event',
                            id: event.id,
                            title: event.name || event.title || 'Zonder titel',
                            meta: `Evenement • ${this.formatDate(event.created_at)}`,
                            icon: 'calendar',
                        });
                    });
                }
                
                if (allPending.length === 0) {
                    container.innerHTML = '<p class="text-muted">Geen wachtende content</p>';
                } else {
                    container.innerHTML = allPending.map(item => `
            <div class="pending-item">
                <div class="content-icon">
                                <i class="fas fa-${item.icon}"></i>
                </div>
                <div class="content-info">
                                <div class="content-title">${item.title}</div>
                                <div class="content-meta">${item.meta}</div>
                </div>
                <div class="content-actions">
                                <button class="btn-icon btn-approve" onclick="admin.approveContent('${item.type}', ${item.id})" title="Goedkeuren">
                                    <i class="fas fa-check"></i>
                    </button>
                                <button class="btn-icon btn-reject" onclick="admin.rejectContent('${item.type}', ${item.id})" title="Afwijzen">
                                    <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
                    `).join('');
                }
            } else {
                console.log('Failed to load pending content:', response.status);
                container.innerHTML = '<p class="text-muted">Geen content wacht op goedkeuring</p>';
            }
        } catch (error) {
            console.log('Error loading pending content:', error.message);
            container.innerHTML = '<p class="text-muted">Geen content wacht op goedkeuring</p>';
        }
    }

    // Load recent activity
    async loadRecentActivity() {
        const container = document.getElementById('recentActivity');
        if (!container) return;

        try {
            console.log('Loading recent activity...');
            const response = await fetch(`${this.apiBaseUrl}/admin/pending`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Recent activity data:', data);
                
                // Show recent registrations (users and organizations)
                const recentActivity = [];
                
                // Add recent users
                if (data.users && data.users.length > 0) {
                    data.users.forEach(user => {
                        recentActivity.push({
                            title: `Nieuwe gebruiker geregistreerd`,
                            meta: `${user.first_name} ${user.last_name} • ${this.formatDate(user.created_at)}`,
                            icon: 'user-plus'
                        });
                    });
                }
                
                // Add recent organizations
                if (data.organizations && data.organizations.length > 0) {
                    data.organizations.forEach(org => {
                        recentActivity.push({
                            title: `Nieuwe organisatie geregistreerd`,
                            meta: `${org.name} • ${this.formatDate(org.created_at)}`,
                            icon: 'building'
                        });
                    });
                }
                
                if (recentActivity.length === 0) {
                    container.innerHTML = '<p class="text-muted">Geen recente activiteit</p>';
                } else {
                    container.innerHTML = recentActivity.map(item => `
            <div class="activity-item">
                <div class="content-icon">
                                <i class="fas fa-${item.icon}"></i>
                </div>
                <div class="content-info">
                                <div class="content-title">${item.title}</div>
                                <div class="content-meta">${item.meta}</div>
                </div>
            </div>
                    `).join('');
                }
            } else {
                console.log('Failed to load recent activity:', response.status);
                container.innerHTML = '<p class="text-muted">Geen recente activiteit</p>';
            }
        } catch (error) {
            console.log('Error loading recent activity:', error.message);
            container.innerHTML = '<p class="text-muted">Geen recente activiteit</p>';
        }
    }

    // ===== NEWS MANAGEMENT =====
    async loadNews() {
        try {
            console.log('🔄 Loading news from:', `${this.apiBaseUrl}/admin/news`);
            const response = await fetch(`${this.apiBaseUrl}/admin/news`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            console.log('📡 News response status:', response.status);
            console.log('📡 News response ok:', response.ok);
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ News data received:', data);
                console.log('📰 Number of articles:', data.news ? data.news.length : 0);
                this.displayNews(data.news || []);
            } else {
                const errorText = await response.text();
                console.error('❌ Failed to load news:', response.status, errorText);
                this.displayNews([]);
            }
        } catch (error) {
            console.error('💥 Error loading news:', error);
            console.error('Error details:', error.message, error.stack);
            this.displayNews([]);
        }
    }

    displayNews(news) {
        console.log('displayNews called with:', news);
        
        // Wait a bit for the DOM to update after section activation
        setTimeout(() => {
            // Try multiple possible container IDs
            let container = document.getElementById('newsList');
            if (!container) {
                container = document.getElementById('newsContent');
                console.log('newsList not found, trying newsContent:', container);
            }
            if (!container) {
                // Try old table body approach
                container = document.getElementById('newsTableBody');
                console.log('newsContent not found, trying newsTableBody:', container);
            }
            if (!container) {
                // Last resort: create container in news section
                const newsSection = document.getElementById('news');
                if (newsSection) {
                    console.log('Creating new container in news section');
                    container = document.createElement('div');
                    container.id = 'newsList';
                    newsSection.innerHTML = '';
                    newsSection.appendChild(container);
                }
            }
            
            console.log('Container found:', container);
            
            if (!container) {
                console.error('No container found!');
                console.log('Available elements with "news" in ID:', document.querySelectorAll('[id*="news"]'));
                return;
            }
            
            this.renderNewsContent(container, news);
        }, 200);
    }
    
    renderNewsContent(container, news) {
        console.log('🎯 renderNewsContent called');
        console.log('📦 News data:', news);
        console.log('📍 Container:', container);
        
        if (!news || news.length === 0) {
            console.log('❌ No news, showing empty state');
            container.innerHTML = `
                <div class="empty-message">
                    <p class="text-muted">Geen nieuws artikelen gevonden</p>
                    <p><small>Er zijn nog geen nieuwsartikelen aangemaakt.</small></p>
                </div>
            `;
            return;
        }
        
        console.log('✅ Rendering', news.length, 'news articles');

        const newsHTML = `
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Titel</th>
                            <th>Categorie</th>
                            <th>Organisatie</th>
                            <th>Status</th>
                            <th>Datum</th>
                            <th>Acties</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${news.map(article => `
                            <tr>
                                <td>
                                    <div class="news-title">
                                        <strong>${article.title}</strong>
                                        ${article.excerpt ? `<br><small class="text-muted">${article.excerpt.substring(0, 100)}${article.excerpt.length > 100 ? '...' : ''}</small>` : ''}
                                    </div>
                                </td>
                                <td>
                                    <span class="category-badge">${article.custom_category || article.category}</span>
                                </td>
                                <td>
                                    ${article.organization_name ? `
                                        <div class="org-info">
                                            <span>${article.organization_name}</span>
                                        </div>
                                    ` : '<span class="text-muted">Geen organisatie</span>'}
                                </td>
                                <td>
                                    <span class="status-badge published">
                                        Gepubliceerd
                                    </span>
                                </td>
                                <td>
                                    <small>${this.formatNewsArticleDate(article)}</small>
                                </td>
                                <td>
                                    <div class="action-buttons">
                                        <button class="btn btn-icon btn-view" data-action="view" data-id="${article.id}" title="Bekijken">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                        <button class="btn btn-icon btn-edit" data-action="edit" data-id="${article.id}" title="Bewerken">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn btn-icon btn-delete" data-action="delete" data-id="${article.id}" data-title="${article.title.replace(/"/g, '&quot;')}" title="Verwijderen">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = newsHTML;
        
        // Add event listeners to action buttons
        console.log('📌 Attaching event listeners to news action buttons');
        
        const self = this; // Bewaar this context
        
        container.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const id = parseInt(btn.getAttribute('data-id'));
                console.log('👁️ View button clicked for news:', id);
                self.viewNews(id);
            });
        });
        
        container.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const id = parseInt(btn.getAttribute('data-id'));
                console.log('✏️ Edit button clicked for news:', id);
                console.log('🔍 Checking editNews function:', typeof self.editNews);
                console.log('🔍 Self object:', self);
                try {
                    console.log('🚀 About to call editNews...');
                    await self.editNews(id);
                    console.log('✅ editNews completed');
                } catch (err) {
                    console.error('💥 Error calling editNews:', err);
                    console.error('💥 Error stack:', err.stack);
                    alert('Error: ' + err.message);
                }
            });
        });
        
        container.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const id = parseInt(btn.getAttribute('data-id'));
                const title = btn.getAttribute('data-title');
                console.log('🗑️ Delete button clicked for news:', id, title);
                self.deleteNews(id, title);
            });
        });
    }

    /**
     * Zet een datum-string (MySQL "YYYY-MM-DD HH:MM:SS" of ISO met Z) om naar
     * een waarde voor <input type="datetime-local"> ZONDER UTC-conversie.
     * Alle event-tijden worden als naïeve lokale tijd behandeld; de opgeslagen
     * waarde moet 1-op-1 terugkomen in het veld om tijdverschuiving te voorkomen.
     */
    _toDatetimeInputValue(value) {
        if (!value) return '';
        // Normaliseer spatie → T, strip Z of +HH:MM timezone suffix
        return String(value).replace(' ', 'T').replace(/Z$/, '').replace(/\+\d{2}:\d{2}$/, '').slice(0, 16);
    }

    /** Lokale kalenderdatum voor <input type="date"> (niet UTC via toISOString). */
    _newsLocalDateForInput(value) {
        if (value == null || value === '') return '';
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /** Lokale tijd voor <input type="time">. */
    _newsLocalTimeForInput(value) {
        if (value == null || value === '') return '12:00';
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '12:00';
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    /** Datum voor weergave in lijsten/modals: publicatiedatum (API: COALESCE), anders aanmaakmoment. */
    formatNewsArticleDate(article) {
        const when = article?.published_at || article?.created_at;
        if (!when) return '–';
        return new Date(when).toLocaleDateString('nl-NL');
    }

    /** Organisaties voor dropdowns alfabetisch op naam (nl). */
    _sortOrganizationsByName(organizations) {
        if (!Array.isArray(organizations)) return [];
        return [...organizations].sort((a, b) =>
            String(a?.name || '').localeCompare(String(b?.name || ''), 'nl', { sensitivity: 'base' })
        );
    }

    // Nieuwe uniforme functie voor nieuws modal (net als events)
    async openNewsModal(newsId = null, mode = 'create') {
        try {
            console.log('🎬 openNewsModal called');
            console.log('📝 Mode:', mode);
            console.log('🆔 News ID:', newsId);
            
            // Laad organizaties
            let organizations = [];
            try {
                console.log('Fetching organizations for news modal...');
                const response = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                console.log('Organizations fetch status:', response.status);
                if (response.ok) {
                    const data = await response.json();
                    organizations = this._sortOrganizationsByName(data.organizations || []);
                    console.log('Organizations loaded:', organizations.length);
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('Failed to load organizations:', errorData);
                    this.showNotification('Kon organisaties niet laden. Organisatie dropdown is mogelijk leeg.', 'warning');
                }
            } catch (error) {
                console.error('Error loading organizations:', error);
                this.showNotification('Fout bij laden organisaties. Organisatie dropdown is mogelijk leeg.', 'warning');
            }

            const categories = ['dorpsnieuws', 'sport', 'cultuur', 'onderwijs', 'zorg', 'overig'];
            
            // Als edit mode, haal nieuws artikel op
            let article = null;
            if (mode === 'edit' && newsId) {
                console.log('📡 Fetching article:', `${this.apiBaseUrl}/admin/news/${newsId}`);
                const res = await fetch(`${this.apiBaseUrl}/admin/news/${newsId}`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                console.log('📡 Article fetch status:', res.status);
                if (res.ok) {
                    const response = await res.json();
                    article = response.article; // API returns { article: {...} }
                    console.log('✅ Article loaded:', article);
                } else {
                    console.error('❌ Failed to load article:', res.status);
                    const errorText = await res.text();
                    console.error('Error response:', errorText);
                }
            }

            console.log('🔍 Article object:', article);
            console.log('🔍 Article structure:', JSON.stringify(article, null, 2).substring(0, 500));
            
            const isEdit = mode === 'edit' && article;
            const title = isEdit ? 'Nieuws Bewerken' : 'Nieuw Nieuws Artikel';
            const buttonText = isEdit ? 'Bijwerken' : 'Opslaan';
            
            // Publicatiedatum/tijd: API levert published_at als COALESCE(published_at, created_at) — die eerst gebruiken.
            // Geen toISOString() voor de datum (UTC verschuift de kalenderdag); lokale velden via helpers.
            const articleMoment = isEdit ? (article.published_at || article.created_at) : null;
            const pubDate = articleMoment
                ? this._newsLocalDateForInput(articleMoment)
                : this._newsLocalDateForInput(new Date());
            const pubTime = articleMoment
                ? this._newsLocalTimeForInput(articleMoment)
                : '12:00';

            console.log('📋 Creating modal overlay...');
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            console.log('📝 Building modal HTML...');
            overlay.innerHTML = `
                <div class="modal-content large">
                    <div class="modal-header">
                        <h3>${title}</h3>
                        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="newsForm" class="event-form">
                            <div class="form-group">
                                <label for="newsTitle">Titel *</label>
                                <input type="text" id="newsTitle" name="title" 
                                    value="${article?.title || ''}" 
                                    placeholder="Titel van het artikel" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="newsExcerpt">Samenvatting</label>
                                <textarea id="newsExcerpt" name="excerpt" rows="2" 
                                    placeholder="Korte samenvatting...">${article?.excerpt || ''}</textarea>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="newsCategory">Categorie</label>
                                    <select id="newsCategory" name="category">
                                        ${categories.map(cat => `
                                            <option value="${cat}" ${article?.category === cat ? 'selected' : ''}>
                                                ${cat.charAt(0).toUpperCase() + cat.slice(1)}
                                            </option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="newsOrganization">Organisatie</label>
                                    <select id="newsOrganization" name="organization_id">
                                        <option value="">Geen organisatie</option>
                                        ${organizations.map(org => `
                                            <option value="${org.id}" ${article?.organization_id == org.id ? 'selected' : ''}>
                                                ${org.name}
                                            </option>
                                        `).join('')}
                                    </select>
                                </div>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="newsPubDate">Publicatiedatum *</label>
                                    <input type="date" id="newsPubDate" name="published_date" 
                                        value="${pubDate}" required>
                                    <small class="form-hint">Datum waarop dit artikel wordt/werd gepubliceerd</small>
                                </div>
                                <div class="form-group">
                                    <label for="newsPubTime">Publicatietijd</label>
                                    <input type="time" id="newsPubTime" name="published_time" 
                                        value="${pubTime}">
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="newsImage">Afbeelding</label>
                                <input type="file" id="newsImage" accept="image/*" class="file-input"
                                    onchange="admin.previewNewsImage(this)">
                                <small class="form-hint">Of laat leeg om huidige afbeelding te behouden</small>
                                <div id="newsImagePreview" class="image-preview" style="display: none;">
                                    <img id="newsImagePreviewImg" src="" alt="Preview">
                                    <button type="button" class="btn-remove-image" 
                                        onclick="admin.removeNewsImagePreview()">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                                ${article?.image_url ? `
                                    <div class="current-image">
                                        <small>Huidige afbeelding:</small>
                                        <img src="${article.image_url}" alt="Current" style="max-width: 200px; margin-top: 8px;">
                                    </div>
                                ` : ''}
                            </div>
                            
                            <div class="form-group">
                                <label for="newsArticleContent">Inhoud *</label>
                                <textarea id="newsArticleContent" name="content" rows="10" 
                                    placeholder="De volledige inhoud van het artikel..." required>${article?.content || ''}</textarea>
                            </div>
                            
                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="newsPublished" name="is_published" 
                                        ${article?.is_published !== false ? 'checked' : ''}>
                                    <span>Direct publiceren (toon in app)</span>
                                </label>
                                <small class="form-hint">Uitvinken om als concept op te slaan</small>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                            Annuleren
                        </button>
                        <button class="btn btn-primary" onclick="admin.saveNews(${newsId ? `'${newsId}'` : 'null'})">
                            ${buttonText}
                        </button>
                    </div>
                </div>
            `;
            
            console.log('➕ Appending modal to body...');
            document.body.appendChild(overlay);
            console.log('✅ Modal appended successfully!');
            console.log('👁️ Modal overlay display:', window.getComputedStyle(overlay).display);
            console.log('👁️ Modal overlay visibility:', window.getComputedStyle(overlay).visibility);
            console.log('👁️ Modal overlay opacity:', window.getComputedStyle(overlay).opacity);
            console.log('👁️ Modal overlay z-index:', window.getComputedStyle(overlay).zIndex);
            
            // Force display
            overlay.style.display = 'flex';
            overlay.style.visibility = 'visible';
            overlay.style.opacity = '1';
            console.log('🔧 Forced modal display to flex');
        } catch (e) {
            console.error('openNewsModal error:', e);
            console.error('💥 Stack:', e.stack);
            this.showNotification('Fout bij openen nieuws-modal', 'error');
        }
    }

    async showCreateNewsModal() {
        // Roep nieuwe uniforme functie aan
        await this.openNewsModal(null, 'create');
    }

    async editNews(newsId) {
        console.log('✏️ editNews called with ID:', newsId);
        try {
            // Roep nieuwe uniforme functie aan
            await this.openNewsModal(newsId, 'edit');
        } catch (error) {
            console.error('💥 Error in editNews:', error);
            console.error('Stack:', error.stack);
            this.showNotification('Fout bij bewerken nieuws', 'error');
        }
    }

    // Helper functiesvoor image preview
    previewNewsImage(input) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = document.getElementById('newsImagePreview');
                const img = document.getElementById('newsImagePreviewImg');
                img.src = e.target.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(input.files[0]);
        }
    }

    removeNewsImagePreview() {
        document.getElementById('newsImage').value = '';
        document.getElementById('newsImagePreview').style.display = 'none';
    }

    async compressNewsImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Reduceer max size naar 800px voor kleinere bestanden
                    const maxSize = 800;
                    if (width > height && width > maxSize) {
                        height = (height / width) * maxSize;
                        width = maxSize;
                    } else if (height > maxSize) {
                        width = (width / height) * maxSize;
                        height = maxSize;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Start met lagere quality (0.6 in plaats van 0.8)
                    let quality = 0.6;
                    let compressed = canvas.toDataURL('image/jpeg', quality);
                    
                    // Als nog te groot, comprimeer verder
                    const maxBytes = 3 * 1024 * 1024; // 3MB target
                    while (compressed.length > maxBytes && quality > 0.3) {
                        quality -= 0.1;
                        compressed = canvas.toDataURL('image/jpeg', quality);
                    }
                    
                    console.log('Compressed image:', {
                        originalSize: file.size,
                        compressedLength: compressed.length,
                        quality: quality.toFixed(1),
                        dimensions: `${Math.round(width)}x${Math.round(height)}`
                    });
                    
                    resolve(compressed);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async saveNews(newsId) {
        try {
            // Parse newsId correct (kan 'null' string zijn)
            const actualNewsId = newsId && newsId !== 'null' && newsId !== null ? parseInt(newsId) : null;
            
            const title = (document.getElementById('newsTitle').value || '').trim();
            const excerpt = (document.getElementById('newsExcerpt').value || '').trim();
            const content = (document.getElementById('newsArticleContent').value || '').trim();
            const category = document.getElementById('newsCategory')?.value;
            const organization_id_val = document.getElementById('newsOrganization')?.value;
            const organization_id = (organization_id_val && organization_id_val !== '' && organization_id_val !== '0') 
                ? parseInt(organization_id_val) 
                : null;

            const pubDateVal = (document.getElementById('newsPubDate')?.value || '').trim();
            const pubTimeRaw = (document.getElementById('newsPubTime')?.value || '').trim() || '12:00';
            const timeParts = pubTimeRaw.split(':');
            const hh = String(Math.min(23, Math.max(0, parseInt(timeParts[0], 10) || 0))).padStart(2, '0');
            const mm = String(Math.min(59, Math.max(0, parseInt(timeParts[1], 10) || 0))).padStart(2, '0');
            const published_at = pubDateVal ? `${pubDateVal} ${hh}:${mm}:00` : undefined;
            
            // Handle image upload
            const uploadedFile = document.getElementById('newsImage')?.files[0];
            let imageUrl = null;
            
            if (uploadedFile) {
                try {
                    const compressedBase64 = await this.compressNewsImage(uploadedFile);
                    console.log('News image compressed (temp base64), length:', compressedBase64.length);
                    
                    if (compressedBase64.length > 4 * 1024 * 1024) {
                        this.showNotification('Afbeelding is te groot. Kies een kleinere afbeelding.', 'error');
                        return;
                    }

                    // Upload to backend (folder uploads/YYYY/MM/<orgNum>/)
                    const uploadRes = await fetch(`${this.apiBaseUrl}/upload/image`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({
                            imageData: compressedBase64,
                            filename: `news-image-${Date.now()}.jpg`,
                            organizationId: organization_id != null ? organization_id : undefined
                        })
                    });
                    if (!uploadRes.ok) {
                        let msg = `HTTP ${uploadRes.status}`;
                        try { const j = await uploadRes.json(); msg = j.message || j.error || msg; } catch {}
                        throw new Error(msg);
                    }
                    const uploadJson = await uploadRes.json();
                    imageUrl = uploadJson.imageUrl || null;
                } catch (error) {
                    console.error('Error processing image:', error);
                    this.showNotification('Fout bij verwerken van afbeelding', 'error');
                    return;
                }
            } else if (actualNewsId) {
                // Bij bewerken zonder nieuwe afbeelding, behoud bestaande
                imageUrl = undefined; // Stuur undefined zodat backend bestaande waarde behoudt
            }

            // Validatie met debug logging
            console.log('=== NEWS VALIDATION ===');
            console.log('Title:', title, '(length:', title.length, ')');
            console.log('Content:', content, '(length:', content.length, ')');
            console.log('Title empty?', !title);
            console.log('Content empty?', !content);
            
            if (!title || !content) {
                const missingFields = [];
                if (!title) missingFields.push('Titel');
                if (!content) missingFields.push('Inhoud');
                this.showNotification(`Vul de volgende verplichte velden in: ${missingFields.join(', ')}`, 'error');
                return;
            }

            const body = {
                title,
                excerpt: excerpt || null,
                content,
                category,
                organization_id,
                is_published: document.getElementById('newsPublished').checked
            };
            if (published_at !== undefined) {
                body.published_at = published_at;
            }
            
            // Voeg image_url alleen toe als het gedefinieerd is
            if (imageUrl !== undefined) {
                body.image_url = imageUrl;
            }

            const url = actualNewsId ? `${this.apiBaseUrl}/admin/news/${actualNewsId}` : `${this.apiBaseUrl}/news`;
            const method = actualNewsId ? 'PUT' : 'POST';

            console.log('🚀 Sending request:', { url, method, body });
            console.log('🔍 Body keys:', Object.keys(body));
            console.log('❌ published_at in body?', 'published_at' in body);

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try { 
                    const j = await res.json(); 
                    msg = j.message || j.error || msg;
                } catch {}
                this.showNotification(`Opslaan mislukt: ${msg}`, 'error');
                return;
            }

            this.showNotification('Nieuws artikel opgeslagen', 'success');
            document.getElementById('newsTitle')?.closest('.modal-overlay')?.remove();
            this.loadNews();
        } catch (e) {
            console.error('saveNews error:', e);
            this.showNotification(`Fout bij opslaan nieuws: ${e?.message || 'Onbekende fout'}`, 'error');
        }
    }

    async viewNews(newsId) {
        try {
            console.log('🔍 viewNews called with ID:', newsId);
            const response = await fetch(`${this.apiBaseUrl}/admin/news`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            console.log('📡 Response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                console.log('📦 All news:', data.news.length);
                const article = data.news.find(n => n.id === newsId);
                
                console.log('📰 Found article:', article ? 'YES' : 'NO');
                
                if (article) {
                    console.log('🎬 Calling showNewsModal');
                    this.showNewsModal(article);
                } else {
                    console.error('❌ Article not found with ID:', newsId);
                    this.showNotification('Nieuws artikel niet gevonden', 'error');
                }
            } else {
                console.error('❌ Response not OK:', response.status);
                this.showNotification('Fout bij laden nieuws artikel', 'error');
            }
        } catch (error) {
            console.error('💥 Error viewing news:', error);
            console.error('Stack:', error.stack);
            this.showNotification('Fout bij laden nieuws artikel', 'error');
        }
    }

    showNewsModal(article) {
        console.log('🎬 showNewsModal started');
        console.log('📰 Article:', article);
        
        // Create modal element
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.style.display = 'flex';
        
        console.log('✅ Modal overlay created');
        
        // Close on overlay click
        modalOverlay.addEventListener('click', function(e) {
            if (e.target === modalOverlay) {
                console.log('🚪 Closing modal (overlay click)');
                modalOverlay.remove();
            }
        });
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        
        console.log('✅ Modal content created');
        
        // Prevent content clicks from closing modal
        modalContent.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        
        // Hero Image
        let heroHTML = '';
        if (article.image_url) {
            heroHTML = `
                <div class="modal-hero-image">
                    <img src="${article.image_url}" alt="${article.title}">
                    <div class="modal-hero-overlay"></div>
                </div>
            `;
        } else {
            heroHTML = `
                <div class="modal-hero-image">
                    <div class="modal-hero-fallback">
                        <i class="fas fa-newspaper"></i>
                    </div>
                </div>
            `;
        }
        
        // Close Button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn modal-close-btn-white';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        
        // Close button functionality
        closeBtn.addEventListener('click', function() {
            modalOverlay.remove();
        });
        
        // Content
        const contentHTML = `
            <div class="modal-body-content">
                <!-- Title -->
                <h2 class="modal-title">${article.title}</h2>
                
                <!-- Meta Info -->
                <div class="news-meta">
                    <div class="news-meta-item">
                        <i class="fas fa-calendar-alt"></i>
                        <span>${this.formatNewsArticleDate(article)}</span>
                    </div>
                    <div class="news-meta-item">
                        <i class="fas fa-tag"></i>
                        <span>${article.custom_category || article.category}</span>
                    </div>
                    ${article.organization_name ? `
                        <div class="news-meta-item">
                            <i class="fas fa-building"></i>
                            <span>${article.organization_name}</span>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Excerpt -->
                ${article.excerpt ? `
                    <div class="news-excerpt">
                        <p>${article.excerpt}</p>
                    </div>
                ` : ''}
                
                <!-- Content -->
                <div class="news-content">
                    <div class="news-content-text">${article.content}</div>
                </div>
                
                <!-- Author -->
                <div class="news-author">
                    <i class="fas fa-user"></i>
                    <span>Door ${article.first_name} ${article.last_name}</span>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="modal-footer-content">
                <button class="btn btn-secondary">Sluiten</button>
            </div>
        `;
        
        // Assemble modal
        modalContent.innerHTML = heroHTML + contentHTML;
        modalContent.appendChild(closeBtn);
        modalOverlay.appendChild(modalContent);
        
        // Add close functionality to footer button
        const footerBtn = modalContent.querySelector('.btn-secondary');
        footerBtn.addEventListener('click', function() {
            modalOverlay.remove();
        });
        
        // Add to DOM
        document.body.appendChild(modalOverlay);
    }


    async deleteNews(newsId, title) {
        if (!confirm(`Weet je zeker dat je "${title}" wilt verwijderen?`)) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/news/${newsId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                this.showNotification('Nieuws artikel verwijderd', 'success');
                this.loadNews();
            } else {
                const error = await response.json();
                this.showNotification(`Fout bij verwijderen: ${error.message || 'Onbekende fout'}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting news:', error);
            this.showNotification('Fout bij verwijderen nieuws artikel', 'error');
        }
    }

    // Events management
    async loadEvents() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/events`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.allEventsCache = Array.isArray(data.events) ? data.events : [];
                this.updateEventsView();
            } else {
                const container = document.getElementById('eventsContent');
                if (container) container.innerHTML = '<p>Fout bij laden events.</p>';
            }
        } catch (error) {
            console.error('Error loading events:', error);
            const container = document.getElementById('eventsContent');
            if (container) container.innerHTML = '<p>Fout bij laden events.</p>';
        }
    }

    updateEventsView() {
        const events = Array.isArray(this.allEventsCache) ? [...this.allEventsCache] : [];
        const now = new Date();

        let filtered;
        if (this.currentEventsTab === 'archief') {
            // Verlopen evenementen: einddatum (of startdatum) ligt in het verleden
            filtered = events.filter(ev => {
                const end = ev.event_end_date || ev.end_date || ev.event_date;
                if (!end) return false;
                const endDate = new Date(end);
                return endDate < now;
            });
        } else {
            // Actieve/toekomstige evenementen: geen datum óf einddatum ligt vandaag/in de toekomst
            filtered = events.filter(ev => {
                const end = ev.event_end_date || ev.end_date || ev.event_date;
                if (!end) return true;
                const endDate = new Date(end);
                return endDate >= now;
            });
        }

        this.displayEvents(filtered);
    }

    displayEvents(events) {
        const container = document.getElementById('eventsContent');
        if (!container) return;

        const rows = (events || []).map(ev => {
            const startTxt = ev.event_date ? new Date(ev.event_date).toLocaleString('nl-NL') : '-';
            const endTxt = ev.event_end_date ? new Date(ev.event_end_date).toLocaleString('nl-NL') : '';
            const dateCell = endTxt ? `${startTxt} – ${endTxt}` : startTxt;
            return `
            <tr>
                <td>${ev.title}</td>
                <td>${dateCell}</td>
                <td>${ev.location || '-'}</td>
                <td>${ev.organization_name || '-'}</td>
                <td><span class="status-badge status-published">GEPUBLICEERD</span></td>
                <td>
                    <div class="action-buttons">
                        <button type="button" class="btn-icon btn-view" data-event-action="view" data-event-id="${ev.id}" title="Bekijken">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button type="button" class="btn-icon btn-edit" data-event-action="edit" data-event-id="${ev.id}" title="Bewerken">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="btn-icon btn-delete" data-event-action="delete" data-event-id="${ev.id}" data-event-title="${encodeURIComponent(ev.title || '')}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="section-header">
                <h2>Evenementen</h2>
            </div>
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Titel</th>
                            <th>Datum/Tijd</th>
                            <th>Locatie</th>
                            <th>Organisatie</th>
                            <th>Status</th>
                            <th>Acties</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || ''}
                    </tbody>
                </table>
            </div>
        `;
    }

    async viewEvent(id, eventData = null) {
        try {
            let event;
            if (eventData) {
                event = eventData;
            } else if (Array.isArray(this.allEventsCache)) {
                event = this.allEventsCache.find((e) => Number(e.id) === Number(id));
            }
            if (!event) {
                const response = await fetch(`${this.apiBaseUrl}/events/${id}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                event = await response.json();
            }
            this.showEventPreviewModal(event);
        } catch (err) {
            console.error('Error loading event:', err);
            this.showNotification('Fout bij laden evenement', 'error');
        }
    }

    async editEvent(id) {
        // Gebruik de nieuwe uniforme openEventModal functie
        await this.openEventModal(id, 'edit');
    }

    async deleteEvent(id, title) {
        if (!confirm(`Weet je zeker dat je "${title}" wilt verwijderen?`)) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/events/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.showNotification('Evenement succesvol verwijderd', 'success');
                this.loadEvents(); // Herlaad de lijst
                this.loadNotificationCounts(); // Refresh notification badges
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Fout bij verwijderen', 'error');
            }
        } catch (err) {
            console.error('Error deleting event:', err);
            this.showNotification('Fout bij verwijderen evenement', 'error');
        }
    }

    async openCreateEventModal() {
        // Gebruik de nieuwe uniforme openEventModal functie
        await this.openEventModal(null, 'create');
    }

    showCreateEventModal(organizations) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Nieuw Evenement</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="createEventForm">
                        <div class="form-group">
                            <label for="eventTitle">Titel *</label>
                            <input type="text" id="eventTitle" name="title" placeholder="Evenement titel">
                        </div>
                        
                        <div class="form-group">
                            <label for="eventOrganization">Organisatie</label>
                            <select id="eventOrganization" name="organization_id">
                                <option value="">Selecteer organisatie</option>
                                ${organizations.map(org => `<option value="${org.id}">${org.name}</option>`).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="eventDescription">Beschrijving</label>
                            <textarea id="eventDescription" name="description" rows="4" placeholder="Beschrijving van het evenement"></textarea>
                        </div>
                        
                        <div class="form-group">
                            <label for="eventLocation">Locatie</label>
                            <input type="text" id="eventLocation" name="location" placeholder="Locatie van het evenement">
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="eventStartDate">Start Datum</label>
                                <input type="date" id="eventStartDate" name="event_date">
                            </div>
                            <div class="form-group">
                                <label for="eventStartTime">Start Tijd</label>
                                <input type="time" id="eventStartTime" name="start_time">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="eventEndDate">Eind Datum</label>
                                <input type="date" id="eventEndDate" name="end_date">
                            </div>
                            <div class="form-group">
                                <label for="eventEndTime">Eind Tijd</label>
                                <input type="time" id="eventEndTime" name="end_time">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="eventImageUrl">Afbeelding URL</label>
                            <input type="url" id="eventImageUrl" name="image_url" placeholder="https://...">
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuleren</button>
                    <button type="button" class="btn btn-primary" onclick="admin.createEvent()">Opslaan</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    async openEditEventModal(event, organizations) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        
        // Format dates for input fields — gebruik _toDatetimeInputValue zodat de opgeslagen
        // tijd (behandeld als lokaal/naïef) 1-op-1 terugkomt in het veld, zonder UTC-verschuiving.
        const _dtv = (v) => this._toDatetimeInputValue(v);
        const startDate = event.event_date ? _dtv(event.event_date).slice(0, 10) : '';
        const startTime = event.event_date ? _dtv(event.event_date).slice(11, 16) : '';
        const endDate = event.event_end_date ? _dtv(event.event_end_date).slice(0, 10) : '';
        const endTime = event.event_end_date ? _dtv(event.event_end_date).slice(11, 16) : '';
        
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Evenement Bewerken</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="editEventForm">
                        <div class="form-group">
                            <label for="editEventTitle">Titel *</label>
                            <input type="text" id="editEventTitle" name="title" value="${event.title || ''}" placeholder="Evenement titel">
                        </div>
                        
                        <div class="form-group">
                            <label for="editEventOrganization">Organisatie</label>
                            <select id="editEventOrganization" name="organization_id">
                                <option value="">Selecteer organisatie</option>
                                ${organizations.map(org => `<option value="${org.id}" ${org.id == event.organization_id ? 'selected' : ''}>${org.name}</option>`).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="editEventDescription">Beschrijving</label>
                            <textarea id="editEventDescription" name="description" rows="4" placeholder="Beschrijving van het evenement">${event.description || ''}</textarea>
                        </div>
                        
                        <div class="form-group">
                            <label for="editEventLocation">Locatie</label>
                            <input type="text" id="editEventLocation" name="location" value="${event.location || ''}" placeholder="Locatie van het evenement">
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="editEventStartDate">Start Datum</label>
                                <input type="date" id="editEventStartDate" name="event_date" value="${startDate}">
                            </div>
                            <div class="form-group">
                                <label for="editEventStartTime">Start Tijd</label>
                                <input type="time" id="editEventStartTime" name="start_time" value="${startTime}">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="editEventEndDate">Eind Datum</label>
                                <input type="date" id="editEventEndDate" name="end_date" value="${endDate}">
                            </div>
                            <div class="form-group">
                                <label for="editEventEndTime">Eind Tijd</label>
                                <input type="time" id="editEventEndTime" name="end_time" value="${endTime}">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="editEventImageUrl">Afbeelding URL</label>
                            <input type="url" id="editEventImageUrl" name="image_url" value="${event.image_url || ''}" placeholder="https://...">
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuleren</button>
                    <button type="button" class="btn btn-primary" onclick="admin.updateEvent(${event.id})">Opslaan</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    async createEvent() {
        const form = document.getElementById('createEventForm');
        if (!form) return;

        const formData = new FormData(form);
        const eventData = {
            title: formData.get('title'),
            organization_id: formData.get('organization_id') || null,
            description: formData.get('description'),
            location: formData.get('location'),
            event_date: formData.get('event_date'),
            event_end_date: formData.get('end_date'),
            image_url: formData.get('image_url'),
            is_published: true // Automatisch goedgekeurd
        };

        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/events`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventData)
            });

            if (response.ok) {
                this.showNotification('Evenement succesvol aangemaakt', 'success');
                document.getElementById('createEventForm')?.closest('.modal-overlay')?.remove();
                this.loadEvents(); // Herlaad de lijst
                this.loadNotificationCounts(); // Refresh notification badges
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Fout bij aanmaken', 'error');
            }
        } catch (err) {
            console.error('Error creating event:', err);
            this.showNotification('Fout bij aanmaken evenement', 'error');
        }
    }

    async updateEvent(id) {
        const form = document.getElementById('editEventForm');
        if (!form) return;

        const formData = new FormData(form);
        const eventData = {
            title: formData.get('title'),
            organization_id: formData.get('organization_id') || null,
            description: formData.get('description'),
            location: formData.get('location'),
            event_date: formData.get('event_date'),
            event_end_date: formData.get('end_date'),
            image_url: formData.get('image_url'),
            is_published: true // Automatisch goedgekeurd
        };

        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/events/${id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventData)
            });

            if (response.ok) {
                this.showNotification('Evenement succesvol bijgewerkt', 'success');
                document.getElementById('editEventForm')?.closest('.modal-overlay')?.remove();
                this.loadEvents(); // Herlaad de lijst
                this.loadNotificationCounts(); // Refresh notification badges
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Fout bij bijwerken', 'error');
            }
        } catch (err) {
            console.error('Error updating event:', err);
            this.showNotification('Fout bij bijwerken evenement', 'error');
        }
    }

    showEventPreviewModal(event) {
        const eventDate = event.event_date ? new Date(event.event_date).toLocaleDateString('nl-NL', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : '';
        const eventTime = event.event_date ? new Date(event.event_date).toLocaleTimeString('nl-NL', {
            hour: '2-digit',
            minute: '2-digit'
        }) : '';
        const endTime = event.event_end_date ? new Date(event.event_end_date).toLocaleTimeString('nl-NL', {
            hour: '2-digit',
            minute: '2-digit'
        }) : '';

        // Create modal element
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        
        // Close on overlay click
        modalOverlay.addEventListener('click', function(e) {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
            }
        });
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        
        // Prevent content clicks from closing modal
        modalContent.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        
        // Hero Image
        const heroImage = event.image_url || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80';
        let heroHTML = `
            <div class="modal-hero-image">
                <img src="${heroImage}" alt="${event.title || 'Event'}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="modal-hero-fallback" style="display: none;">
                    <i class="fas fa-calendar-alt"></i>
                </div>
                <div class="modal-hero-overlay"></div>
            </div>
        `;
        
        // Close Button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        
        // Close button functionality
        closeBtn.addEventListener('click', function() {
            modalOverlay.remove();
        });
        
        // Content
        const contentHTML = `
            <div class="modal-body-content">
                <!-- Title -->
                <h1 class="modal-title">${event.title || 'Geen titel'}</h1>
                
                <!-- Event Details -->
                <div class="modal-details-box">
                    <!-- Date -->
                    <div class="modal-detail-item">
                        <div class="modal-detail-icon" style="background: #e3f2fd;">
                            <i class="fas fa-calendar" style="color: #1976d2;"></i>
                        </div>
                        <div class="modal-detail-content">
                            <div class="modal-detail-label">Datum</div>
                            <div class="modal-detail-value">${eventDate}</div>
                        </div>
                    </div>
                    
                    <!-- Time -->
                    <div class="modal-detail-item">
                        <div class="modal-detail-icon" style="background: #f3e5f5;">
                            <i class="fas fa-clock" style="color: #7b1fa2;"></i>
                        </div>
                        <div class="modal-detail-content">
                            <div class="modal-detail-label">Tijd</div>
                            <div class="modal-detail-value">${eventTime}${endTime ? ` - ${endTime}` : ''}</div>
                        </div>
                    </div>
                    
                    <!-- Location -->
                    <div class="modal-detail-item">
                        <div class="modal-detail-icon" style="background: #e8f5e8;">
                            <i class="fas fa-map-marker-alt" style="color: #388e3c;"></i>
                        </div>
                        <div class="modal-detail-content">
                            <div class="modal-detail-label">Locatie</div>
                            <div class="modal-detail-value">${event.location || 'Locatie onbekend'}</div>
                        </div>
                    </div>
                    
                    <!-- Organization -->
                    ${event.organization_name ? `
                        <div class="modal-detail-item">
                            <div class="modal-detail-icon" style="background: #fff3e0;">
                                <i class="fas fa-building" style="color: #f57c00;"></i>
                            </div>
                            <div class="modal-detail-content">
                                <div class="modal-detail-label">Organisatie</div>
                                <div class="modal-detail-value">${event.organization_name}</div>
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Description -->
                ${event.description ? `
                    <div class="modal-description">
                        <h3 class="modal-description-title">Over dit evenement</h3>
                        <div class="modal-description-text">${event.description}</div>
                    </div>
                ` : ''}
            </div>
            
            <!-- Footer -->
            <div class="modal-footer-content">
                <button class="btn btn-primary" style="width: 100%;">Sluiten</button>
            </div>
        `;
        
        // Assemble modal
        modalContent.innerHTML = heroHTML + contentHTML;
        modalContent.appendChild(closeBtn);
        modalOverlay.appendChild(modalContent);
        
        // Add close functionality to footer button
        const footerBtn = modalContent.querySelector('.btn-primary');
        footerBtn.addEventListener('click', function() {
            modalOverlay.remove();
        });
        
        // Add to DOM
        modalOverlay.style.display = 'flex';
        document.body.appendChild(modalOverlay);
    }

    async loadFoundLost() {
        document.getElementById('foundLostContent').innerHTML = '<p class="text-muted">Gevonden/Verloren sectie - Wordt geïmplementeerd</p>';
    }

    // ---- Afvalkalender (Content) ----
    async loadAfvalkalender() {
        const msgEl = document.getElementById('afvalkalenderMessage');
        if (msgEl) msgEl.textContent = '';
        const typeEl = document.getElementById('afvalOudPapierType');
        const weekdayOp = document.getElementById('afvalOudPapierWeekday');
        const intervalOp = document.getElementById('afvalOudPapierInterval');
        const firstDateOp = document.getElementById('afvalOudPapierFirstDate');
        const datesListOp = document.getElementById('afvalOudPapierDatesList');
        const weekdayCont = document.getElementById('afvalContainersWeekday');
        const extraCont = document.getElementById('afvalContainersExtra');
        if (!typeEl) return;
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/afvalkalender`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!response.ok) throw new Error('Kon afvalkalender niet laden');
            const res = await response.json();
            const c = res.config || {};
            const op = c.oudPapier || {};
            const cont = c.containers || {};
            typeEl.value = op.type || 'recurring';
            if (weekdayOp) weekdayOp.value = op.weekday ?? 2;
            if (intervalOp) intervalOp.value = op.interval_weeks ?? 6;
            if (firstDateOp) firstDateOp.value = op.first_date || '';
            if (datesListOp) datesListOp.value = (op.dates || []).join('\n');
            if (weekdayCont) weekdayCont.value = cont.weekday ?? 5;
            if (extraCont) extraCont.value = (cont.extra_dates || []).join('\n');
            const greenInEl = document.getElementById('afvalContainersGreenIn');
            if (greenInEl) {
                const evenLabel = cont.even_label === 'grijs' ? 'grijs' : 'groen';
                const oddLabel = cont.odd_label === 'groen' ? 'groen' : (evenLabel === 'groen' ? 'grijs' : 'groen');
                greenInEl.value = evenLabel === 'groen' ? 'even' : 'odd';
            }
            const isRecurring = (op.type || 'recurring') === 'recurring';
            const recurringEl = document.getElementById('afvalOudPapierRecurring');
            const datesEl = document.getElementById('afvalOudPapierDates');
            if (recurringEl) recurringEl.style.display = isRecurring ? 'block' : 'none';
            if (datesEl) datesEl.style.display = isRecurring ? 'none' : 'block';
        } catch (error) {
            if (msgEl) {
                msgEl.textContent = 'Kon afvalkalender niet laden: ' + (error.message || error);
                msgEl.className = 'form-message error';
            }
        }
    }

    // ---- Content-pagina's (privacy / voorwaarden) ----

    async loadContentPages() {
        const container = document.getElementById('contentPagesContainer');
        if (!container) return;
        container.innerHTML = '<p>Content pagina\'s laden...</p>';
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/content-pages`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                console.error('Failed to load content pages:', response.status, text);
                container.innerHTML = `<p>Fout bij laden van content pagina's (status ${response.status}).</p>`;
                return;
            }
            const data = await response.json();
            const pages = data.pages || [];
            if (!pages.length) {
                container.innerHTML = '<p>Geen content pagina\'s gevonden.</p>';
                return;
            }
            container.innerHTML = pages.map(page => `
                <div class="form-card" data-slug="${page.slug}">
                    <h4>${page.title || page.slug}</h4>
                    <p class="text-muted" style="margin-bottom: 0.75rem;">Slug: <code>${page.slug}</code></p>
                    <div class="form-group">
                        <label>Titel</label>
                        <input type="text" id="contentPageTitle-${page.slug}" value="${(page.title || '').replace(/"/g, '&quot;')}">
                    </div>
                    <div class="form-group">
                        <label>Tekst</label>
                        <textarea id="contentPageContent-${page.slug}" rows="6">${page.content || ''}</textarea>
                    </div>
                    <button type="button" class="btn btn-primary" onclick="admin.saveContentPage('${page.slug}')">
                        <i class="fas fa-save"></i> Opslaan
                    </button>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error loading content pages:', error);
            container.innerHTML = '<p>Fout bij laden van content pagina\'s.</p>';
        }
    }

    async saveContentPage(slug) {
        const titleEl = document.getElementById(`contentPageTitle-${slug}`);
        const contentEl = document.getElementById(`contentPageContent-${slug}`);
        if (!titleEl || !contentEl) {
            alert('Kan velden voor deze pagina niet vinden.');
            return;
        }
        const title = titleEl.value.trim();
        const content = contentEl.value;
        if (!title) {
            alert('Titel is verplicht.');
            return;
        }
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/content-pages/${slug}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ title, content })
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                alert('Opslaan mislukt: ' + (err.error || err.message || `status ${response.status}`));
                return;
            }
            alert('Pagina opgeslagen.');
        } catch (error) {
            console.error('Error saving content page:', error);
            alert('Fout bij opslaan van content pagina.');
        }
    }

    // ---- Praktisch (tegels/kaarten) ----

    async loadPractical() {
        const tbody = document.getElementById('practicalTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6">Laden...</td></tr>';
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/practical-info`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.error('Failed to load practical info:', response.status, errText);
                tbody.innerHTML = `<tr><td colspan="6">Fout bij laden (status ${response.status})</td></tr>`;
                return;
            }
            const data = await response.json();
            const items = data.items || [];
            if (!items.length) {
                tbody.innerHTML = '<tr><td colspan="6">Nog geen praktische items. Klik op \"Nieuw item\" om de eerste tegel toe te voegen.</td></tr>';
                return;
            }
            tbody.innerHTML = items.map(item => `
                <tr>
                    <td>${item.sort_order ?? 0}</td>
                    <td><i class="${item.icon || 'fas fa-info-circle'}"></i></td>
                    <td>${item.title || ''}</td>
                    <td>${item.type || 'info'}</td>
                    <td><span class="status-badge status-${item.is_active ? 'active' : 'inactive'}">${item.is_active ? 'Actief' : 'Inactief'}</span></td>
                    <td>
                        <button class="btn btn-sm btn-warning" onclick="admin.editPractical(${item.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="admin.deletePractical(${item.id})"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            console.error('Error loading practical info:', error);
            tbody.innerHTML = '<tr><td colspan="6">Fout bij laden praktische info</td></tr>';
        }
    }

    async createPracticalItem() {
        // Open mooie modal, zoals bij Nieuws/Evenementen
        this.openPracticalModal(null);
    }

    async editPractical(id) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/practical-info`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!response.ok) {
                alert('Kon praktische items niet laden voor bewerken.');
                return;
            }
            const data = await response.json();
            const items = data.items || [];
            const item = items.find(x => x.id === id);
            if (!item) {
                this.showNotification('Praktische tegel niet gevonden.', 'error');
                return;
            }
            this.openPracticalModal(item);
        } catch (error) {
            console.error('Error editing practical item:', error);
            this.showNotification('Fout bij bewerken praktische tegel.', 'error');
        }
    }

    openPracticalModal(item) {
        const isEdit = !!item;
        // Haal eventueel telefoon/website uit samengestelde URL (zoals de app dat ook doet)
        let phone = '';
        let website = '';
        if (item?.url) {
            const parts = String(item.url)
                .split(',')
                .map(p => p.trim())
                .filter(Boolean);
            phone = parts[0] || '';
            website = parts[1] || '';
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay practical-modal';
        overlay.style.display = 'flex';

        const title = isEdit ? 'Tegel bewerken' : 'Nieuwe tegel';

        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close" data-modal-close><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <form id="practicalForm">
                        <div class="form-group">
                            <label for="practicalTitle">Titel *</label>
                            <input type="text" id="practicalTitle" value="${(item?.title || '').replace(/"/g, '&quot;')}" required>
                        </div>
                        <div class="form-group">
                            <label for="practicalSubtitle">Subtitel</label>
                            <input type="text" id="practicalSubtitle" value="${(item?.subtitle || '').replace(/"/g, '&quot;')}">
                        </div>
                        <div class="form-group">
                            <label for="practicalIcon">Icoon (voor in de app)</label>
                            <input type="text" id="practicalIcon" value="${(item?.icon || 'information-circle-outline').replace(/"/g, '&quot;')}" placeholder="Ionicons-naam, of kies hieronder">
                            <p class="text-muted" style="margin: 0.5rem 0 0.25rem 0; font-size: 0.85rem;">Alle iconen – zoek of scroll en klik om te selecteren:</p>
                            <input type="search" id="practicalIconSearch" class="practical-icon-search" placeholder="Zoek bijv. 'phone', 'home', 'heart', 'mobile'…">
                            <div id="practicalIconCatalog" class="practical-icon-catalog"></div>
                            <p class="text-muted" style="margin: 0.75rem 0 0.25rem 0; font-size: 0.85rem;"><i class="fas fa-portrait" style="margin-right: 4px;"></i> Of upload een eigen foto als icoon (bijv. wijkagent, logo van partner):</p>
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 0.5rem; flex-wrap: wrap;">
                                <label class="btn btn-secondary" style="cursor: pointer; margin: 0; padding: 0.35rem 0.75rem; font-size: 0.85rem;">
                                    <i class="fas fa-upload" style="margin-right: 4px;"></i> Foto kiezen
                                    <input type="file" id="practicalIconUpload" accept="image/*" style="display: none;">
                                </label>
                                <span id="practicalIconUploadStatus" style="font-size: 0.8rem; color: #666;"></span>
                                <img id="practicalIconPreview" src="" alt="preview" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; display: none; border: 2px solid #ddd;">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="practicalType">Type</label>
                            <select id="practicalType">
                                <option value="info" ${!item || (item.type || 'info') === 'info' ? 'selected' : ''}>Informatief</option>
                                <option value="phone" ${(item?.type || '') === 'phone' ? 'selected' : ''}>Telefoon</option>
                                <option value="link" ${(item?.type || '') === 'link' ? 'selected' : ''}>Link</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="practicalPhone">Telefoonnummer</label>
                            <input type="tel" id="practicalPhone" value="${phone.replace(/"/g, '&quot;')}" placeholder="bijv. 0519 123 456">
                        </div>
                        <div class="form-group">
                            <label for="practicalUrl">Link-URL</label>
                            <input type="url" id="practicalUrl" value="${website.replace(/"/g, '&quot;')}" placeholder="https://...">
                            <small class="text-muted">Alleen gebruikt als type = Telefoon/Link. In de app wordt telefoon en website beide getoond (indien ingevuld).</small>
                        </div>
                        <div class="form-group">
                            <label for="practicalContent">Beschrijving / extra tekst</label>
                            <textarea id="practicalContent" rows="3" placeholder="Korte omschrijving van deze tegel...">${(item?.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                        </div>
                        <div class="form-group">
                            <label for="practicalSortOrder">Volgorde</label>
                            <input type="number" id="practicalSortOrder" value="${item?.sort_order ?? 0}">
                            <small class="text-muted">0 = bovenaan, hogere nummers komen lager in de lijst.</small>
                        </div>
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="practicalActive" ${item?.is_active ? 'checked' : ''}>
                                Actief in de app
                            </label>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-modal-close>Annuleren</button>
                    <button type="button" class="btn btn-primary" id="savePracticalBtn">Opslaan</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Sluiten
        overlay.querySelectorAll('.modal-close, [data-modal-close]').forEach(el => {
            el.addEventListener('click', () => overlay.remove());
        });
        overlay.querySelector('.modal-content').addEventListener('click', (e) => e.stopPropagation());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Opslaan
        const saveBtn = overlay.querySelector('#savePracticalBtn');
        saveBtn.addEventListener('click', () => {
            this.savePractical(item || null);
        });

        // ── Volledige Ionicons catalogus ──────────────────────────────────────
        const iconInput = overlay.querySelector('#practicalIcon');
        const currentIcon = (item?.icon || 'information-circle-outline').trim();

        // Alle Ionicons 5 outline-namen (opgeslagen als "naam-outline" in de app).
        // Logo-iconen hebben geen -outline variant en staan al als volledige naam.
        const ICONS_OUTLINE = [
            'accessibility','add','add-circle','airplane','alarm','albums','alert','alert-circle',
            'american-football','analytics','aperture','apps','archive',
            'arrow-back','arrow-back-circle','arrow-down','arrow-down-circle',
            'arrow-forward','arrow-forward-circle','arrow-redo','arrow-redo-circle',
            'arrow-undo','arrow-undo-circle','arrow-up','arrow-up-circle',
            'at','attach','backspace','bag','bag-add','bag-check','bag-handle','bag-remove',
            'balloon','ban','bandage','bar-chart','barbell','barcode','baseball',
            'basket','basketball','battery-charging','battery-dead','battery-full','battery-half',
            'beaker','bed','beer','bicycle','bluetooth','boat','body','bonfire',
            'book','bookmark','bookmarks','bowling-ball','briefcase','browsers','brush','bug',
            'build','bulb','bus','business','cafe','calculator',
            'calendar','calendar-clear','calendar-number',
            'call','camera','camera-reverse','car','car-sport','card',
            'caret-back','caret-back-circle','caret-down','caret-down-circle',
            'caret-forward','caret-forward-circle','caret-up','caret-up-circle',
            'cart','cash','cellular','chatbox','chatbox-ellipses',
            'chatbubble','chatbubble-ellipses','chatbubbles',
            'checkbox','checkmark','checkmark-circle','checkmark-done','checkmark-done-circle',
            'chevron-back','chevron-down','chevron-down-circle',
            'chevron-forward','chevron-up','chevron-up-circle',
            'clipboard','close','close-circle','cloud','cloud-circle',
            'cloud-done','cloud-download','cloud-offline','cloud-upload',
            'code','code-slash','code-working','cog','color-fill','color-filter',
            'color-palette','color-wand','compass','construct','contract','contrast',
            'copy','create','crop','cube','cut','desktop','disc','document',
            'document-attach','document-lock','document-text','documents','download',
            'duplicate','ear','earth','easel','egg','ellipse',
            'ellipsis-horizontal','ellipsis-horizontal-circle','ellipsis-vertical',
            'enter','exit','expand','extension-puzzle','eye','eye-off','eyedrop',
            'fast-food','female','file-tray','file-tray-full','file-tray-stacked',
            'film','filter','finger-print','fish','fitness','flag','flame',
            'flash','flash-off','flashlight','flask','flower','folder','folder-open',
            'football','footsteps','funnel','game-controller','gift',
            'git-branch','git-commit','git-compare','git-merge','git-network','git-pull-request',
            'glasses','globe','golf','grid','hammer','hand-left','hand-right',
            'happy','hardware-chip','headset','heart','heart-circle',
            'heart-dislike','heart-dislike-circle','heart-half',
            'help','help-buoy','help-circle','home','hourglass','ice-cream','id-card',
            'image','images','infinite','information','information-circle',
            'key','keypad','language','laptop','layers','leaf','library',
            'link','list','locate','location','lock-closed','lock-open',
            'log-in','log-out','magnet','mail','mail-open','mail-unread',
            'male','male-female','man','map','medal','medkit','medical','megaphone',
            'menu','mic','mic-circle','mic-off','mic-off-circle','mirror','moon','move',
            'musical-note','musical-notes','navigate','newspaper',
            'notifications','notifications-circle','notifications-off','notifications-off-circle',
            'nuclear','nutrition','open','options','paper-plane','partly-sunny','pause',
            'pause-circle','paw','pencil','people','person','person-add',
            'person-circle','person-remove','phone-landscape','phone-portrait',
            'pie-chart','pin','pint','pizza','planet','play','play-back',
            'play-back-circle','play-circle','play-forward','play-forward-circle',
            'play-skip-back','play-skip-back-circle','play-skip-forward','play-skip-forward-circle',
            'podium','power','print','prism','pulse','push','qr-code',
            'radio','radio-button-off','radio-button-on','rainy','reader','receipt',
            'recording','refresh','refresh-circle','reload','reload-circle',
            'remove','remove-circle','reorder-four','reorder-three','reorder-two',
            'repeat','resize','restaurant','return-down-back','return-down-forward',
            'return-up-back','return-up-forward','ribbon','rocket','rose','sad',
            'save','scan','scan-circle','school','search','search-circle',
            'send','server','settings','shapes','share','share-social',
            'shield','shield-checkmark','shirt','shuffle','skull','snow','speedometer',
            'square','star','star-half','stopwatch','storefront','subway','sunny',
            'swap-horizontal','swap-vertical','telescope','tennisball','terminal',
            'thermometer','thumbs-down','thumbs-up','thunderstorm','ticket',
            'time','timer','today','toggle','trail-sign','train','transgender',
            'trash','trash-bin','trending-down','trending-up','triangle','trophy','tv',
            'umbrella','unlink','videocam','videocam-off',
            'volume-high','volume-low','volume-medium','volume-mute','volume-off',
            'walk','wallet','warning','watch','water','wifi','woman',
        ];
        const ICONS_LOGO = [
            'logo-amazon','logo-android','logo-angular','logo-apple','logo-behance',
            'logo-bitcoin','logo-chrome','logo-discord','logo-docker','logo-dribbble',
            'logo-dropbox','logo-edge','logo-electron','logo-euro','logo-facebook',
            'logo-figma','logo-firebase','logo-firefox','logo-flickr','logo-github',
            'logo-gitlab','logo-google','logo-google-playstore','logo-html5',
            'logo-instagram','logo-ionic','logo-javascript','logo-laravel',
            'logo-linkedin','logo-markdown','logo-mastodon','logo-medium',
            'logo-microsoft','logo-nodejs','logo-npm','logo-paypal','logo-pinterest',
            'logo-python','logo-react','logo-reddit','logo-rss','logo-sass',
            'logo-skype','logo-slack','logo-snapchat','logo-stackoverflow',
            'logo-steam','logo-tumblr','logo-twitch','logo-twitter','logo-usd',
            'logo-vercel','logo-vimeo','logo-vue','logo-whatsapp',
            'logo-windows','logo-wordpress','logo-xbox','logo-yahoo','logo-youtube',
        ];

        // Bouw alle icon-namen: outline-iconen krijgen suffix -outline, logo's staan al als volledige naam
        const ALL_ICONS = [
            ...ICONS_OUTLINE.map(n => n + '-outline'),
            ...ICONS_LOGO,
        ];

        // Nederlandse zoeksynoniemen per icoon
        const NL = {
            'accessibility-outline':['toegankelijkheid','rolstoel'],
            'add-outline':['toevoegen','plus','nieuw'],
            'add-circle-outline':['toevoegen','nieuw'],
            'airplane-outline':['vliegtuig','vliegen','vliegveld'],
            'alarm-outline':['alarm','wekker','herinnering'],
            'alert-outline':['waarschuwing','let op'],
            'alert-circle-outline':['waarschuwing','fout','probleem'],
            'albums-outline':['albums','foto collectie'],
            'american-football-outline':['american football','sport'],
            'analytics-outline':['analyse','statistieken','cijfers'],
            'aperture-outline':['lens','diafragma','camera'],
            'apps-outline':['apps','toepassingen','tegels','mobiel'],
            'archive-outline':['archief','opslaan'],
            'at-outline':['emailadres','@'],
            'attach-outline':['bijlage','vastmaken'],
            'backspace-outline':['verwijderen','wissen'],
            'bag-outline':['tas','winkelen'],
            'bag-add-outline':['tas toevoegen','winkelen'],
            'balloon-outline':['ballon','feest','verjaardag'],
            'ban-outline':['verbod','niet toegestaan','stop'],
            'bandage-outline':['verband','wond','ehbo','plakster'],
            'bar-chart-outline':['staafdiagram','statistiek','grafiek'],
            'barbell-outline':['halter','gewichtheffen','fitness','sport'],
            'barcode-outline':['barcode','streepjescode','scannen'],
            'baseball-outline':['honkbal','sport'],
            'basketball-outline':['basketbal','sport'],
            'battery-charging-outline':['batterij opladen','stroom'],
            'battery-dead-outline':['batterij leeg','lege batterij'],
            'battery-full-outline':['batterij vol','stroom'],
            'battery-half-outline':['batterij half'],
            'beaker-outline':['beker','wetenschap','laboratorium'],
            'bed-outline':['bed','slaap','slapen','ziekenhuis'],
            'beer-outline':['bier','kroeg','café','drank'],
            'bicycle-outline':['fiets','fietsen','sport','vervoer'],
            'bluetooth-outline':['bluetooth','verbinding','draadloos'],
            'boat-outline':['boot','schip','vaartuig','water','varen'],
            'body-outline':['lichaam','persoon','mens'],
            'bonfire-outline':['kampvuur','vuur','brand'],
            'book-outline':['boek','lezen','literatuur'],
            'bookmark-outline':['bladwijzer','opslaan','bewaren'],
            'bookmarks-outline':['bladwijzers','bewaard'],
            'bowling-ball-outline':['bowlen','sport'],
            'briefcase-outline':['koffer','werk','zakelijk','job'],
            'brush-outline':['penseel','schilderen','kunst','verf'],
            'bug-outline':['bug','fout','probleem','insect'],
            'build-outline':['bouwen','gereedschap','repareren'],
            'bulb-outline':['lamp','idee','licht','gloeilamp'],
            'bus-outline':['bus','openbaar vervoer','ov'],
            'business-outline':['bedrijf','gebouw','kantoor','organisatie'],
            'cafe-outline':['cafe','café','koffie','koffiehuis'],
            'calculator-outline':['rekenmachine','berekenen'],
            'calendar-outline':['agenda','kalender','datum','afspraak'],
            'calendar-clear-outline':['lege agenda','kalender'],
            'calendar-number-outline':['datum','kalender'],
            'call-outline':['telefoon','bellen','mobiel','telefoneren'],
            'camera-outline':['camera','foto','afbeelding'],
            'camera-reverse-outline':['selfie','camera wisselen'],
            'car-outline':['auto','voertuig','rijden','parkeren'],
            'car-sport-outline':['sportwagen','auto'],
            'card-outline':['betaalkaart','pas','bankpas'],
            'cart-outline':['winkelwagen','winkelen','kopen'],
            'cash-outline':['geld','contant','betalen','kosten'],
            'cellular-outline':['mobiel netwerk','4g','5g','bereik'],
            'chatbox-outline':['berichtenvak','chat','bericht'],
            'chatbox-ellipses-outline':['typen','chat'],
            'chatbubble-outline':['berichtenbel','gesprek','bericht'],
            'chatbubble-ellipses-outline':['typen','gesprek'],
            'chatbubbles-outline':['gesprekken','berichten'],
            'checkbox-outline':['selectievakje','aanvinken'],
            'checkmark-outline':['vinkje','akkoord','klaar'],
            'checkmark-circle-outline':['goedgekeurd','voltooid','klaar'],
            'checkmark-done-outline':['alles gedaan','voltooid'],
            'clipboard-outline':['klembord','notitie','plakken'],
            'close-outline':['sluiten','annuleren','x','verwijderen'],
            'close-circle-outline':['sluiten','annuleren'],
            'cloud-outline':['wolk','bewolkt','cloud'],
            'cloud-download-outline':['downloaden','cloud'],
            'cloud-upload-outline':['uploaden','cloud'],
            'code-outline':['code','programmeren','it'],
            'code-slash-outline':['code','html','programmeren'],
            'cog-outline':['tandwiel','instellingen','techniek'],
            'color-palette-outline':['kleur','palet','schilderen'],
            'compass-outline':['kompas','richting','navigeren'],
            'construct-outline':['constructie','bouwen','gereedschap'],
            'contrast-outline':['contrast','helderheid'],
            'copy-outline':['kopiëren','dupliceren','kopie'],
            'create-outline':['bewerken','aanpassen','potlood'],
            'crop-outline':['bijsnijden','knippen','uitknippen'],
            'cut-outline':['knippen','schaar'],
            'desktop-outline':['computer','bureau','scherm','pc'],
            'disc-outline':['schijf','cd','dvd','muziek'],
            'document-outline':['document','bestand'],
            'document-attach-outline':['document bijlage','bestand'],
            'document-lock-outline':['beveiligd document'],
            'document-text-outline':['document','tekst','bestand'],
            'documents-outline':['documenten','bestanden'],
            'download-outline':['downloaden','ophalen'],
            'duplicate-outline':['dupliceren','kopiëren'],
            'ear-outline':['oor','horen','luisteren'],
            'earth-outline':['aarde','wereld','globe'],
            'easel-outline':['schildersezel','kunst','presentatie'],
            'egg-outline':['ei','eten'],
            'enter-outline':['invoer','enter'],
            'exit-outline':['uitgang','verlaten'],
            'expand-outline':['uitvouwen','groter','volledig scherm'],
            'extension-puzzle-outline':['puzzel','uitbreiding','plugin'],
            'eye-outline':['oog','zien','bekijken'],
            'eye-off-outline':['verbergen','onzichtbaar','privé'],
            'eyedrop-outline':['pipet','kleur oppakken'],
            'fast-food-outline':['fastfood','snackbar','eten'],
            'female-outline':['vrouw','vrouwelijk'],
            'file-tray-outline':['postbak','inbox'],
            'filter-outline':['filter','sorteren'],
            'finger-print-outline':['vingerafdruk','inloggen','biometrie'],
            'fish-outline':['vis','vissen'],
            'fitness-outline':['fitness','sport','gezondheid'],
            'flag-outline':['vlag','markeren'],
            'flame-outline':['vuur','brandweer','brand','heet'],
            'flash-outline':['flits','bliksem','snel','energie'],
            'flask-outline':['kolf','wetenschap','laboratorium'],
            'flower-outline':['bloem','tuin','plant','natuur'],
            'folder-outline':['map','opslaan','bestanden'],
            'folder-open-outline':['map open','bestanden'],
            'football-outline':['voetbal','sport','bal'],
            'footsteps-outline':['voetafdrukken','stappen','wandelen','lopen'],
            'funnel-outline':['trechter','filter','sorteren'],
            'game-controller-outline':['spelcontroller','gaming','spel'],
            'gift-outline':['cadeau','gift','aanwezig','verjaardag'],
            'globe-outline':['wereld','website','internet','globe'],
            'golf-outline':['golf','sport'],
            'grid-outline':['raster','overzicht','tegels'],
            'hammer-outline':['hamer','klussen','gereedschap','bouwen'],
            'hand-left-outline':['hand links','stoppen','aanwijzen'],
            'hand-right-outline':['hand rechts','stoppen','wijzen'],
            'happy-outline':['blij','smiley','positief','lachen'],
            'hardware-chip-outline':['chip','processor','techniek','it'],
            'headset-outline':['koptelefoon','muziek','klantenservice'],
            'heart-outline':['hart','liefde','favoriet','zorg'],
            'heart-circle-outline':['hart','zorg','gezondheid'],
            'heart-dislike-outline':['niet leuk','dislike'],
            'heart-half-outline':['half hart','beoordeling'],
            'help-outline':['hulp','vraag','informatie'],
            'help-buoy-outline':['reddingsboei','hulp','water'],
            'help-circle-outline':['hulp','vraag','faq'],
            'home-outline':['huis','woning','thuis','wonen'],
            'hourglass-outline':['zandloper','wachten','tijd'],
            'ice-cream-outline':['ijsje','ijs','zomer'],
            'id-card-outline':['identiteitskaart','legitimatie','id','pas'],
            'image-outline':['afbeelding','foto','plaatje'],
            'images-outline':['afbeeldingen','foto\'s','galerij'],
            'information-outline':['informatie','info'],
            'information-circle-outline':['informatie','info','hulp'],
            'key-outline':['sleutel','toegang','wachtwoord','code'],
            'keypad-outline':['toetsenblok','pincode'],
            'language-outline':['taal','vertalen'],
            'laptop-outline':['laptop','computer','notebook'],
            'layers-outline':['lagen','ordenen','stapelen'],
            'leaf-outline':['blad','natuur','groen','milieu','duurzaam'],
            'library-outline':['bibliotheek','boeken'],
            'link-outline':['link','verbinding','url'],
            'list-outline':['lijst','overzicht'],
            'locate-outline':['lokaliseren','gps','positie'],
            'location-outline':['locatie','adres','plek','gps'],
            'lock-closed-outline':['slot','vergrendeld','beveiligd'],
            'lock-open-outline':['ontgrendeld','open','slot open'],
            'log-in-outline':['inloggen','aanmelden'],
            'log-out-outline':['uitloggen','afmelden'],
            'magnet-outline':['magneet'],
            'mail-outline':['email','e-mail','post','bericht','brief'],
            'mail-open-outline':['email geopend','gelezen','bericht'],
            'mail-unread-outline':['ongelezen mail','nieuw bericht'],
            'male-outline':['man','mannelijk'],
            'male-female-outline':['geslacht','gender'],
            'man-outline':['man','persoon'],
            'map-outline':['kaart','plattegrond','locatie','routekaart'],
            'medal-outline':['medaille','prijs','sport','kampioen'],
            'medkit-outline':['ehbo','eerste hulp','dokter','zorg','gezondheid'],
            'medical-outline':['medisch','ziekenhuis','arts','dokter'],
            'megaphone-outline':['megafoon','aankondiging','omroepen'],
            'menu-outline':['menu','navigatie','hamburgermenu'],
            'mic-outline':['microfoon','opnemen','geluid','spreken'],
            'mic-off-outline':['microfoon uit','stil'],
            'mirror-outline':['spiegel','omdraaien'],
            'moon-outline':['maan','nacht','donker'],
            'move-outline':['verplaatsen','slepen'],
            'musical-note-outline':['muziek','noot','liedje'],
            'musical-notes-outline':['muziek','noten','liedje','melodie'],
            'navigate-outline':['navigeren','richting','kompas'],
            'newspaper-outline':['krant','nieuws','artikel'],
            'notifications-outline':['meldingen','berichten','alerts','bel'],
            'notifications-off-outline':['meldingen uit','stilzetten'],
            'nuclear-outline':['nucleair','gevaar','radioactief'],
            'nutrition-outline':['voeding','gezond eten','maaltijd'],
            'open-outline':['openen','link','extern','website'],
            'options-outline':['opties','instellingen','meer'],
            'paper-plane-outline':['papieren vliegtuig','versturen','bericht'],
            'partly-sunny-outline':['gedeeltelijk bewolkt','bewolkt','weer'],
            'pause-outline':['pauzeren','stoppen'],
            'paw-outline':['poot','dier','huisdier','hond','kat'],
            'pencil-outline':['potlood','bewerken','schrijven'],
            'people-outline':['mensen','groep','vereniging','club','buurtbewoners'],
            'person-outline':['persoon','mens','gebruiker'],
            'person-add-outline':['persoon toevoegen','vriend'],
            'person-circle-outline':['contactpersoon','profiel','gebruiker'],
            'person-remove-outline':['persoon verwijderen'],
            'phone-landscape-outline':['telefoon liggend','mobiel'],
            'phone-portrait-outline':['telefoon','mobiel','smartphone','app'],
            'pie-chart-outline':['taartdiagram','statistiek','grafiek'],
            'pin-outline':['pin','locatie','vastmaken','pushpin'],
            'pint-outline':['pint','bier','glas','café'],
            'pizza-outline':['pizza','eten'],
            'planet-outline':['planeet','ruimte'],
            'podium-outline':['podium','spreken','presentatie','speech'],
            'power-outline':['aan uit','stroom','knop'],
            'pricetag-outline':['prijskaartje','prijs','aanbieding'],
            'pricetags-outline':['prijskaartjes','aanbiedingen'],
            'print-outline':['afdrukken','printer'],
            'prism-outline':['prisma','licht'],
            'pulse-outline':['hartslag','gezondheid','vitaal'],
            'push-outline':['pushmelding','notificatie'],
            'qr-code-outline':['qr-code','scannen','barcode'],
            'radio-outline':['radio','muziek','uitzending'],
            'rainy-outline':['regen','regenachtig','weer'],
            'reader-outline':['lezen','e-reader','artikel'],
            'receipt-outline':['bon','rekening','betaling','kassabon'],
            'recording-outline':['opnemen','video','record'],
            'refresh-outline':['vernieuwen','opnieuw laden'],
            'reload-outline':['herladen','vernieuwen'],
            'remove-circle-outline':['verwijderen','min'],
            'repeat-outline':['herhalen','opnieuw','loop'],
            'restaurant-outline':['restaurant','eten','horeca','diner'],
            'ribbon-outline':['lint','prijs','award','onderscheiding'],
            'rocket-outline':['raket','snel','lanceren'],
            'rose-outline':['roos','bloem','romantisch'],
            'sad-outline':['verdrietig','negatief','boos'],
            'save-outline':['opslaan','bewaren'],
            'scan-outline':['scannen','camera','qr'],
            'school-outline':['school','onderwijs','leren','klas'],
            'search-outline':['zoeken','zoekbalk','vergrootglas'],
            'send-outline':['versturen','verzenden','sturen'],
            'server-outline':['server','computers','hosting'],
            'settings-outline':['instellingen','configuratie','beheer'],
            'shapes-outline':['vormen','figuren'],
            'share-outline':['delen','doorsturen'],
            'share-social-outline':['sociaal media','delen'],
            'shield-outline':['schild','veiligheid','politie','bescherming','wijkagent'],
            'shield-checkmark-outline':['veilig','beschermd','beveiligd'],
            'shirt-outline':['shirt','kleding'],
            'shuffle-outline':['willekeurig','mixen'],
            'skull-outline':['schedel','gevaar','dood'],
            'snow-outline':['sneeuw','winter','sneeuwvlok'],
            'speedometer-outline':['snelheidsmeter','snelheid','tempo'],
            'star-outline':['ster','favoriet','beoordeling','uitgelicht'],
            'star-half-outline':['halve ster','beoordeling'],
            'stopwatch-outline':['stopwatch','timing','tijd meten'],
            'storefront-outline':['winkel','winkelpand','winkelfront'],
            'subway-outline':['metro','ondergronds','openbaar vervoer'],
            'sunny-outline':['zon','zonnig','lekker weer'],
            'swap-horizontal-outline':['wisselen','omwisselen'],
            'swap-vertical-outline':['wisselen','verticaal'],
            'telescope-outline':['telescoop','kijken','astronomie'],
            'tennisball-outline':['tennis','sport','bal'],
            'terminal-outline':['terminal','command line','it','programmeren'],
            'thermometer-outline':['thermometer','temperatuur','koorts'],
            'thumbs-down-outline':['duim omlaag','slecht','negatief'],
            'thumbs-up-outline':['duim omhoog','goed','positief'],
            'thunderstorm-outline':['onweer','bliksem','storm'],
            'ticket-outline':['kaartje','ticket','entree','evenement'],
            'time-outline':['tijd','klok','openingstijden','uur'],
            'timer-outline':['timer','aftellen'],
            'today-outline':['vandaag','datum'],
            'toggle-outline':['schakelaar','aan uit'],
            'trail-sign-outline':['wandelpad','wandelen','natuur','bordje'],
            'train-outline':['trein','spoor','station'],
            'transgender-outline':['transgender','gender'],
            'trash-outline':['prullenbak','afval','verwijderen','weggooien'],
            'trash-bin-outline':['prullenbak','afval','container','weggooien'],
            'trending-down-outline':['daling','neergang','omlaag'],
            'trending-up-outline':['stijging','groei','omhoog'],
            'trophy-outline':['trofee','prijs','winnaar','kampioen'],
            'tv-outline':['televisie','tv','scherm','kijken'],
            'umbrella-outline':['paraplu','regen'],
            'unlink-outline':['link verbreken','losgekoppeld'],
            'videocam-outline':['video','webcam','opnemen','film'],
            'videocam-off-outline':['camera uit','video uit'],
            'volume-high-outline':['geluid','volume','luid'],
            'volume-low-outline':['zacht','geluid laag'],
            'volume-medium-outline':['geluid middel'],
            'volume-mute-outline':['stil','geluid uit','mute'],
            'volume-off-outline':['geluid uit','stil'],
            'walk-outline':['wandelen','lopen','voetganger','stap'],
            'wallet-outline':['portemonnee','geld','betalen'],
            'warning-outline':['waarschuwing','gevaar','let op'],
            'watch-outline':['horloge','tijd'],
            'water-outline':['water','zee','rivier','vloeistof'],
            'wifi-outline':['wifi','draadloos','internet','verbinding'],
            'woman-outline':['vrouw','persoon'],
            'logo-facebook':['facebook','sociaal','social media'],
            'logo-instagram':['instagram','foto','social media'],
            'logo-twitter':['twitter','social media','x'],
            'logo-whatsapp':['whatsapp','bericht','chat','appje'],
            'logo-youtube':['youtube','video','kijken'],
            'logo-linkedin':['linkedin','zakelijk','werk','netwerken'],
            'logo-github':['github','code','programmeren'],
            'logo-google':['google','zoeken'],
            'logo-apple':['apple','iphone','ipad','mac'],
            'logo-android':['android','telefoon','google'],
            'logo-windows':['windows','microsoft','pc'],
            'logo-microsoft':['microsoft','windows'],
            'logo-wordpress':['wordpress','website','blog'],
            'logo-slack':['slack','werk','chat','berichten'],
            'logo-discord':['discord','gaming','chat','community'],
            'logo-paypal':['paypal','betalen','geld','transactie'],
            'logo-dropbox':['dropbox','opslaan','cloud','bestanden'],
            'logo-chrome':['chrome','browser','google'],
            'logo-firefox':['firefox','browser'],
            'logo-rss':['rss','feed','nieuws','abonneren'],
            'logo-snapchat':['snapchat','foto','social','verhalen'],
            'logo-pinterest':['pinterest','foto','inspiratie'],
            'logo-reddit':['reddit','forum','community'],
            'logo-twitch':['twitch','gaming','streaming','live'],
        };

        const catalog = overlay.querySelector('#practicalIconCatalog');
        const searchInput = overlay.querySelector('#practicalIconSearch');

        const renderCatalog = (filter) => {
            const q = (filter || '').toLowerCase().trim();
            const filtered = q ? ALL_ICONS.filter(n => {
                if (n.includes(q)) return true;
                const nl = NL[n];
                return nl && nl.some(kw => kw.includes(q));
            }) : ALL_ICONS;
            catalog.innerHTML = '';
            filtered.forEach(iconName => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'practical-icon-option' + (iconName === currentIcon ? ' active' : '');
                btn.dataset.icon = iconName;
                btn.title = iconName;
                btn.innerHTML = '<ion-icon name="' + iconName + '"></ion-icon><span>' + iconName.replace(/-outline$/, '').replace(/^logo-/, '') + '</span>';
                btn.addEventListener('click', () => {
                    if (iconInput) iconInput.value = iconName;
                    catalog.querySelectorAll('.practical-icon-option').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const previewEl = overlay.querySelector('#practicalIconPreview');
                    const statusEl = overlay.querySelector('#practicalIconUploadStatus');
                    if (previewEl) previewEl.style.display = 'none';
                    if (statusEl) statusEl.textContent = '';
                });
                catalog.appendChild(btn);
            });
            if (!filtered.length) {
                catalog.innerHTML = '<p style="padding: 1rem; color: #999; font-size: 0.85rem;">Geen iconen gevonden voor "' + q + '".</p>';
            }
        };

        renderCatalog('');

        if (searchInput) {
            searchInput.addEventListener('input', () => renderCatalog(searchInput.value));
        }

        // Scroll het actieve icoon in beeld
        requestAnimationFrame(() => {
            const active = catalog.querySelector('.practical-icon-option.active');
            if (active) active.scrollIntoView({ block: 'nearest' });
        });

        // ── Foto-upload als icoon ─────────────────────────────────────────────
        const iconUploadInput = overlay.querySelector('#practicalIconUpload');
        const iconUploadStatus = overlay.querySelector('#practicalIconUploadStatus');
        const iconPreview = overlay.querySelector('#practicalIconPreview');

        if (currentIcon.startsWith('http') && iconPreview) {
            iconPreview.src = currentIcon;
            iconPreview.style.display = 'block';
            if (iconUploadStatus) iconUploadStatus.textContent = 'Eigen foto actief';
        }

        if (iconUploadInput) {
            iconUploadInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (iconUploadStatus) iconUploadStatus.textContent = 'Bezig met uploaden…';
                try {
                    const compressed = await this.compressNewsImage(file);
                    const uploadRes = await fetch(`${this.apiBaseUrl}/upload/image`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({
                            imageData: compressed,
                            filename: `practical-icon-${Date.now()}.jpg`
                        })
                    });
                    if (!uploadRes.ok) throw new Error(`HTTP ${uploadRes.status}`);
                    const uploadJson = await uploadRes.json();
                    const imgUrl = uploadJson.imageUrl;
                    if (imgUrl && iconInput) {
                        iconInput.value = imgUrl;
                        if (iconPreview) { iconPreview.src = imgUrl; iconPreview.style.display = 'block'; }
                        if (iconUploadStatus) iconUploadStatus.textContent = 'Foto geüpload ✓';
                        catalog.querySelectorAll('.practical-icon-option').forEach(b => b.classList.remove('active'));
                    }
                } catch (err) {
                    if (iconUploadStatus) iconUploadStatus.textContent = 'Upload mislukt: ' + err.message;
                }
            });
        }
    }

    async savePractical(existingItem = null) {
        try {
            const titleEl = document.getElementById('practicalTitle');
            const subtitleEl = document.getElementById('practicalSubtitle');
            const iconEl = document.getElementById('practicalIcon');
            const typeEl = document.getElementById('practicalType');
            const phoneEl = document.getElementById('practicalPhone');
            const urlEl = document.getElementById('practicalUrl');
            const contentEl = document.getElementById('practicalContent');
            const sortEl = document.getElementById('practicalSortOrder');
            const activeEl = document.getElementById('practicalActive');

            if (!titleEl) {
                this.showNotification('Formulier voor Praktisch niet gevonden.', 'error');
                return;
            }

            const title = titleEl.value.trim();
            if (!title) {
                this.showNotification('Titel is verplicht voor een tegel.', 'error');
                return;
            }

            const subtitle = subtitleEl?.value?.trim() || '';
            const icon = iconEl?.value?.trim() || 'information-circle-outline';
            const type = typeEl?.value || 'info';
            const phone = phoneEl?.value?.trim() || '';
            const website = urlEl?.value?.trim() || '';
            // Altijd telefoon en website opslaan als ingevuld (app toont ze altijd; bij type phone/link is de tegel ook klikbaar)
            const parts = [];
            if (phone) parts.push(phone);
            if (website) parts.push(website);
            const url = parts.length ? parts.join(', ') : '';
            const sort_order = parseInt(sortEl?.value || '0', 10) || 0;
            const is_active = !!activeEl?.checked;
            const content = contentEl?.value || existingItem?.content || null;

            const body = {
                title,
                subtitle: subtitle || null,
                icon,
                content: content || null,
                type,
                url: url || null,
                sort_order,
                is_active
            };

            const isEdit = !!existingItem?.id;
            const urlEndpoint = isEdit
                ? `${this.apiBaseUrl}/admin/practical-info/${existingItem.id}`
                : `${this.apiBaseUrl}/admin/practical-info`;
            const method = isEdit ? 'PUT' : 'POST';

            const response = await fetch(urlEndpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                this.showNotification('Opslaan mislukt: ' + (err.error || err.message || `status ${response.status}`), 'error');
                return;
            }

            this.showNotification('Praktische tegel opgeslagen', 'success');
            document.querySelector('.modal-overlay.practical-modal')?.remove();
            await this.loadPractical();
        } catch (error) {
            console.error('Error saving practical item:', error);
            this.showNotification('Fout bij opslaan praktische tegel.', 'error');
        }
    }

    async deletePractical(id) {
        if (!confirm('Weet je zeker dat je deze tegel wilt verwijderen?')) {
            return;
        }
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/practical-info/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                alert('Verwijderen mislukt: ' + (err.error || err.message || `status ${response.status}`));
                return;
            }
            await this.loadPractical();
        } catch (error) {
            console.error('Error deleting practical item:', error);
            alert('Fout bij verwijderen praktische tegel.');
        }
    }

    async saveAfvalkalender() {
        const msgEl = document.getElementById('afvalkalenderMessage');
        if (msgEl) msgEl.textContent = '';
        const type = document.getElementById('afvalOudPapierType').value;
        const oudPapier = type === 'dates'
            ? {
                type: 'dates',
                dates: document.getElementById('afvalOudPapierDatesList').value.split('\n').map(s => s.trim()).filter(Boolean)
            }
            : {
                type: 'recurring',
                weekday: parseInt(document.getElementById('afvalOudPapierWeekday').value, 10) || 2,
                interval_weeks: parseInt(document.getElementById('afvalOudPapierInterval').value, 10) || 6,
                first_date: document.getElementById('afvalOudPapierFirstDate').value.trim() || new Date().toISOString().slice(0, 10)
            };
        const extraText = document.getElementById('afvalContainersExtra').value.split('\n').map(s => s.trim()).filter(Boolean);
        const greenInEl = document.getElementById('afvalContainersGreenIn');
        const greenIn = greenInEl && greenInEl.value === 'odd' ? 'odd' : 'even';
        const even_label = greenIn === 'odd' ? 'grijs' : 'groen';
        const odd_label = even_label === 'groen' ? 'grijs' : 'groen';
        const containers = {
            weekday: parseInt(document.getElementById('afvalContainersWeekday').value, 10) || 5,
            extra_dates: extraText,
            even_label,
            odd_label
        };
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/afvalkalender`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ oudPapier, containers })
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || err.message || 'Opslaan mislukt');
            }
            if (msgEl) {
                msgEl.textContent = 'Afvalkalender opgeslagen. De app toont de nieuwe datums na vernieuwen.';
                msgEl.className = 'form-message success';
            }
            this.showNotification('Afvalkalender opgeslagen. De app toont de nieuwe datums na vernieuwen.', 'success');
        } catch (error) {
            if (msgEl) {
                msgEl.textContent = 'Opslaan mislukt: ' + (error.message || error);
                msgEl.className = 'form-message error';
            }
            // Extra feedback als het message-element om wat voor reden dan ook niet zichtbaar is
            alert('Opslaan afvalkalender mislukt: ' + (error.message || error));
        }
    }

    async loadModeration() {
        try {
            const container = document.getElementById('moderationContent');
            if (!container) return;

            container.innerHTML = '<div class="loading-spinner">Laden...</div>';

            const response = await fetch(`${this.apiBaseUrl}/admin/pending`, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                container.innerHTML = '<p class="text-muted">Kon moderatiewachtrij niet laden.</p>';
                return;
            }

            const data = await response.json();
            const items = [];
            (data.organizations || []).forEach((o) => {
                items.push({
                    type: 'organization',
                    id: o.id,
                    title: o.name,
                    description: o.description || '',
                    author_name: o.contact_email || 'Organisatie-aanmelding',
                    created_at: o.created_at,
                });
            });
            (data.news || []).forEach((n) => {
                const author = [n.first_name, n.last_name].filter(Boolean).join(' ').trim();
                items.push({
                    type: 'news',
                    id: n.id,
                    title: n.name || n.title || 'Zonder titel',
                    description: n.description || '',
                    author_name: author || 'Onbekende auteur',
                    created_at: n.created_at,
                });
            });
            (data.events || []).forEach((ev) => {
                const author = [ev.first_name, ev.last_name].filter(Boolean).join(' ').trim();
                items.push({
                    type: 'event',
                    id: ev.id,
                    title: ev.name || ev.title || 'Zonder titel',
                    description: ev.description || '',
                    author_name: author || 'Onbekende organisator',
                    created_at: ev.created_at,
                });
            });

            this.displayModerationContent(items);
        } catch (error) {
            console.error('Error loading moderation content:', error);
            const el = document.getElementById('moderationContent');
            if (el) el.innerHTML = '<p class="text-muted">Fout bij laden moderatie content</p>';
        }
    }

    displayModerationContent(items) {
        const container = document.getElementById('moderationContent');
        if (!container) return;

        if (!items || items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle" style="font-size: 48px; color: #28a745; margin-bottom: 16px;"></i>
                    <h3>Alles is gemodereerd!</h3>
                    <p>Er is momenteel geen content die wacht op goedkeuring.</p>
                </div>
            `;
            return;
        }

        const typeLabel = (t) =>
            ({
                organization: 'Organisatie',
                news: 'Nieuws',
                event: 'Evenement',
            }[t] || t || 'Onbekend');

        const itemsHtml = items
            .map((item) => {
                const t = item.type || '';
                const title = this.escHtml(item.title || 'Geen titel');
                const desc = item.description ? this.escHtml(item.description) : '';
                const author = this.escHtml(item.author_name || 'Onbekende gebruiker');
                const typeNl = this.escHtml(typeLabel(t));
                return `
            <div class="moderation-item" style="background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #ffc107;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div>
                        <h4 style="margin: 0; color: #212529; font-size: 18px;">${title}</h4>
                        <p style="margin: 4px 0 0 0; color: #6c757d; font-size: 14px;">
                            <i class="fas fa-tag" style="margin-right: 6px;"></i>
                            ${typeNl}
                        </p>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                        ${
                            t === 'organization'
                                ? `<button type="button" class="btn btn-secondary btn-sm" onclick="admin.previewOrganizationFromModeration(${item.id})" title="Volledig organisatieprofiel bekijken">
                            <i class="fas fa-eye"></i> Preview
                        </button>`
                                : ''
                        }
                        <button type="button" class="btn-icon btn-approve" onclick="admin.approveContent('${t}', ${item.id})" title="Goedkeuren">
                            <i class="fas fa-check"></i>
                        </button>
                        <button type="button" class="btn-icon btn-reject" onclick="admin.rejectContent('${t}', ${item.id})" title="Afwijzen / verwijderen">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                ${
                    desc
                        ? `<div style="margin-bottom: 12px;"><p style="color: #495057; line-height: 1.5; margin: 0;">${desc}</p></div>`
                        : ''
                }
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #6c757d;">
                    <span><i class="fas fa-user" style="margin-right: 4px;"></i>${author}</span>
                    <span><i class="fas fa-clock" style="margin-right: 4px;"></i>${
                        item.created_at ? new Date(item.created_at).toLocaleDateString('nl-NL') : 'Onbekende datum'
                    }</span>
                </div>
            </div>`;
            })
            .join('');

        container.innerHTML = `
            <div class="moderation-header" style="margin-bottom: 20px;">
                <h3 style="margin: 0; color: #212529;">Content wacht op moderatie (${items.length})</h3>
                <p style="margin: 4px 0 0 0; color: #6c757d;">Beoordeel en goedkeur of wijs af</p>
            </div>
            ${itemsHtml}
        `;
    }

    /** Volledig organisatieprofiel tonen (moderatie, zonder naar tab Organisaties te gaan). */
    async previewOrganizationFromModeration(id) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}`, {
                headers: { Authorization: `Bearer ${this.token}` },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                this.showNotification(data.error || data.message || 'Organisatie laden mislukt', 'error');
                return;
            }
            const org = data.organization;
            if (!org) {
                this.showNotification('Geen organisatiegegevens ontvangen', 'error');
                return;
            }
            const h = (s) => this.escHtml(s == null ? '' : String(s));
            const escAttr = (s) =>
                String(s ?? '')
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;');
            const block = (label, innerHtml) =>
                `<div class="moderation-org-preview-row"><strong>${h(label)}</strong><div>${innerHtml}</div></div>`;
            const textOrDash = (s) => {
                const t = (s == null ? '' : String(s)).trim();
                return t ? `<div style="white-space:pre-wrap;">${h(t)}</div>` : '<span class="text-muted">—</span>';
            };
            const linkOrDash = (url) => {
                const u = (url || '').trim();
                if (!u) return '<span class="text-muted">—</span>';
                return `<a href="${escAttr(u)}" target="_blank" rel="noopener noreferrer">${h(u)}</a>`;
            };
            const bcRaw = String(org.brand_color || '').trim();
            const bcCss = /^#[0-9A-Fa-f]{6}$/i.test(bcRaw) ? bcRaw : null;
            const brand = bcCss
                ? `<span style="display:inline-flex;align-items:center;gap:10px;"><span style="width:32px;height:32px;border-radius:8px;background:${bcCss};border:1px solid #ccc;"></span><code>${h(bcRaw)}</code></span>`
                : '<span class="text-muted">—</span>';
            const logoSection = org.logo_url
                ? `<div class="form-group" style="margin-top:1rem;"><label>Logo</label><img src="${escAttr(org.logo_url)}" alt="" style="max-height:120px;border-radius:8px;border:1px solid #eee;display:block;" loading="lazy" onerror="this.replaceWith(document.createTextNode('(logo niet te tonen)'))"></div>`
                : '';
            const statusNl = org.is_approved ? 'Goedgekeurd' : 'In afwachting';
            const created = org.created_at
                ? new Date(org.created_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
                : '—';

            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content modal-large moderation-org-preview-modal">
                    <div class="modal-header">
                        <h3><i class="fas fa-eye" style="margin-right:8px;"></i> Organisatie preview</h3>
                        <button type="button" class="modal-close" data-org-preview-close aria-label="Sluiten"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body" style="max-height:72vh;overflow-y:auto;">
                        <p class="text-muted" style="margin-bottom:1rem;font-size:0.9rem;">Ter controle bij moderatie (ID ${h(String(org.id))}).</p>
                        <div class="moderation-org-preview-grid">
                            ${block('Status', `<span class="status-badge ${org.is_approved ? 'status-published' : 'status-draft'}">${h(statusNl)}</span>`)}
                            ${block('Aangemeld', h(created))}
                            ${block('Naam', textOrDash(org.name))}
                            ${block('Categorie', textOrDash(org.category))}
                            ${block('Beschrijving', textOrDash(org.description))}
                            ${block('Bio', textOrDash(org.bio))}
                            ${block('E-mail', textOrDash(org.email))}
                            ${block('Website', linkOrDash(org.website))}
                            ${block('Telefoon', textOrDash(org.phone))}
                            ${block('WhatsApp', textOrDash(org.whatsapp))}
                            ${block('Adres', textOrDash(org.address))}
                            ${block('Facebook', linkOrDash(org.facebook))}
                            ${block('Instagram', linkOrDash(org.instagram))}
                            ${block('Twitter / X', linkOrDash(org.twitter))}
                            ${block('LinkedIn', linkOrDash(org.linkedin))}
                            ${block('Brandkleur', brand)}
                        </div>
                        ${logoSection}
                        <div class="form-group" style="margin-top:1rem;">
                            <label>Privacyverklaring</label>
                            ${textOrDash(org.privacy_statement)}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" data-org-preview-close>Sluiten</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            const close = () => modal.remove();
            modal.querySelectorAll('[data-org-preview-close]').forEach((el) => el.addEventListener('click', close));
            modal.addEventListener('click', (e) => {
                if (e.target === modal) close();
            });
            modal.querySelector('.modal-content')?.addEventListener('click', (e) => e.stopPropagation());
        } catch (error) {
            console.error('previewOrganizationFromModeration:', error);
            this.showNotification('Fout bij laden van organisatie', 'error');
        }
    }

    // User management methods
    async viewUser(id) {
        try {
            let user = this.findUserById(id, this.allUsersCache);
            if (!user) {
                const response = await fetch(`${this.apiBaseUrl}/admin/users?limit=5000`, {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    user = this.findUserById(id, data.users);
                } else {
                    this.showNotification('Fout bij ophalen gebruikersgegevens', 'error');
                    return;
                }
            }
            if (user) {
                this.showUserModal(user);
            } else {
                this.showNotification('Gebruiker niet gevonden in de lijst. Vernieuw de pagina of controleer rechten.', 'error');
            }
        } catch (error) {
            console.error('Error getting user details:', error);
            this.showNotification('Fout bij ophalen gebruikersgegevens', 'error');
        }
    }

    showUserModal(user) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        const uid = user.id;
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Gebruikersprofiel</h3>
                    <button type="button" class="modal-close" aria-label="Sluiten">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="user-profile">
                        <div class="profile-avatar">
                            ${user.profile_image_url && user.profile_image_url !== '' ? 
                                `<img src="${user.profile_image_url}" alt="Profielfoto" class="profile-img">` : 
                                `<div class="profile-placeholder">
                                    <i class="fas fa-user"></i>
                                </div>`
                            }
                        </div>
                        <div class="profile-info">
                            <h4>${user.first_name} ${user.last_name}</h4>
                            <div class="profile-details">
                                <div class="detail-row">
                                    <label>ID:</label>
                                    <span>${user.id}</span>
                                </div>
                                <div class="detail-row">
                                    <label>E-mail:</label>
                                    <span>${user.email}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Telefoon:</label>
                                    <span>${user.phone || 'Niet opgegeven'}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Rol:</label>
                                    <span class="role-badge role-${user.role}">${user.role}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Status:</label>
                                    <span class="status-badge status-${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Actief' : 'Inactief'}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Geregistreerd:</label>
                                    <span>${new Date(user.created_at).toLocaleDateString('nl-NL')} om ${new Date(user.created_at).toLocaleTimeString('nl-NL')}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary js-user-view-close">Sluiten</button>
                    <button type="button" class="btn btn-primary js-user-view-edit">Bewerken</button>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('.modal-close')?.addEventListener('click', close);
        modal.querySelector('.js-user-view-close')?.addEventListener('click', close);
        modal.querySelector('.js-user-view-edit')?.addEventListener('click', () => {
            close();
            this.editUser(uid);
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
    }

    async editUser(id) {
        try {
            let user = this.findUserById(id, this.allUsersCache);
            if (!user) {
                const response = await fetch(`${this.apiBaseUrl}/admin/users?limit=5000`, {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    user = this.findUserById(id, data.users);
                } else {
                    this.showNotification('Fout bij ophalen gebruikersgegevens', 'error');
                    return;
                }
            }
            if (user) {
                await this.ensureOrganizationsListForUsers();
                this.showEditUserModal(user);
            } else {
                this.showNotification('Gebruiker niet gevonden in de lijst. Vernieuw de pagina of controleer rechten.', 'error');
            }
        } catch (error) {
            console.error('Error getting user details:', error);
            this.showNotification('Fout bij ophalen gebruikersgegevens', 'error');
        }
    }

    showEditUserModal(user) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        const userId = user.id;
        modal.innerHTML = `
            <div class="modal-content modal-large" id="editUserModalRoot">
                <div class="modal-header">
                    <h3>Gebruiker Bewerken</h3>
                    <button type="button" class="modal-close" aria-label="Sluiten">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="editUserForm" class="edit-form">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="editFirstName">Voornaam *</label>
                                <input type="text" id="editFirstName" name="first_name" value="${user.first_name}" required>
                            </div>
                            <div class="form-group">
                                <label for="editLastName">Achternaam *</label>
                                <input type="text" id="editLastName" name="last_name" value="${user.last_name}" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="editEmail">E-mail *</label>
                                <input type="email" id="editEmail" name="email" value="${user.email}" required>
                            </div>
                            <div class="form-group">
                                <label for="editPhone">Telefoon</label>
                                <input type="tel" id="editPhone" name="phone" value="${user.phone || ''}">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="editRole">Rol</label>
                                <select id="editRole" name="role">
                                    <option value="user" ${user.role === 'user' ? 'selected' : ''}>Gebruiker</option>
                                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                                    <option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Super Admin</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="editStatus">Status</label>
                                <select id="editStatus" name="is_active">
                                    <option value="true" ${user.is_active ? 'selected' : ''}>Actief</option>
                                    <option value="false" ${!user.is_active ? 'selected' : ''}>Inactief</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="editOrganizationId">Organisatie (dashboard)</label>
                            <select id="editOrganizationId" name="organization_id">
                                ${this.buildOrganizationSelectHtml(user.organization_id)}
                            </select>
                            <small style="display:block;margin-top:0.35rem;color:#666;">Voor dashboard-inlog: juiste organisatie kiezen en rol «Gebruiker» laten staan.</small>
                        </div>
                        <div class="form-group">
                            <label>Profielfoto</label>
                            <div class="profile-image-section">
                                <div class="current-image">
                                    <label>Huidige foto:</label>
                                    <div class="current-image-preview">
                                        ${user.profile_image_url && user.profile_image_url !== '' ? 
                                            `<img src="${user.profile_image_url}" alt="Huidige foto" class="preview-img">` : 
                                            `<div class="preview-placeholder">
                                                <i class="fas fa-user"></i>
                                                <span>Geen foto</span>
                                            </div>`
                                        }
                                    </div>
                                </div>
                                <div class="image-options">
                                    <div class="option-tabs">
                                        <button type="button" class="tab-btn active" data-image-tab="url">URL</button>
                                        <button type="button" class="tab-btn" data-image-tab="upload">Upload</button>
                                    </div>
                                    <div class="tab-content">
                                        <div id="url-tab" class="tab-pane active">
                                            <input type="url" id="editProfileImage" name="profile_image_url" value="${user.profile_image_url || ''}" placeholder="https://...">
                                        </div>
                                        <div id="upload-tab" class="tab-pane">
                                            <input type="file" id="profileImageUpload" name="profile_image_file" accept="image/*">
                                            <div id="uploadPreview" class="upload-preview" style="display: none;">
                                                <img id="uploadedImagePreview" src="" alt="Preview" class="preview-img">
                                                <button type="button" class="btn btn-sm btn-secondary js-clear-upload-preview">Verwijder</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary js-edit-user-cancel">Annuleren</button>
                    <button type="button" class="btn btn-primary js-edit-user-save">Opslaan</button>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
        document.body.appendChild(modal);
        const closeEdit = () => modal.remove();
        modal.querySelector('.modal-close')?.addEventListener('click', closeEdit);
        modal.querySelector('.js-edit-user-cancel')?.addEventListener('click', closeEdit);
        modal.querySelector('.js-edit-user-save')?.addEventListener('click', () => this.saveUserChanges(userId));
        modal.querySelectorAll('[data-image-tab]').forEach((btn) => {
            btn.addEventListener('click', () => this.switchImageTab(btn.getAttribute('data-image-tab')));
        });
        modal.querySelector('#profileImageUpload')?.addEventListener('change', (e) => this.previewUploadedImage(e.target));
        modal.querySelector('.js-clear-upload-preview')?.addEventListener('click', () => this.clearUploadPreview());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeEdit();
        });
    }

    changeUserRole(id) {
        const u = this.findUserById(id, this.allUsersCache);
        const r = u && u.role != null ? u.role : '';
        this.showNotification(
            `Rol wijzigen: gebruik de knop «Bewerken» (potlood). Huidige rol: ${r || '—'}.`,
            'info'
        );
    }

    async toggleUserStatus(id, isActive) {
        if (!this.token) {
            this.showNotification('Niet ingelogd.', 'error');
            return;
        }
        const next = !Boolean(isActive);
        try {
            const res = await fetch(`${this.apiBaseUrl}/admin/users/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ is_active: next })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                this.showNotification(data.message || data.error || `Status bijwerken mislukt (${res.status})`, 'error');
                return;
            }
            this.showNotification(next ? 'Gebruiker geactiveerd' : 'Gebruiker gedeactiveerd', 'success');
            this.loadUsers();
        } catch (e) {
            console.error(e);
            this.showNotification('Status bijwerken mislukt.', 'error');
        }
    }

    async deleteUser(id) {
        if (!this.token) {
            this.showNotification('Niet ingelogd.', 'error');
            return;
        }
        if (!confirm('Deze gebruiker definitief verwijderen? Dit kan niet ongedaan worden.')) {
            return;
        }
        try {
            const res = await fetch(`${this.apiBaseUrl}/admin/users/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                this.showNotification(data.message || data.error || `Verwijderen mislukt (${res.status})`, 'error');
                return;
            }
            this.showNotification('Gebruiker verwijderd', 'success');
            this.loadUsers();
        } catch (e) {
            console.error(e);
            this.showNotification('Verwijderen mislukt.', 'error');
        }
    }

    async saveUserChanges(userId) {
        try {
            // Check if token is still valid
            if (!this.token) {
                this.showNotification('Sessie verlopen. Log opnieuw in.', 'error');
                this.showLoginScreen();
                return;
            }

            const form = document.getElementById('editUserForm');
            const formData = new FormData(form);
            
            // Check if we have an uploaded file
            const uploadedFile = document.getElementById('profileImageUpload').files[0];
            let profileImageUrl = formData.get('profile_image_url') || null;
            
            // If file is uploaded, compress and convert to base64
            if (uploadedFile) {
                try {
                    const compressedBase64 = await this.compressAndConvertToBase64(uploadedFile);
                    profileImageUrl = compressedBase64;
                    console.log('File compressed and converted to base64, length:', compressedBase64.length);
                    
                    // Check if still too large (4MB limit for safety)
                    if (compressedBase64.length > 4 * 1024 * 1024) {
                        this.showNotification('Afbeelding is te groot. Kies een kleinere afbeelding.', 'error');
                        return;
                    }
                } catch (error) {
                    console.error('Error processing image:', error);
                    this.showNotification('Fout bij verwerken van afbeelding', 'error');
                    return;
                }
            }
            
            const userData = {
                first_name: formData.get('first_name'),
                last_name: formData.get('last_name'),
                email: formData.get('email'),
                phone: formData.get('phone') || null,
                role: formData.get('role'),
                is_active: formData.get('is_active') === 'true',
                profile_image_url: profileImageUrl
            };
            const orgEl = document.getElementById('editOrganizationId');
            if (orgEl) {
                const v = orgEl.value;
                if (v === '') userData.organization_id = null;
                else {
                    const n = parseInt(v, 10);
                    userData.organization_id = Number.isNaN(n) ? null : n;
                }
            }

            console.log('Saving user data:', { ...userData, profile_image_url: profileImageUrl ? 'base64 data' : null });
            console.log('API URL:', `${this.apiBaseUrl}/admin/users/${userId}`);
            console.log('Token:', this.token ? 'Present' : 'Missing');

            const response = await fetch(`${this.apiBaseUrl}/admin/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(userData)
            });

            console.log('Response status:', response.status);
            console.log('Response headers:', Object.fromEntries(response.headers.entries()));

            if (response.ok) {
                const result = await response.json();
                console.log('Update successful:', result);
                this.showNotification('Gebruiker succesvol bijgewerkt', 'success');
                document.getElementById('editUserModalRoot')?.closest('.modal-overlay')?.remove();
                this.loadUsers(); // Refresh the users list
            } else {
                let errorMessage = 'Onbekende fout';
                try {
                    const error = await response.json();
                    console.error('Update error response:', error);
                    errorMessage = error.message || error.error || 'Onbekende fout';
                } catch (parseError) {
                    console.error('Error parsing response:', parseError);
                    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }
                this.showNotification(`Fout bij bijwerken: ${errorMessage}`, 'error');
            }
        } catch (error) {
            console.error('Error updating user:', error);
            this.showNotification('Fout bij bijwerken gebruiker', 'error');
        }
    }


    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    compressAndConvertToBase64(file) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                // Calculate new dimensions (max 48x48 for extremely small files to fit VARCHAR(500))
                const maxSize = 48;
                let { width, height } = img;
                
                if (width > height) {
                    if (width > maxSize) {
                        height = (height * maxSize) / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = (width * maxSize) / height;
                        height = maxSize;
                    }
                }
                
                // Set canvas dimensions
                canvas.width = width;
                canvas.height = height;
                
                // Draw and compress
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to base64 with extreme compression (0.2 quality for extremely small files)
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.2);
                resolve(compressedBase64);
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(file);
        });
    }

    compressEventImage(file) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                // Calculate new dimensions (max 1200px width/height for events)
                const maxSize = 1200;
                let { width, height } = img;
                
                if (width > height) {
                    if (width > maxSize) {
                        height = (height * maxSize) / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = (width * maxSize) / height;
                        height = maxSize;
                    }
                }
                
                // Set canvas dimensions
                canvas.width = width;
                canvas.height = height;
                
                // Draw and compress
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to base64 with good compression (0.7 quality for events)
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                resolve(compressedBase64);
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(file);
        });
    }

    async previewEventImage(input) {
        const file = input.files[0];
        if (file) {
            try {
                const compressedBase64 = await this.compressEventImage(file);
                const previewDiv = document.getElementById('evImagePreview');
                const previewImg = document.getElementById('evImagePreviewImg');
                if (previewDiv && previewImg) {
                    previewImg.src = compressedBase64;
                    previewDiv.style.display = 'block';
                }
            } catch (error) {
                console.error('Error previewing image:', error);
                this.showNotification('Fout bij voorvertoning afbeelding', 'error');
            }
        }
    }

    clearEventImagePreview() {
        const input = document.getElementById('evImage');
        const previewDiv = document.getElementById('evImagePreview');
        if (input) input.value = '';
        if (previewDiv) previewDiv.style.display = 'none';
    }

    switchImageTab(tab) {
        const root = document.getElementById('editUserModalRoot');
        if (!root) return;
        root.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
        root.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
        const selBtn = root.querySelector(`[data-image-tab="${tab}"]`);
        if (selBtn) selBtn.classList.add('active');
        const pane = root.querySelector(`#${tab}-tab`);
        if (pane) pane.classList.add('active');
    }

    async previewUploadedImage(input) {
        const file = input.files[0];
        if (file) {
            try {
                // Use compressed version for preview too
                const compressedBase64 = await this.compressAndConvertToBase64(file);
                document.getElementById('uploadedImagePreview').src = compressedBase64;
                document.getElementById('uploadPreview').style.display = 'block';
            } catch (error) {
                console.error('Error previewing image:', error);
                // Fallback to original method
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById('uploadedImagePreview').src = e.target.result;
                    document.getElementById('uploadPreview').style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        }
    }

    clearUploadPreview() {
        document.getElementById('profileImageUpload').value = '';
        document.getElementById('uploadPreview').style.display = 'none';
    }

    // Color picker functions
    updateColorFromHex(hexValue) {
        // Validate hex color
        if (/^#[0-9A-F]{6}$/i.test(hexValue)) {
            document.getElementById('editOrgBrandColor').value = hexValue;
            document.getElementById('editOrgBrandColorHex').value = hexValue;
        } else {
            this.showNotification('Ongeldige hex kleur. Gebruik formaat #RRGGBB', 'error');
        }
    }

    // ===== ORGANIZATION TAB MANAGEMENT =====
    switchOrgTab(tabName, orgId) {
        // Remove active class from all tabs and panes
        document.querySelectorAll('.org-tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.org-tab-pane').forEach(pane => pane.classList.remove('active'));
        
        // Add active class to selected tab and pane
        document.querySelector(`[onclick="admin.switchOrgTab('${tabName}', ${orgId})"]`).classList.add('active');
        document.getElementById(`org-tab-${tabName}`).classList.add('active');
        
        // Load content for the selected tab
        this.loadOrgTabContent(tabName, orgId);
    }

    async loadOrgTabContent(tabName, orgId) {
        const tabPane = document.getElementById(`org-tab-${tabName}`);
        
        switch(tabName) {
            case 'news':
                await this.loadOrgNews(orgId, tabPane);
                break;
            case 'events':
                await this.loadOrgEvents(orgId, tabPane);
                break;
            case 'followers':
                await this.loadOrgFollowers(orgId, tabPane);
                break;
            case 'profile':
            default:
                // Profile tab is already loaded
                break;
        }
    }

    async loadOrgNews(orgId, tabPane) {
        try {
            tabPane.innerHTML = `
                <div class="tab-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>Nieuws laden...</span>
                </div>
            `;

            const response = await fetch(`${this.apiBaseUrl}/admin/news?organization_id=${orgId}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayOrgNews(data.news || [], tabPane);
            } else {
                tabPane.innerHTML = '<p>Fout bij laden nieuws.</p>';
            }
        } catch (error) {
            console.error('Error loading org news:', error);
            tabPane.innerHTML = '<p>Fout bij laden nieuws.</p>';
        }
    }

    async loadOrgEvents(orgId, tabPane) {
        try {
            tabPane.innerHTML = `
                <div class="tab-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>Events laden...</span>
                </div>
            `;

            const response = await fetch(`${this.apiBaseUrl}/admin/events?organization_id=${orgId}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayOrgEvents(data.events || [], tabPane);
            } else {
                tabPane.innerHTML = '<p>Fout bij laden events.</p>';
            }
        } catch (error) {
            console.error('Error loading org events:', error);
            tabPane.innerHTML = '<p>Fout bij laden events.</p>';
        }
    }

    async loadOrgFollowers(orgId, tabPane) {
        try {
            tabPane.innerHTML = `
                <div class="tab-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>Volgers laden...</span>
                </div>
            `;

            const response = await fetch(`${this.apiBaseUrl}/admin/organizations/${orgId}/followers`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayOrgFollowers(data.followers || [], tabPane);
            } else {
                tabPane.innerHTML = '<p>Fout bij laden volgers.</p>';
            }
        } catch (error) {
            console.error('Error loading org followers:', error);
            tabPane.innerHTML = '<p>Fout bij laden volgers.</p>';
        }
    }

    displayOrgNews(news, tabPane) {
        if (news.length === 0) {
            tabPane.innerHTML = '<p>Geen nieuws gevonden voor deze organisatie.</p>';
            return;
        }

        tabPane.innerHTML = `
            <div class="org-content-list">
                ${news.map(article => `
                    <div class="content-item">
                        <div class="content-header">
                            <h5>${article.title}</h5>
                            <span class="content-status status-active">
                                Gepubliceerd
                            </span>
                        </div>
                        <div class="content-meta">
                            <small>${this.formatNewsArticleDate(article)}</small>
                        </div>
                        <div class="content-actions">
                            <button class="btn btn-sm btn-primary" onclick="admin.viewNews(${article.id})">
                                <i class="fas fa-eye"></i> Bekijken
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    displayOrgEvents(events, tabPane) {
        if (events.length === 0) {
            tabPane.innerHTML = '<p>Geen events gevonden voor deze organisatie.</p>';
            return;
        }

        tabPane.innerHTML = `
            <div class="org-content-list">
                ${events.map(event => `
                    <div class="content-item">
                        <div class="content-header">
                            <h5>${event.title}</h5>
                            <span class="content-status status-${event.is_published ? 'active' : 'inactive'}">
                                ${event.is_published ? 'Gepubliceerd' : 'Wachtend'}
                            </span>
                        </div>
                        <div class="content-meta">
                            <small>${new Date(event.event_date).toLocaleDateString('nl-NL')} - ${event.location || 'Locatie onbekend'}</small>
                        </div>
                        <div class="content-actions">
                            <button type="button" class="btn btn-sm btn-secondary" data-org-event-action="edit" data-org-event-id="${event.id}">
                                <i class="fas fa-edit"></i> Bewerken
                            </button>
                            <button type="button" class="btn btn-sm btn-primary" data-org-event-action="view" data-org-event-id="${event.id}">
                                <i class="fas fa-eye"></i> Bekijken
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        tabPane.querySelectorAll('[data-org-event-action]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const eid = parseInt(btn.getAttribute('data-org-event-id'), 10);
                const mode = btn.getAttribute('data-org-event-action');
                if (!Number.isNaN(eid) && (mode === 'edit' || mode === 'view')) {
                    this.openEventModal(eid, mode);
                }
            });
        });
    }

    displayOrgFollowers(followers, tabPane) {
        if (followers.length === 0) {
            tabPane.innerHTML = '<p>Deze organisatie heeft nog geen volgers.</p>';
            return;
        }

        tabPane.innerHTML = `
            <div class="followers-list">
                ${followers.map(follower => `
                    <div class="follower-item">
                        <div class="follower-avatar">
                            ${follower.profile_image_url ? 
                                `<img src="${follower.profile_image_url}" alt="Avatar" class="avatar-img">` :
                                `<div class="avatar-placeholder">
                                    <i class="fas fa-user"></i>
                                </div>`
                            }
                        </div>
                        <div class="follower-info">
                            <strong>${follower.first_name} ${follower.last_name}</strong>
                            <small>${follower.email}</small>
                        </div>
                        <div class="follower-meta">
                            <small>Volgt sinds ${new Date(follower.followed_at).toLocaleDateString('nl-NL')}</small>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Uniforme Event Modal (voor nieuw, bewerken en bekijken)
    async openEventModal(eventId, mode = 'create') {
        try {
            let initial = {
                title: '',
                description: '',
                event_date: '',
                event_end_date: '',
                location: '',
                organization_id: '',
                organization_name: '',
                image_url: ''
            };
            
            let organizations = [];
            
            // Haal organisaties op voor dropdown (bij create en edit)
            if (mode !== 'view') {
                try {
                    const orgRes = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                        headers: {
                            'Authorization': `Bearer ${this.token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    if (orgRes.ok) {
                        const orgData = await orgRes.json();
                        organizations = this._sortOrganizationsByName(orgData.organizations || []);
                        console.log('Organizations loaded:', organizations.length);
                    } else {
                        // Niet gooien van error, gewoon loggen en doorgaan zonder organisaties
                        const errorText = await orgRes.text();
                        console.warn('Failed to load organizations:', orgRes.status, errorText);
                        // Toon alleen een waarschuwing, geen error
                        this.showNotification('Organisaties konden niet worden geladen. Je kunt nog steeds een event aanmaken.', 'warning');
                    }
                } catch (err) {
                    // Bij network errors, gewoon loggen en doorgaan
                    console.warn('Error loading organizations (continuing anyway):', err);
                    // Geen notification - modal wordt gewoon getoond zonder organisaties
                }
            }
            
            if (eventId) {
                // Haal event data op voor bewerken/bekijken
                try {
                    const eventIdNum = parseInt(eventId);
                    if (isNaN(eventIdNum)) {
                        throw new Error(`Ongeldig event ID: ${eventId}`);
                    }
                    
                    // Try route parameter first, then fallback to query parameter
                    let eventUrl = `${this.apiBaseUrl}/admin/events/${eventIdNum}`;
                    console.log('Loading event with ID:', eventIdNum);
                    console.log('Trying route parameter URL:', eventUrl);
                    console.log('API Base URL:', this.apiBaseUrl);
                    console.log('Token present:', !!this.token);
                    
                    let res = await fetch(eventUrl, {
                        headers: { 
                            'Authorization': `Bearer ${this.token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    // If route parameter fails with 404, try query parameter as fallback
                    if (!res.ok && res.status === 404) {
                        console.log('Route parameter failed, trying query parameter...');
                        eventUrl = `${this.apiBaseUrl}/admin/events?id=${eventIdNum}`;
                        console.log('Trying query parameter URL:', eventUrl);
                        res = await fetch(eventUrl, {
                            headers: { 
                                'Authorization': `Bearer ${this.token}`,
                                'Content-Type': 'application/json'
                            }
                        });
                    }
                    
                    console.log('Event response status:', res.status, 'OK:', res.ok);
                    console.log('Response URL:', res.url);
                    
                    if (!res.ok) {
                        const errorText = await res.text();
                        let errorData;
                        try {
                            errorData = JSON.parse(errorText);
                        } catch {
                            errorData = { error: errorText || `HTTP ${res.status}` };
                        }
                        console.error('Failed to load event:');
                        console.error('  Status:', res.status);
                        console.error('  URL:', eventUrl);
                        console.error('  Response URL:', res.url);
                        console.error('  Error data:', errorData);
                        throw new Error(errorData.error || errorData.message || `HTTP ${res.status}: ${errorText}`);
                    }
                    
                    const data = await res.json();
                    console.log('Event data received:', data);
                    
                    // Handle both response structures: { event: {...} } or { events: [...] }
                    let ev = null;
                    if (data && data.event) {
                        ev = data.event;
                    } else if (data && data.events && Array.isArray(data.events) && data.events.length > 0) {
                        // Fallback: if we got a list, find the event by ID
                        ev = data.events.find(e => e.id === eventIdNum);
                        if (!ev) {
                            throw new Error(`Event met ID ${eventIdNum} niet gevonden in response`);
                        }
                    } else {
                        throw new Error('Event data niet gevonden in response');
                    }
                    
                    if (!ev) {
                        throw new Error('Event data niet gevonden in response');
                    }
                    initial = {
                        title: ev.title || '',
                        description: ev.description || '',
                        event_date: ev.event_date ? this._toDatetimeInputValue(ev.event_date) : '',
                        event_end_date: ev.event_end_date ? this._toDatetimeInputValue(ev.event_end_date) : (ev.event_date ? this._toDatetimeInputValue(ev.event_date) : ''),
                        location: ev.location || '',
                        organization_id: ev.organization_id || '',
                        organization_name: ev.organization_name || '',
                        image_url: ev.image_url || ''
                    };
                    console.log('Initial data set:', initial);
                    
                } catch (err) {
                    console.error('Error loading event:', err);
                    const errorMsg = err.message || 'Onbekende fout';
                    this.showNotification(`Fout bij laden evenement: ${errorMsg}`, 'error');
                    // Stop hier - zonder event data kunnen we niet bewerken
                    return;
                }
            }

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            
            if (mode === 'view') {
                // Preview modus - toon event zoals in de app
                const eventDate = initial.event_date ? new Date(initial.event_date).toLocaleDateString('nl-NL', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }) : '';
                const eventTime = initial.event_date ? new Date(initial.event_date).toLocaleTimeString('nl-NL', {
                    hour: '2-digit',
                    minute: '2-digit'
                }) : '';
                const endTime = initial.event_end_date ? new Date(initial.event_end_date).toLocaleTimeString('nl-NL', {
                    hour: '2-digit',
                    minute: '2-digit'
                }) : '';
                
                overlay.innerHTML = `
                    <div class="modal" style="max-width: 600px;">
                        <div class="modal-header">
                            <h3>Event Preview</h3>
                            <button type="button" class="close js-event-modal-close" aria-label="Sluiten">&times;</button>
                        </div>
                        <div class="modal-body" style="padding: 0;">
                            <div style="background: linear-gradient(135deg, #f8f6f0 0%, #f0ede5 100%); padding: 24px; border-radius: 12px 12px 0 0;">
                                <h1 style="font-size: 28px; font-weight: 600; color: #212529; margin-bottom: 16px; line-height: 1.3;">${initial.title || 'Geen titel'}</h1>
                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                                    <div style="display: flex; align-items: center; gap: 8px; color: #6c757d;">
                                        <i class="fas fa-calendar" style="font-size: 16px;"></i>
                                        <span style="font-weight: 500;">${eventDate}</span>
                                    </div>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                                    <div style="display: flex; align-items: center; gap: 8px; color: #6c757d;">
                                        <i class="fas fa-clock" style="font-size: 16px;"></i>
                                        <span style="font-weight: 500;">${eventTime}${endTime ? ` - ${endTime}` : ''}</span>
                                    </div>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                                    <div style="display: flex; align-items: center; gap: 8px; color: #6c757d;">
                                        <i class="fas fa-map-marker-alt" style="font-size: 16px;"></i>
                                        <span style="font-weight: 500;">${initial.location || 'Locatie onbekend'}</span>
                                    </div>
                                </div>
                                ${initial.organization_name ? `
                                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                                        <div style="display: flex; align-items: center; gap: 8px; color: #6c757d;">
                                            <i class="fas fa-building" style="font-size: 16px;"></i>
                                            <span style="font-weight: 500;">${initial.organization_name}</span>
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                            <div style="padding: 24px;">
                                <h3 style="font-size: 18px; font-weight: 600; color: #212529; margin-bottom: 12px;">Beschrijving</h3>
                                <div style="color: #495057; line-height: 1.6; white-space: pre-wrap;">${initial.description || 'Geen beschrijving beschikbaar'}</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary js-event-modal-close">Sluiten</button>
                        </div>
                    </div>
                `;
            } else {
                // Create/Edit modus - toon formulier
                overlay.innerHTML = `
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>${mode === 'create' ? 'Nieuw event' : 'Event bewerken'}</h3>
                            <button type="button" class="close js-event-modal-close" aria-label="Sluiten">&times;</button>
                        </div>
                        <div class="modal-body">
                            <form id="eventForm" class="form">
                                <div class="form-group">
                                    <label>Titel</label>
                                    <input type="text" id="evTitle" value="${initial.title}" placeholder="Titel">
                                </div>
                                <div class="form-group">
                                    <label>Omschrijving</label>
                                    <textarea id="evDesc" style="min-height:120px" placeholder="Omschrijving">${initial.description}</textarea>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label>Begindatum</label>
                                        <input type="datetime-local" id="evStart" value="${initial.event_date}">
                                    </div>
                                    <div class="form-group">
                                        <label>Einddatum</label>
                                        <input type="datetime-local" id="evEnd" value="${initial.event_end_date}">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Locatie</label>
                                    <input type="text" id="evLocation" value="${initial.location}" placeholder="Locatie">
                                </div>
                                <div class="form-group">
                                    <label>Organisatie (optioneel)</label>
                                    <select id="evOrg">
                                        <option value="">Geen organisatie</option>
                                        ${organizations.map(org => `
                                            <option value="${org.id}" ${org.id == initial.organization_id ? 'selected' : ''}>${org.name || `Organisatie ${org.id}`}</option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Afbeelding (optioneel)</label>
                                    <input type="file" id="evImage" accept="image/*">
                                    <div id="evImagePreview" style="display: none; margin-top: 10px;">
                                        <img id="evImagePreviewImg" src="" style="max-width: 200px; max-height: 200px; border-radius: 8px;">
                                        <button type="button" class="btn btn-sm btn-secondary" id="evImageClearBtn" style="margin-top: 5px;">Verwijder afbeelding</button>
                                    </div>
                                    ${initial.image_url ? `
                                        <div style="margin-top: 10px;" data-existing-image="${initial.image_url}">
                                            <p>Huidige afbeelding:</p>
                                            <img src="${initial.image_url}" style="max-width: 200px; max-height: 200px; border-radius: 8px;">
                                        </div>
                                    ` : ''}
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary js-event-modal-close">Annuleren</button>
                            <button type="button" class="btn btn-primary" id="eventFormSaveBtn">Opslaan</button>
                        </div>
                    </div>
                `;
            }
            overlay.style.display = 'flex';
            document.body.appendChild(overlay);

            const closeOverlay = () => overlay.remove();
            overlay.querySelectorAll('.js-event-modal-close').forEach((b) => {
                b.addEventListener('click', () => closeOverlay());
            });
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeOverlay();
            });

            if (mode !== 'view') {
                const saveId = eventId != null && eventId !== '' ? parseInt(eventId, 10) : null;
                const saveBtn = overlay.querySelector('#eventFormSaveBtn');
                if (saveBtn) {
                    saveBtn.addEventListener('click', () => {
                        this.saveEvent(Number.isNaN(saveId) ? null : saveId);
                    });
                }
                const evImageInput = overlay.querySelector('#evImage');
                if (evImageInput) {
                    evImageInput.addEventListener('change', () => this.previewEventImage(evImageInput));
                }
                const evImageClearBtn = overlay.querySelector('#evImageClearBtn');
                if (evImageClearBtn) {
                    evImageClearBtn.addEventListener('click', () => this.clearEventImagePreview());
                }
                const startEl = overlay.querySelector('#evStart');
                const endEl = overlay.querySelector('#evEnd');
                const syncEnd = () => {
                    if (startEl && endEl && startEl.value) {
                        endEl.min = startEl.value;
                        if (!endEl.value || endEl.value < startEl.value) {
                            endEl.value = startEl.value;
                        }
                    }
                };
                if (startEl && endEl) {
                    startEl.addEventListener('change', syncEnd);
                    syncEnd();
                }
            }
        } catch (e) {
            console.error('openEventModal error:', e);
            this.showNotification('Fout bij openen event-modal', 'error');
        }
    }

    async saveEvent(eventId) {
        try {
            // Parse eventId correct (kan 'null' string zijn) - MOET AAN HET BEGIN
            const actualEventId = eventId && eventId !== 'null' && eventId !== null ? parseInt(eventId) : null;
            
            // Verzamel formulier waarden
            const title = (document.getElementById('evTitle').value || '').trim();
            const description = (document.getElementById('evDesc').value || '').trim();
            const event_date_raw = document.getElementById('evStart').value;
            const event_end_date_raw = document.getElementById('evEnd').value;
            const location = (document.getElementById('evLocation').value || '').trim();
            const organization_id_val = document.getElementById('evOrg')?.value;
            const organization_id = (organization_id_val && organization_id_val !== '' && organization_id_val !== '0') 
              ? parseInt(organization_id_val) 
              : null;
            
            console.log('saveEvent - organization_id:', organization_id, 'from value:', organization_id_val);

            // Handle image upload
            const uploadedFile = document.getElementById('evImage')?.files[0];
            let imageUrl = null;
            
            if (uploadedFile) {
                try {
                    const compressedBase64 = await this.compressEventImage(uploadedFile);
                    console.log('Event image compressed (temp base64), length:', compressedBase64.length);
                    
                    if (compressedBase64.length > 4 * 1024 * 1024) {
                        this.showNotification('Afbeelding is te groot. Kies een kleinere afbeelding.', 'error');
                        return;
                    }

                    // Upload to backend (folder uploads/YYYY/MM/<orgNum>/)
                    const uploadRes = await fetch(`${this.apiBaseUrl}/upload/image`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({
                            imageData: compressedBase64,
                            filename: `event-image-${Date.now()}.jpg`,
                            organizationId: organization_id != null ? organization_id : undefined
                        })
                    });
                    if (!uploadRes.ok) {
                        let msg = `HTTP ${uploadRes.status}`;
                        try { const j = await uploadRes.json(); msg = j.message || j.error || msg; } catch {}
                        throw new Error(msg);
                    }
                    const uploadJson = await uploadRes.json();
                    imageUrl = uploadJson.imageUrl || null;
                } catch (error) {
                    console.error('Error processing image:', error);
                    this.showNotification('Fout bij verwerken van afbeelding', 'error');
                    return;
                }
            } else {
                // Als er geen nieuwe afbeelding is geüpload, behoud de bestaande (bij edit)
                const existingImage = document.querySelector('#evImagePreviewImg')?.src;
                if (existingImage && existingImage.startsWith('data:image')) {
                    const uploadRes = await fetch(`${this.apiBaseUrl}/upload/image`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({
                            imageData: existingImage,
                            filename: `event-image-${Date.now()}.jpg`,
                            organizationId: organization_id != null ? organization_id : undefined
                        })
                    });
                    if (!uploadRes.ok) {
                        let msg = `HTTP ${uploadRes.status}`;
                        try { const j = await uploadRes.json(); msg = j.message || j.error || msg; } catch {}
                        throw new Error(msg);
                    }
                    const uploadJson = await uploadRes.json();
                    imageUrl = uploadJson.imageUrl || null;
                } else if (actualEventId) {
                    // Bij bewerken zonder nieuwe afbeelding, haal de bestaande image_url op
                    const existingImageUrl = document.querySelector('[data-existing-image]')?.getAttribute('data-existing-image');
                    if (existingImageUrl) {
                        imageUrl = existingImageUrl;
                    } else {
                        // Stuur undefined in plaats van null, zodat backend de bestaande waarde behoudt
                        imageUrl = undefined;
                    }
                }
            }

            // Validatie
            if (!title || !description || !event_date_raw || !location) {
                this.showNotification('Vul alle verplichte velden in', 'error');
                return;
            }

            const body = {
                title,
                description,
                event_date: event_date_raw,
                event_end_date: event_end_date_raw || null,
                location,
                organization_id,
                is_published: true
            };
            
            // Voeg image_url alleen toe als het gedefinieerd is
            if (imageUrl !== undefined) {
                body.image_url = imageUrl;
            }

            // Bepaal URL en method op basis van actualEventId (al gedeclareerd aan het begin)
            const url = actualEventId ? `${this.apiBaseUrl}/admin/events/${actualEventId}` : `${this.apiBaseUrl}/admin/events`;
            const method = actualEventId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                let errorDetails = '';
                try { 
                    const j = await res.json(); 
                    msg = j.message || j.error || msg;
                    errorDetails = j.details ? `\nDetails: ${j.details}` : '';
                } catch {}
                console.error('Save event failed:', res.status, msg, errorDetails);
                this.showNotification(`Opslaan mislukt: ${msg}${errorDetails}`, 'error');
                return;
            }

            this.showNotification('Event opgeslagen', 'success');
            document.getElementById('evTitle')?.closest('.modal-overlay')?.remove();
            // Refresh events lijst
            this.loadEvents();
            // Refresh organisatie lijst als we in een organisatie zitten
            if (typeof this.loadOrganizations === 'function') {
                this.loadOrganizations();
            }
        } catch (e) {
            console.error('saveEvent error:', e);
            const errorMsg = e?.message || e?.toString() || 'Onbekende fout';
            console.error('Full error details:', e);
            this.showNotification(`Fout bij opslaan event: ${errorMsg}`, 'error');
        }
    }
}


// Mobile menu toggle function
window.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('open');
};

// Close sidebar when clicking outside on mobile
document.addEventListener('click', function(event) {
    const sidebar = document.querySelector('.sidebar');
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    
    if (window.innerWidth <= 768 && 
        !sidebar.contains(event.target) && 
        !mobileMenuBtn.contains(event.target) && 
        sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
    }
});

// Close sidebar when window is resized to desktop
window.addEventListener('resize', function() {
    const sidebar = document.querySelector('.sidebar');
    if (window.innerWidth > 768) {
        sidebar.classList.remove('open');
    }
});

// Initialize admin when DOM is loaded
// Test API function
window.testAPI = async function() {
    try {
        console.log('Testing API connection...');
        const response = await fetch('https://holwert-backend.vercel.app/api/health');
        const data = await response.json();
        console.log('API Test Result:', data);
        alert('API Test: ' + JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('API Test Error:', error);
        alert('API Test Error: ' + error.message);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('=== DOM LOADED ===');
    console.log('Creating HolwertAdmin instance...');
    console.log('HolwertAdmin class exists:', typeof HolwertAdmin);
    try {
        window.admin = new HolwertAdmin();
        console.log('HolwertAdmin created successfully');
    } catch (error) {
        console.error('Error creating HolwertAdmin:', error);
        console.error('Error stack:', error.stack);
    }
});

// Add notification styles
const notificationStyles = `
    .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        min-width: 300px;
        max-width: 500px;
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideIn 0.3s ease-out;
    }

    .notification-success {
        background: #d4edda;
        border: 1px solid #c3e6cb;
        color: #155724;
    }

    .notification-error {
        background: #f8d7da;
        border: 1px solid #f5c6cb;
        color: #721c24;
    }

    .notification-info {
        background: #d1ecf1;
        border: 1px solid #bee5eb;
        color: #0c5460;
    }

    .notification-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .notification-close {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        margin-left: 10px;
    }

    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;

// Add styles to head
const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);
