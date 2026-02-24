console.log('=== SCRIPT LOADED - VERSION 2024-12-27-20:00 ===');

class HolwertAdmin {
    constructor() {
        // Use production API if available, otherwise localhost
        this.apiBaseUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000/api'
            : 'https://holwert-backend.vercel.app/api';
        this.token = localStorage.getItem('authToken');
        this.currentUser = null;
        this.usersTab = 'dorpsbewoners'; // 'dorpsbewoners' | 'organisaties'
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
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

        // Add Event button (forceert modal direct, ook als fetch traag is)
        const addEventBtn = document.getElementById('addEventBtn');
        if (addEventBtn) {
            addEventBtn.addEventListener('click', async () => {
                console.log('[Events] Nieuw event klik');
                try {
                    await this.openEventEditor(null);
                } catch (e) {
                    console.error('[Events] Fout bij openen event-modal:', e);
                    this.showNotification('Fout bij openen event-modal: ' + (e?.message || e), 'error');
                }
            });
        }

        // Add Practical Info button
        const addPracticalBtn = document.getElementById('addPracticalBtn');
        if (addPracticalBtn) {
            addPracticalBtn.addEventListener('click', () => {
                this.showPracticalModal(null);
            });
        }

        // Users section tabs (Dorpsbewoners / Organisaties)
        document.querySelectorAll('.users-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const t = e.currentTarget.getAttribute('data-users-tab');
                this.usersTab = t;
                document.querySelectorAll('.users-tab').forEach(el => el.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const addUserBtn = document.getElementById('addUserBtn');
                if (addUserBtn) {
                    if (t === 'organisaties') {
                        addUserBtn.innerHTML = '<i class="fas fa-plus"></i> Nieuwe Organisatie';
                    } else {
                        addUserBtn.innerHTML = '<i class="fas fa-plus"></i> Nieuwe Gebruiker';
                    }
                }
                this.loadUsersSectionData();
            });
        });

        // Add User button - gedrag afhankelijk van actieve tab
        const addUserBtn = document.getElementById('addUserBtn');
        if (addUserBtn) {
            addUserBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.usersTab === 'organisaties') {
                    this.showCreateOrganizationModal();
                } else {
                    this.showCreateUserModal();
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
        
        console.log('=== END SHOW MAIN SCREEN ===');
    }

    async handleLogin() {
        console.log('=== LOGIN START ===');
        
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
                this.currentUser = data.user;
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
                    this.showMainScreen();
                }, 1000);
            } else {
                console.log('Login failed:', data);
                if (errorDiv) {
                    errorDiv.innerHTML = data.message || 'Inloggen mislukt';
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
            if (span) span.textContent = 'Inloggen';
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
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('authToken');
        this.showLoginScreen();
    }

    showSection(sectionName) {
        console.log('=== SHOW SECTION ===');
        console.log('Section name:', sectionName);
        // Skip pending load als we naar events gaan (scheelt wachttijd)
        this.skipPending = sectionName === 'events';
        
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
                this.loadUsersSectionData();
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
            case 'practical':
                this.loadPracticalInfo();
                break;
            case 'content-pages':
                this.loadContentPages();
                break;
            case 'moderation':
                this.loadModeration();
                break;
        }
    }

    async loadDashboard() {
        try {
            console.log('=== LOADING DASHBOARD ===');
            this.showLoader('dashboard', 'Dashboard laden...');

            // Eén request: stats + moderation counts (sneller dan stats + 3 aparte calls)
            const res = await fetch(`${this.apiBaseUrl}/admin/dashboard`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (res.ok) {
                const data = await res.json();
                const stats = data.stats || {};
                const mod = data.moderation || {};
                const totalUsersEl = document.getElementById('totalUsers');
                const totalOrgsEl = document.getElementById('totalOrganizations');
                const totalNewsEl = document.getElementById('totalNews');
                const totalEventsEl = document.getElementById('totalEvents');
                if (totalUsersEl) totalUsersEl.textContent = stats.users ?? 0;
                if (totalOrgsEl) totalOrgsEl.textContent = stats.organizations ?? 0;
                if (totalNewsEl) totalNewsEl.textContent = stats.news ?? 0;
                if (totalEventsEl) totalEventsEl.textContent = stats.events ?? 0;
                this.updateNotificationBadge('moderation', mod.count ?? 0);
                this.updateNotificationBadge('organizations', mod.organizations ?? 0);
                this.updateNotificationBadge('events', mod.events ?? 0);
            } else {
                const fallback = await this.loadDashboardFallback();
                if (!fallback) {
                    console.error('Dashboard load failed:', res.status);
                }
            }

            this.loadRecentActivity();
            this.hideLoader('dashboard');
        } catch (error) {
            console.error('Error loading dashboard:', error);
            const fallback = await this.loadDashboardFallback();
            this.hideLoader('dashboard');
        }
    }

    async loadDashboardFallback() {
        try {
            const [statsRes, modRes] = await Promise.all([
                fetch(`${this.apiBaseUrl}/admin/stats`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
                fetch(`${this.apiBaseUrl}/admin/moderation/count`, { headers: { 'Authorization': `Bearer ${this.token}` } })
            ]);
            if (statsRes.ok) {
                const statsData = await statsRes.json();
                const totalUsersEl = document.getElementById('totalUsers');
                const totalOrgsEl = document.getElementById('totalOrganizations');
                const totalNewsEl = document.getElementById('totalNews');
                const totalEventsEl = document.getElementById('totalEvents');
                if (totalUsersEl) totalUsersEl.textContent = statsData.users ?? 0;
                if (totalOrgsEl) totalOrgsEl.textContent = statsData.organizations ?? 0;
                if (totalNewsEl) totalNewsEl.textContent = statsData.news ?? 0;
                if (totalEventsEl) totalEventsEl.textContent = statsData.events ?? 0;
            }
            if (modRes.ok) {
                const mod = await modRes.json();
                this.updateNotificationBadge('moderation', mod.count ?? 0);
                this.updateNotificationBadge('organizations', mod.organizations ?? 0);
                this.updateNotificationBadge('events', mod.events ?? 0);
            }
            return true;
        } catch (e) {
            return false;
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
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (response.ok) {
                const data = await response.json();
                return data.count || 0;
            }
        } catch (error) {
            console.error('Error getting moderation count:', error);
        }
        // Fallback: return 0 if endpoint doesn't exist
        return 0;
    }

    async getPendingOrganizationsCount() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations?status=pending`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (response.ok) {
                const data = await response.json();
                return data.length || 0;
            }
        } catch (error) {
            console.error('Error getting pending organizations count:', error);
        }
        // Fallback: return 0 if endpoint doesn't exist or fails
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

        // Voeg nieuwe badge toe als count > 0
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'notification-badge';
            badge.textContent = count > 99 ? '99+' : count.toString();
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
            'news': 'newspaper',
            'event': 'calendar',
            'found_lost': 'search'
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

    // Content moderation functions
    async approveContent(type, id) {
        try {
            console.log(`Approving ${type} with id ${id}`);
            
            const response = await fetch(`${this.apiBaseUrl}/admin/approve/${type}/${id}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const result = await response.json();
                this.showNotification(result.message, 'success');
                this.loadDashboard(); // Refresh dashboard
                this.loadPendingContent(); // Refresh pending content
                this.loadNotificationCounts(); // Refresh notification badges
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Fout bij goedkeuren', 'error');
            }
        } catch (error) {
            console.error('Error approving content:', error);
            this.showNotification('Verbindingsfout bij goedkeuren', 'error');
        }
    }

    async rejectContent(type, id) {
        try {
            console.log(`Rejecting ${type} with id ${id}`);
            
            if (!confirm('Weet je zeker dat je deze content wilt afwijzen? Deze actie kan niet ongedaan worden gemaakt.')) {
                return;
            }
            
            const response = await fetch(`${this.apiBaseUrl}/admin/reject/${type}/${id}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const result = await response.json();
                this.showNotification(result.message, 'success');
                this.loadDashboard(); // Refresh dashboard
                this.loadPendingContent(); // Refresh pending content
                this.loadNotificationCounts(); // Refresh notification badges
            } else {
                const error = await response.json();
                this.showNotification(error.message || 'Fout bij afwijzen', 'error');
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

    // Users section: laad dorpsbewoners of organisaties afhankelijk van actieve tab
    loadUsersSectionData() {
        if (this.usersTab === 'organisaties') {
            this.loadOrganizationsIntoUsersSection();
        } else {
            this.loadUsers('user');
        }
    }

    // User management
    async loadUsers(roleFilter = null) {
        try {
            console.log('Loading users...', roleFilter ? `(role=${roleFilter})` : '');
            this.showLoader('usersContent', 'Gebruikers laden...');
            const url = roleFilter
                ? `${this.apiBaseUrl}/admin/users?role=${encodeURIComponent(roleFilter)}`
                : `${this.apiBaseUrl}/admin/users`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Users loaded:', data);
                this.displayUsers(data.users);
            } else {
                console.error('Failed to load users:', response.status);
                const error = await response.json();
                console.error('Error:', error);
            }
            this.hideLoader('usersContent');
        } catch (error) {
            console.error('Error loading users:', error);
            this.hideLoader('usersContent');
        }
    }

    displayUsers(users) {
        const container = document.getElementById('usersContent');
        if (!container) return;

        if (users.length === 0) {
            container.innerHTML = '<p class="text-muted">Geen gebruikers gevonden</p>';
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
                                    <span class="role-badge role-${user.role}" onclick="admin.changeUserRole(${user.id}, '${user.role}')" style="cursor: pointer;" title="Klik om rol te wijzigen">
                                        ${user.role}
                                    </span>
                                </td>
                                <td>
                                    <span class="status-badge status-${user.is_active ? 'active' : 'inactive'}" onclick="admin.toggleUserStatus(${user.id}, ${user.is_active})" style="cursor: pointer;" title="Klik om status te wijzigen">
                                        ${user.is_active ? 'Actief' : 'Inactief'}
                                    </span>
                                </td>
                                <td>
                                    <div class="action-buttons">
                                        <button class="btn-icon btn-view" onclick="admin.viewUser(${user.id})" title="Bekijk volledig profiel">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                        <button class="btn-icon btn-edit" onclick="admin.editUser(${user.id})" title="Bewerken">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn-icon btn-delete" onclick="admin.deleteUser(${user.id})" title="Verwijderen">
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
                                    <span class="role-badge role-${user.role}" onclick="admin.changeUserRole(${user.id}, '${user.role}')" style="cursor: pointer;" title="Klik om rol te wijzigen">
                                        ${user.role}
                                    </span>
                                    <span class="status-badge status-${user.is_active ? 'active' : 'inactive'}" onclick="admin.toggleUserStatus(${user.id}, ${user.is_active})" style="cursor: pointer;" title="Klik om status te wijzigen">
                                        ${user.is_active ? 'Actief' : 'Inactief'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="user-card-actions">
                            <button class="btn-icon btn-view" onclick="admin.viewUser(${user.id})" title="Bekijk volledig profiel">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-icon btn-edit" onclick="admin.editUser(${user.id})" title="Bewerken">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-icon btn-delete" onclick="admin.deleteUser(${user.id})" title="Verwijderen">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Organization management
    async loadOrganizationsIntoUsersSection() {
        try {
            this.showLoader('usersContent', 'Organisaties laden...');
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (response.ok) {
                const data = await response.json();
                this.displayOrganizationsInUsersContent(data.organizations || []);
            } else {
                document.getElementById('usersContent').innerHTML =
                    '<p class="text-muted">Kon organisaties niet laden.</p>';
            }
        } catch (error) {
            document.getElementById('usersContent').innerHTML =
                `<p class="text-muted">Fout: ${error.message}</p>`;
        }
        this.hideLoader('usersContent');
    }

    displayOrganizationsInUsersContent(organizations) {
        const container = document.getElementById('usersContent');
        if (!container) return;
        if (!organizations || organizations.length === 0) {
            container.innerHTML = '<p class="text-muted">Geen organisaties gevonden</p>';
            return;
        }
        container.innerHTML = `
            <div class="data-table-container desktop-view">
                <table class="data-table">
                    <thead><tr>
                        <th>Naam</th><th>Categorie</th><th>Status</th><th>Acties</th>
                    </tr></thead>
                    <tbody>
                        ${organizations.map(org => `
                            <tr>
                                <td><strong>${org.name || '-'}</strong></td>
                                <td>${org.category || '-'}</td>
                                <td><span class="status-badge ${org.is_approved ? 'status-published' : 'status-draft'}">
                                    ${org.is_approved ? 'Goedgekeurd' : 'Niet goedgekeurd'}</span></td>
                                <td>
                                    <button class="btn-icon btn-view" onclick="admin.viewOrganization(${org.id})"><i class="fas fa-eye"></i></button>
                                    <button class="btn-icon btn-edit" onclick="admin.editOrganization(${org.id})"><i class="fas fa-edit"></i></button>
                                    <button class="btn-icon btn-delete" onclick="admin.deleteOrganization(${org.id})"><i class="fas fa-trash"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    displayOrganizations(organizations) {
        const container = document.getElementById('organizationsTableBody');
        if (!container) {
            console.error('organizationsTableBody container not found');
            return;
        }

        if (!organizations || organizations.length === 0) {
            container.innerHTML = '<tr><td colspan="5" class="empty-message">Geen organisaties gevonden</td></tr>';
            return;
        }

        container.innerHTML = organizations.map(org => `
            <tr>
                <td>${org.name || '-'}</td>
                <td>${org.category || 'Geen categorie'}</td>
                <td>${org.user_count || 0}</td>
                <td>
                    <span class="status-badge ${org.is_approved ? 'status-published' : 'status-draft'}">
                        ${org.is_approved ? 'Goedgekeurd' : 'Niet goedgekeurd'}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-view" onclick="admin.viewOrganization(${org.id})" title="Bekijken">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon btn-edit" onclick="admin.editOrganization(${org.id})" title="Bewerken">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon btn-delete" onclick="admin.deleteOrganization(${org.id})" title="Verwijderen">
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
            
            // Show loader
            this.showLoader('organizationsTableBody', 'Organisaties laden...');
            
            // Add cache-busting timestamp to ensure fresh data
            const timestamp = new Date().getTime();
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations?t=${timestamp}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Cache-Control': 'no-cache'
                }
            });

            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);

            if (response.ok) {
                const data = await response.json();
                console.log('Organizations data:', data);
                console.log('Organizations count:', data.organizations ? data.organizations.length : 0);
                
                if (data.organizations && data.organizations.length > 0) {
                    this.displayOrganizations(data.organizations);
                } else {
                    console.log('No organizations found in response');
                    const container = document.getElementById('organizationsTableBody');
                    if (container) {
                        container.innerHTML = '<tr><td colspan="5" class="empty-message">Geen organisaties gevonden</td></tr>';
                    }
                }
                
                // Hide loader
                this.hideLoader('organizationsTableBody');
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
                
                // Hide loader
                this.hideLoader('organizationsTableBody');
            }
        } catch (error) {
            console.error('Error loading organizations:', error);
            this.showNotification(`Fout bij laden organisaties: ${error.message}`, 'error');
            
            const container = document.getElementById('organizationsTableBody');
            if (container) {
                container.innerHTML = `<tr><td colspan="5" class="empty-message">Fout: ${error.message}</td></tr>`;
            }
            
            // Hide loader
            this.hideLoader('organizationsTableBody');
        }
    }

    showCreateOrganizationModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-content large">
                <div class="modal-header">
                    <h3>Nieuwe Organisatie</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="organizationForm" class="event-form">
                        <div class="form-group">
                            <label for="orgName">Naam *</label>
                            <input type="text" id="orgName" name="name" placeholder="Naam van de organisatie" required>
                        </div>

                        <div class="form-group">
                            <label for="orgCategory">Categorie</label>
                            <select id="orgCategory" name="category">
                                <option value="gemeente">Gemeente</option>
                                <option value="natuur">Natuur</option>
                                <option value="cultuur">Cultuur</option>
                                <option value="sport">Sport</option>
                                <option value="onderwijs">Onderwijs</option>
                                <option value="overig">Overig</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="orgDescription">Beschrijving</label>
                            <textarea id="orgDescription" name="description" rows="4" placeholder="Korte beschrijving..."></textarea>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label for="orgEmail">Email</label>
                                <input type="email" id="orgEmail" name="contact_email" placeholder="contact@organisatie.nl">
                            </div>
                            <div class="form-group">
                                <label for="orgPhone">Telefoon</label>
                                <input type="tel" id="orgPhone" name="contact_phone" placeholder="0123-456789">
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="orgWebsite">Website</label>
                            <input type="url" id="orgWebsite" name="website" placeholder="https://...">
                        </div>

                        <div class="form-group">
                            <label for="orgBrandColor">Brand Kleur</label>
                            <input type="color" id="orgBrandColor" name="brand_color" value="#3B82F6">
                        </div>

                        <div class="form-group">
                            <label for="orgLogo">Logo</label>
                            <input type="file" id="orgLogo" accept="image/*" class="file-input" onchange="admin.previewOrgImage(this)">
                            <small class="form-hint">Vierkante afbeelding werkt het best (bijv. 512x512px)</small>
                            <div id="orgImagePreview" class="image-preview" style="display: none;">
                                <img id="orgImagePreviewImg" src="" alt="Preview">
                                <button type="button" class="btn-remove-image" onclick="admin.clearOrgImage()">
                                    <i class="fas fa-times"></i> Verwijder
                                </button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="orgApproved" name="is_approved" checked>
                                <span>Direct goedkeuren</span>
                            </label>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                        Annuleren
                    </button>
                    <button class="btn btn-primary" onclick="admin.saveOrganization()">
                        Opslaan
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        // Activeer juiste icoon-knop op basis van huidige waarde
        const initialIcon = isEdit && item && item.icon ? item.icon : 'information-circle-outline';
        this.setPracticalIcon(initialIcon);
    }

    async saveOrganization() {
        // Disable save button to prevent double clicks
        const buttonStates = this.disableSaveButton('Opslaan...');
        
        try {
            const name = document.getElementById('orgName').value.trim();
            const category = document.getElementById('orgCategory').value;
            const description = document.getElementById('orgDescription').value.trim();
            const bio = document.getElementById('orgBio')?.value.trim();
            const email = document.getElementById('orgEmail').value.trim();
            const phone = document.getElementById('orgPhone').value.trim();
            const whatsapp = document.getElementById('orgWhatsapp')?.value.trim();
            const address = document.getElementById('orgAddress')?.value.trim();
            const website = document.getElementById('orgWebsite').value.trim();
            const facebook = document.getElementById('orgFacebook')?.value.trim();
            const instagram = document.getElementById('orgInstagram')?.value.trim();
            const twitter = document.getElementById('orgTwitter')?.value.trim();
            const linkedin = document.getElementById('orgLinkedin')?.value.trim();
            const brand_color = document.getElementById('orgBrandColor').value;
            const is_approved = document.getElementById('orgApproved').checked;
            const privacyEl = document.getElementById('orgPrivacy');
            const privacy_statement = privacyEl && 'value' in privacyEl ? privacyEl.value : '';

            if (!name) {
                this.showNotification('Naam is verplicht', 'error');
                return;
            }

            // Handle logo upload
            const uploadedFile = document.getElementById('orgLogo')?.files[0];
            let logoUrl = null;

            if (uploadedFile) {
                try {
                    // Show loader during image compression
                    this.showLoader(null, 'Logo verwerken...');
                    const compressedBase64 = await this.compressOrgImage(uploadedFile);
                    console.log('Logo compressed (temp base64), length:', compressedBase64.length);

                    if (compressedBase64.length > 4 * 1024 * 1024) {
                        this.hideLoader();
                        this.enableSaveButton(buttonStates);
                        this.showNotification('Logo is te groot. Kies een kleinere afbeelding.', 'error');
                        return;
                    }

                    this.showLoader(null, 'Logo uploaden...');
                    logoUrl = await this.uploadBase64ToBackend(compressedBase64, `org-logo-${Date.now()}.jpg`, null);
                } catch (error) {
                    console.error('Error processing logo:', error);
                    this.hideLoader();
                    this.enableSaveButton(buttonStates);
                    this.showNotification('Fout bij verwerken van logo', 'error');
                    return;
                }
            }

            const body = {
                name,
                category: category || null,
                description: description || null,
                bio: bio || null,
                email: email || null,
                phone: phone || null,
                whatsapp: whatsapp || null,
                address: address || null,
                website: website || null,
                facebook: facebook || null,
                instagram: instagram || null,
                twitter: twitter || null,
                linkedin: linkedin || null,
                brand_color,
                logo_url: logoUrl,
                is_approved
            };

            console.log('[saveOrganization] Sending POST request to:', `${this.apiBaseUrl}/admin/organizations`);
            console.log('[saveOrganization] Request body:', JSON.stringify(body).substring(0, 200));
            
            // Show loader (or update if already showing from logo compression)
            this.showLoader(null, 'Organisatie opslaan...');
            
            const res = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(body)
            });

            console.log('[saveOrganization] Response status:', res.status);
            console.log('[saveOrganization] Response ok:', res.ok);
            
            // Parse response once
            const responseData = await res.json();
            console.log('[saveOrganization] Response data:', responseData);
            
            if (!res.ok) {
                console.error('[saveOrganization] Error response:', responseData);
                this.hideLoader();
                this.enableSaveButton(buttonStates);
                this.showNotification(`Opslaan mislukt: ${responseData.error || responseData.message || 'Onbekende fout'}`, 'error');
                return;
            }

            console.log('[saveOrganization] Success! Organization created:', responseData.organization?.id);
            
            this.hideLoader();
            this.showNotification('Organisatie succesvol aangemaakt', 'success');
            
            // Close modal after short delay
            setTimeout(() => {
                document.querySelector('.modal-overlay')?.remove();
            }, 500);
            
            // Reload organizations list
            await this.loadOrganizations();
            if (document.getElementById('users')?.classList.contains('active') && this.usersTab === 'organisaties') {
                this.loadOrganizationsIntoUsersSection();
            }
        } catch (e) {
            console.error('saveOrganization error:', e);
            this.hideLoader();
            this.enableSaveButton(buttonStates);
            this.showNotification(`Fout bij opslaan: ${e.message}`, 'error');
        }
    }

    async viewOrganization(id) {
        try {
            console.log('👁️ viewOrganization called with ID:', id);
            this.showLoader(null, 'Organisatie laden...');
            const res = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            console.log('Response status:', res.status, res.ok);

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                console.error('Failed to load organization:', errorData);
                this.hideLoader();
                this.showNotification(`Kon organisatie niet laden: ${errorData.error || errorData.message || res.statusText}`, 'error');
                return;
            }

            const data = await res.json();
            console.log('Organization data received:', data);
            const org = data.organization || data;
            this.hideLoader();

            // Verwijder eventuele bestaande modals om stacking te voorkomen
            document.querySelectorAll('.modal-overlay').forEach(el => el.remove());

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            // Forceer zichtbaarheid en positionering (soms stond hij onzichtbaar)
            Object.assign(overlay.style, {
                position: 'fixed',
                inset: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.35)',
                zIndex: '9999'
            });
            overlay.style.display = 'flex';
            overlay.innerHTML = `
                <div class="modal-content large">
                    <div class="modal-header">
                        <h3>Organisatie Details</h3>
                        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="preview-content">
                            ${org.logo_url ? `<div class="preview-image"><img src="${org.logo_url}" alt="${org.name}"></div>` : ''}
                            <h2>${org.name || '-'}</h2>
                            <p><strong>Categorie:</strong> ${org.category || '-'}</p>
                            ${org.description ? `<p><strong>Beschrijving:</strong> ${org.description}</p>` : ''}
                            ${org.bio ? `<p><strong>Bio:</strong> ${org.bio}</p>` : ''}
                            ${org.email ? `<p><strong>Email:</strong> <a href="mailto:${org.email}">${org.email}</a></p>` : ''}
                            ${org.phone ? `<p><strong>Telefoon:</strong> <a href="tel:${org.phone}">${org.phone}</a></p>` : ''}
                            ${org.whatsapp ? `<p><strong>WhatsApp:</strong> <a href="https://wa.me/${org.whatsapp.replace(/\D/g, '')}">${org.whatsapp}</a></p>` : ''}
                            ${org.website ? `<p><strong>Website:</strong> <a href="${org.website}" target="_blank">${org.website}</a></p>` : ''}
                            ${org.address ? `<p><strong>Adres:</strong> ${org.address}</p>` : ''}
                            ${org.facebook || org.instagram || org.twitter || org.linkedin ? `
                                <p><strong>Social Media:</strong><br>
                                ${org.facebook ? `<a href="${org.facebook}" target="_blank"><i class="fab fa-facebook"></i> Facebook</a><br>` : ''}
                                ${org.instagram ? `<a href="${org.instagram}" target="_blank"><i class="fab fa-instagram"></i> Instagram</a><br>` : ''}
                                ${org.twitter ? `<a href="${org.twitter}" target="_blank"><i class="fab fa-twitter"></i> Twitter</a><br>` : ''}
                                ${org.linkedin ? `<a href="${org.linkedin}" target="_blank"><i class="fab fa-linkedin"></i> LinkedIn</a>` : ''}
                                </p>
                            ` : ''}
                            <p><strong>Brand Kleur:</strong> <span style="display:inline-block;width:20px;height:20px;background:${org.brand_color || '#3B82F6'};border:1px solid #ccc;border-radius:3px;"></span> ${org.brand_color || '#3B82F6'}</p>
                            <p><strong>Status:</strong> ${org.is_approved ? '<span class="status-badge status-published">Goedgekeurd</span>' : '<span class="status-badge status-draft">Niet goedgekeurd</span>'}</p>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                            Sluiten
                        </button>
                        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove(); admin.editOrganization(${id})">
                            Bewerken
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            console.log('[Events] Modal overlay added to DOM, mode:', mode);

            // (Nieuw) Laad organisaties asynchroon zodra modal er is, zodat dropdown gevuld wordt
            if (mode !== 'view') {
                try {
                    // Gebruik proxy endpoint voor snelheid
                    const orgRes = await fetch(`https://holwert.appenvloed.com/admin/db-proxy.php`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': 'holwert-db-proxy-2026-secure-key-change-in-production'
                        },
                        body: JSON.stringify({
                            action: 'execute',
                            query: 'SELECT id, name FROM organizations ORDER BY name ASC'
                        })
                    });
                    if (orgRes.ok) {
                        const orgData = await orgRes.json();
                        organizations = orgData.rows || [];
                        console.log('Organizations loaded (proxy, async):', organizations.length);
                        const orgSelect = overlay.querySelector('#evOrg');
                        if (orgSelect) {
                            const opts = ['<option value="">Geen organisatie</option>'].concat(
                                organizations.map(org => `<option value="${org.id}">${org.name || `Organisatie ${org.id}`}</option>`)
                            );
                            orgSelect.innerHTML = opts.join('');
                            // Re-select eerdere keuze
                            if (initial.organization_id) {
                                orgSelect.value = initial.organization_id;
                            }
                        }
                    } else {
                        const errorText = await orgRes.text();
                        console.warn('Failed to load organizations via proxy:', orgRes.status, errorText);
                        this.showNotification('Organisaties konden niet worden geladen. Je kunt nog steeds een event aanmaken.', 'warning');
                    }
                } catch (err) {
                    console.warn('Error loading organizations (proxy, async, continuing anyway):', err);
                }
            }
        } catch (e) {
            console.error('viewOrganization error:', e);
            this.hideLoader();
            this.showNotification('Fout bij laden organisatie', 'error');
        }
    }

    async editOrganization(id) {
        try {
            // Fetch organization details
            this.showLoader(null, 'Organisatiegegevens laden...');
            const res = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!res.ok) {
                this.hideLoader();
                this.showNotification('Kon organisatie niet laden', 'error');
                return;
            }

            const data = await res.json();
            const org = data.organization || data;

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            overlay.innerHTML = `
                <div class="modal-content large">
                    <div class="modal-header">
                        <h3>Organisatie Bewerken</h3>
                        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="organizationForm" class="event-form">
                            <div class="form-group">
                                <label for="orgName">Naam *</label>
                                <input type="text" id="orgName" name="name" value="${org.name || ''}" required>
                            </div>

                            <div class="form-group">
                                <label for="orgCategory">Categorie</label>
                                <select id="orgCategory" name="category">
                                    ${['gemeente', 'natuur', 'cultuur', 'sport', 'onderwijs', 'zorg', 'overig'].map(cat => `
                                        <option value="${cat}" ${cat === (org.category || 'overig') ? 'selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="form-group">
                                <label for="orgDescription">Korte Beschrijving</label>
                                <textarea id="orgDescription" name="description" rows="3" placeholder="Korte beschrijving van de organisatie">${org.description || ''}</textarea>
                            </div>

                            <div class="form-group">
                                <label for="orgBio">Volledige Beschrijving (Bio)</label>
                                <textarea id="orgBio" name="bio" rows="5" placeholder="Uitgebreide beschrijving of missie">${org.bio || ''}</textarea>
                            </div>

                            <div class="form-group">
                                <label for="orgWebsite">Website URL</label>
                                <input type="url" id="orgWebsite" name="website" value="${org.website || ''}" placeholder="https://www.voorbeeld.nl">
                            </div>

                            <div class="form-group">
                                <label for="orgEmail">Contact E-mail</label>
                                <input type="email" id="orgEmail" name="email" value="${org.email || ''}" placeholder="info@voorbeeld.nl">
                            </div>

                            <div class="form-group">
                                <label for="orgPhone">Telefoonnummer</label>
                                <input type="tel" id="orgPhone" name="phone" value="${org.phone || ''}" placeholder="+31 6 12345678">
                            </div>

                            <div class="form-group">
                                <label for="orgWhatsapp">WhatsApp Nummer</label>
                                <input type="tel" id="orgWhatsapp" name="whatsapp" value="${org.whatsapp || ''}" placeholder="+31 6 12345678">
                            </div>

                            <div class="form-group">
                                <label for="orgAddress">Adres</label>
                                <input type="text" id="orgAddress" name="address" value="${org.address || ''}" placeholder="Straatnaam 123, 1234 AB Plaats">
                            </div>

                            <div class="form-group">
                                <label for="orgFacebook">Facebook URL</label>
                                <input type="url" id="orgFacebook" name="facebook" value="${org.facebook || ''}" placeholder="https://facebook.com/voorbeeld">
                            </div>

                            <div class="form-group">
                                <label for="orgInstagram">Instagram URL</label>
                                <input type="url" id="orgInstagram" name="instagram" value="${org.instagram || ''}" placeholder="https://instagram.com/voorbeeld">
                            </div>

                            <div class="form-group">
                                <label for="orgTwitter">Twitter URL</label>
                                <input type="url" id="orgTwitter" name="twitter" value="${org.twitter || ''}" placeholder="https://twitter.com/voorbeeld">
                            </div>

                            <div class="form-group">
                                <label for="orgLinkedin">LinkedIn URL</label>
                                <input type="url" id="orgLinkedin" name="linkedin" value="${org.linkedin || ''}" placeholder="https://linkedin.com/company/voorbeeld">
                            </div>

                            <div class="form-group">
                                <label for="orgBrandColor">Merk Kleur (Hex)</label>
                                <input type="color" id="orgBrandColor" name="brand_color" value="${org.brand_color || '#3B82F6'}">
                            </div>

                            <div class="form-group">
                                <label for="orgLogo">Logo</label>
                                <input type="file" id="orgLogo" accept="image/*" class="file-input" onchange="admin.previewOrgImage(this)">
                                <small class="form-hint">Of laat leeg om huidige logo te behouden</small>
                                <div id="orgImagePreview" class="image-preview" style="display: ${org.logo_url ? 'block' : 'none'};">
                                    <img id="orgImagePreviewImg" src="${org.logo_url || ''}" alt="Logo Preview">
                                    <button type="button" class="btn-remove-image" onclick="admin.clearOrgImage()">
                                        <i class="fas fa-times"></i> Verwijder
                                    </button>
                                </div>
                            </div>

                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="orgApproved" name="is_approved" ${org.is_approved !== false ? 'checked' : ''}>
                                    <span>Goedgekeurd (toon in app)</span>
                                </label>
                                <small class="form-hint">Uitvinken om als concept op te slaan</small>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                            Annuleren
                        </button>
                        <button class="btn btn-primary" onclick="admin.updateOrganization(${id})">
                            Bijwerken
                        </button>
                    </div>
                </div>
            `;
            this.hideLoader();
            document.body.appendChild(overlay);
        } catch (e) {
            console.error('editOrganization error:', e);
            this.hideLoader();
            this.showNotification('Fout bij laden organisatie', 'error');
        }
    }

    async updateOrganization(id) {
        // Disable save button to prevent double clicks
        const buttonStates = this.disableSaveButton('Bijwerken...');
        
        try {
            const name = document.getElementById('orgName').value.trim();
            const category = document.getElementById('orgCategory').value;
            const description = document.getElementById('orgDescription').value.trim();
            const bio = document.getElementById('orgBio')?.value.trim();
            const email = document.getElementById('orgEmail').value.trim();
            const phone = document.getElementById('orgPhone').value.trim();
            const whatsapp = document.getElementById('orgWhatsapp')?.value.trim();
            const address = document.getElementById('orgAddress')?.value.trim();
            const website = document.getElementById('orgWebsite').value.trim();
            const facebook = document.getElementById('orgFacebook')?.value.trim();
            const instagram = document.getElementById('orgInstagram')?.value.trim();
            const twitter = document.getElementById('orgTwitter')?.value.trim();
            const linkedin = document.getElementById('orgLinkedin')?.value.trim();
            const brand_color = document.getElementById('orgBrandColor').value;
            const is_approved = document.getElementById('orgApproved').checked;

            if (!name) {
                this.enableSaveButton(buttonStates);
                this.showNotification('Naam is verplicht', 'error');
                return;
            }

            // Handle logo upload
            const uploadedFile = document.getElementById('orgLogo')?.files[0];
            let logoUrl = undefined; // undefined = keep existing

            if (uploadedFile) {
                try {
                    // Show loader during image compression
                    this.showLoader(null, 'Logo verwerken...');
                    const compressedBase64 = await this.compressOrgImage(uploadedFile);
                    console.log('Logo compressed (temp base64), length:', compressedBase64.length);

                    if (compressedBase64.length > 4 * 1024 * 1024) {
                        this.hideLoader();
                        this.enableSaveButton(buttonStates);
                        this.showNotification('Logo is te groot. Kies een kleinere afbeelding.', 'error');
                        return;
                    }

                    this.showLoader(null, 'Logo uploaden...');
                    logoUrl = await this.uploadBase64ToBackend(compressedBase64, `org-logo-${Date.now()}.jpg`, id);
                } catch (error) {
                    console.error('Error processing logo:', error);
                    this.hideLoader();
                    this.enableSaveButton(buttonStates);
                    this.showNotification('Fout bij verwerken van logo', 'error');
                    return;
                }
            }

            const body = {
                name,
                category: category || null,
                description: description || null,
                bio: bio || null,
                email: email || null,
                phone: phone || null,
                whatsapp: whatsapp || null,
                address: address || null,
                website: website || null,
                facebook: facebook || null,
                instagram: instagram || null,
                twitter: twitter || null,
                linkedin: linkedin || null,
                brand_color,
                is_approved,
                privacy_statement: privacy_statement || null
            };

            // Only add logo_url if defined (not undefined)
            if (logoUrl !== undefined) {
                body.logo_url = logoUrl;
            }

            // Show loader during update (or update if already showing from logo compression)
            this.showLoader(null, 'Organisatie bijwerken...');

            const res = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const error = await res.json();
                this.hideLoader();
                this.enableSaveButton(buttonStates);
                this.showNotification(`Bijwerken mislukt: ${error.error || error.message}`, 'error');
                return;
            }

            this.hideLoader();
            this.enableSaveButton(buttonStates);
            this.showNotification('Organisatie succesvol bijgewerkt', 'success');
            setTimeout(() => {
                document.querySelector('.modal-overlay')?.remove();
            }, 500);
            this.loadOrganizations();
        } catch (e) {
            console.error('updateOrganization error:', e);
            this.enableSaveButton(buttonStates);
            this.showNotification(`Fout bij bijwerken: ${e.message}`, 'error');
        }
    }

    async deleteOrganization(id, name) {
        if (!confirm(`Weet je zeker dat je "${name}" wilt verwijderen?\n\nDit kan niet ongedaan worden gemaakt.`)) {
            return;
        }

        try {
            this.showLoader(null, 'Organisatie verwijderen...');
            const res = await fetch(`${this.apiBaseUrl}/admin/organizations/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (!res.ok) {
                const error = await res.json();
                this.hideLoader();
                this.showNotification(`Verwijderen mislukt: ${error.error || error.message}`, 'error');
                return;
            }

            this.hideLoader();
            this.showNotification('Organisatie succesvol verwijderd', 'success');
            this.loadOrganizations();
        } catch (e) {
            console.error('deleteOrganization error:', e);
            this.showNotification(`Fout bij verwijderen: ${e.message}`, 'error');
        }
    }


    // Button state management
    disableSaveButton(buttonText = 'Opslaan...') {
        // Find all save buttons in the current modal
        const modal = document.querySelector('.modal-overlay');
        if (!modal) return null;
        
        const saveButtons = modal.querySelectorAll('button.btn-primary');
        const originalStates = [];
        
        saveButtons.forEach(btn => {
            // Only disable if button text contains "Opslaan" or "Bijwerken"
            const btnText = btn.textContent.trim();
            if (btnText.includes('Opslaan') || btnText.includes('Bijwerken')) {
                originalStates.push({
                    button: btn,
                    originalText: btnText,
                    originalDisabled: btn.disabled
                });
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
                btn.textContent = buttonText;
            }
        });
        
        return originalStates; // Return so we can restore later
    }

    enableSaveButton(originalStates) {
        if (!originalStates) return;
        
        originalStates.forEach(state => {
            state.button.disabled = state.originalDisabled;
            state.button.style.opacity = '';
            state.button.style.cursor = '';
            state.button.textContent = state.originalText;
        });
    }

    // Loader system
    showLoader(containerId = null, message = 'Laden...') {
        // Remove existing loader if any
        this.hideLoader(containerId);
        
        const loader = document.createElement('div');
        loader.className = 'loader-overlay';
        loader.id = containerId ? `loader-${containerId}` : 'global-loader';
        loader.innerHTML = `
            <div class="loader-content">
                <div class="spinner"></div>
                <p class="loader-message">${message}</p>
            </div>
        `;
        
        // Add styles if not already present
        if (!document.getElementById('loader-styles')) {
            const style = document.createElement('style');
            style.id = 'loader-styles';
            style.textContent = `
                .loader-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(255, 255, 255, 0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    backdrop-filter: blur(4px);
                }
                .loader-content {
                    text-align: center;
                }
                .spinner {
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #3B82F6;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 1rem;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .loader-message {
                    color: #334;
                    font-size: 16px;
                    margin: 0;
                }
                .section-loader {
                    position: relative;
                    min-height: 200px;
                }
                .section-loader::after {
                    content: '';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    border: 3px solid #f3f3f3;
                    border-top: 3px solid #3B82F6;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                }
            `;
            document.head.appendChild(style);
        }
        
        // Append to container or body
        if (containerId) {
            const container = document.getElementById(containerId);
            if (container) {
                container.style.position = 'relative';
                container.appendChild(loader);
            } else {
                document.body.appendChild(loader);
            }
        } else {
            document.body.appendChild(loader);
        }
    }

    hideLoader(containerId = null) {
        const loaderId = containerId ? `loader-${containerId}` : 'global-loader';
        const loader = document.getElementById(loaderId);
        if (loader) {
            loader.remove();
        }
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

        // Auto Remove after 5 seconds
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

        let timeoutId;
        try {
            console.log('Loading pending content...');
            this.showLoader('pendingContent', 'Wachtende content laden...');
            
            // Add timeout to prevent hanging (30s i.v.m. proxy-latency)
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconden timeout
            
            const response = await fetch(`${this.apiBaseUrl}/admin/pending`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                console.error('Failed to load pending content:', response.status);
                const errorText = await response.text().catch(() => 'Unknown error');
                console.error('Error response:', errorText);
                container.innerHTML = '<p class="text-muted">Fout bij laden wachtende content</p>';
                return;
            }

            const data = await response.json();
            console.log('Pending content loaded:', data);
            
            // Combine all pending items
            const allPending = [];
            
            // Note: Backend doesn't return users, only organizations, news, and events
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
            
            if (data.news && data.news.length > 0) {
                data.news.forEach(news => {
                    allPending.push({
                        type: 'news',
                        id: news.id,
                        title: news.title,
                        meta: `Nieuws • ${this.formatDate(news.published_at || news.created_at)}`,
                        icon: 'newspaper'
                    });
                });
            }
            
            if (data.events && data.events.length > 0) {
                data.events.forEach(event => {
                    allPending.push({
                        type: 'event',
                        id: event.id,
                        title: event.title,
                        meta: `Evenement • ${this.formatDate(event.created_at)}`,
                        icon: 'calendar'
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
        } catch (error) {
            console.error('Error loading pending content:', error);
            if (error.name === 'AbortError') {
                console.error('Request timeout - took longer than 30 seconds');
                container.innerHTML = '<p class="text-muted">Timeout: Laden duurt te lang. Probeer opnieuw.</p>';
            } else {
                container.innerHTML = '<p class="text-muted">Fout bij laden wachtende content: ' + error.message + '</p>';
            }
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            // Always hide loader, even if something went wrong
            this.hideLoader('pendingContent');
        }
    }

    // Load recent activity
    async loadRecentActivity() {
        const container = document.getElementById('recentActivity');
        if (!container) return;

        try {
            console.log('Loading recent activity...');
            this.showLoader('recentActivity', 'Recente activiteit laden...');
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
                this.hideLoader('recentActivity');
            } else {
                console.log('Failed to load recent activity:', response.status);
                container.innerHTML = '<p class="text-muted">Geen recente activiteit</p>';
                this.hideLoader('recentActivity');
            }
        } catch (error) {
            console.log('Error loading recent activity:', error.message);
            container.innerHTML = '<p class="text-muted">Geen recente activiteit</p>';
            this.hideLoader('recentActivity');
        }
    }

    // ===== NEWS MANAGEMENT =====
    async loadNews() {
        try {
            console.log('🔄 Loading news from:', `${this.apiBaseUrl}/admin/news`);
            const newsContainer = document.getElementById('newsContent') || document.getElementById('newsTableBody');
            const containerId = newsContainer ? newsContainer.id : null;
            this.showLoader(containerId, 'Nieuws laden...');
            
            const response = await fetch(`${this.apiBaseUrl}/admin/news?minimal=1`, {
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
            this.hideLoader(containerId);
        } catch (error) {
            console.error('💥 Error loading news:', error);
            console.error('Error details:', error.message, error.stack);
            this.displayNews([]);
            const newsContainer = document.getElementById('newsContent') || document.getElementById('newsTableBody');
            this.hideLoader(newsContainer ? newsContainer.id : null);
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
                                    <small>${new Date(article.published_at || article.created_at).toLocaleDateString('nl-NL')}</small>
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
                    organizations = data.organizations || [];
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
            
            // Formatteer datum voor input (standaard vandaag)
            const today = new Date().toISOString().split('T')[0];
            const articleDate = article?.created_at || article?.published_at;
            const pubDate = articleDate ? new Date(articleDate).toISOString().split('T')[0] : today;
            const pubTime = articleDate ? new Date(articleDate).toTimeString().slice(0, 5) : '12:00';

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

    // DataURL naar Blob (voor snelle multipart-upload i.p.v. base64 in JSON)
    dataURLtoBlob(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
        const parts = dataUrl.split(',');
        const mime = parts[0].match(/data:image\/([a-z]+);/)?.[1] || 'jpeg';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8 = new Uint8Array(n);
        while (n--) u8[n] = bstr.charCodeAt(n);
        return new Blob([u8], { type: `image/${mime}` });
    }

    // Multipart file-upload naar /api/upload (sneller dan base64 in JSON). Folder: uploads/YYYY/MM/<orgNum>/
    async uploadFileToBackend(blob, filenameHint = 'image.jpg', organizationId = null) {
        if (!blob || !(blob instanceof Blob)) return null;
        const form = new FormData();
        form.append('image', blob, filenameHint);
        if (organizationId != null && organizationId !== '') form.append('organizationId', String(organizationId));
        const res = await fetch(`${this.apiBaseUrl}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.token}` },
            body: form
        });
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { const j = await res.json(); msg = j.message || j.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        return data.url || data.imageUrl || null;
    }

    // Upload afbeelding (gebruikt multipart als dataUrl, anders fallback naar base64 endpoint). organizationId voor map uploads/YYYY/MM/01|07|...
    async uploadBase64ToBackend(dataUrl, filenameHint = 'image.jpg', organizationId = null) {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
        const blob = this.dataURLtoBlob(dataUrl);
        if (blob) return this.uploadFileToBackend(blob, filenameHint, organizationId);
        // Fallback: base64 naar /api/upload/image (zwaarder)
        const res = await fetch(`${this.apiBaseUrl}/upload/image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify({
                imageData: dataUrl,
                filename: filenameHint,
                organizationId: organizationId != null ? String(organizationId) : undefined
            })
        });
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { const j = await res.json(); msg = j.message || j.error || msg; } catch {}
            throw new Error(msg);
        }
        const data = await res.json();
        return data.imageUrl || data.url || null;
    }

    // Organization image functions
    async previewOrgImage(input) {
        const file = input.files[0];
        const preview = document.getElementById('orgImagePreview');
        const img = document.getElementById('orgImagePreviewImg');

        if (file) {
            console.log('Original logo file size:', file.size);
            try {
                const compressedBase64 = await this.compressOrgImage(file);
                img.src = compressedBase64;
                preview.style.display = 'block';
                console.log('Preview logo updated with compressed version.');
            } catch (error) {
                console.error('Error compressing logo for preview:', error);
                // Fallback to original if compression fails
                const reader = new FileReader();
                reader.onload = (e) => {
                    img.src = e.target.result;
                    preview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        } else {
            preview.style.display = 'none';
            img.src = '';
        }
    }

    clearOrgImage() {
        document.getElementById('orgLogo').value = '';
        document.getElementById('orgImagePreview').style.display = 'none';
        document.getElementById('orgImagePreviewImg').src = '';
    }

    async compressOrgImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Voor logos: vierkant maken en max 512px
                    const maxSize = 512;
                    const size = Math.max(width, height);
                    
                    if (size > maxSize) {
                        const scale = maxSize / size;
                        width = Math.round(width * scale);
                        height = Math.round(height * scale);
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Start met quality 0.8 voor logos (iets hoger dan nieuws)
                    let quality = 0.8;
                    let compressed = canvas.toDataURL('image/png', quality); // PNG voor logos (betere kwaliteit)
                    
                    // Als te groot, probeer JPEG met lagere quality
                    const maxBytes = 1 * 1024 * 1024; // 1MB target voor logos
                    if (compressed.length > maxBytes) {
                        quality = 0.7;
                        compressed = canvas.toDataURL('image/jpeg', quality);
                        
                        while (compressed.length > maxBytes && quality > 0.3) {
                            quality -= 0.1;
                            compressed = canvas.toDataURL('image/jpeg', quality);
                        }
                    }
                    
                    console.log('Compressed logo:', {
                        originalSize: file.size,
                        compressedLength: compressed.length,
                        quality: quality.toFixed(1),
                        dimensions: `${width}x${height}`
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
        // Parse newsId correct (kan 'null' string zijn)
        const actualNewsId = newsId && newsId !== 'null' && newsId !== null ? parseInt(newsId) : null;
        
        // Disable save button to prevent double clicks
        const buttonStates = this.disableSaveButton(actualNewsId ? 'Bijwerken...' : 'Opslaan...');
        
        try {
            
            const title = (document.getElementById('newsTitle').value || '').trim();
            const excerpt = (document.getElementById('newsExcerpt').value || '').trim();
            const content = (document.getElementById('newsArticleContent').value || '').trim();
            const category = document.getElementById('newsCategory')?.value;
            const organization_id_val = document.getElementById('newsOrganization')?.value;
            const organization_id = (organization_id_val && organization_id_val !== '' && organization_id_val !== '0') 
                ? parseInt(organization_id_val) 
                : null;
            
            // Haal publicatiedatum op uit formulier
            const pubDate = document.getElementById('newsPubDate')?.value;
            const pubTime = document.getElementById('newsPubTime')?.value || '12:00';
            // Format: YYYY-MM-DD HH:MM:SS voor MySQL
            const published_at = pubDate ? `${pubDate} ${pubTime}:00` : null;
            
            // Handle image upload
            const uploadedFile = document.getElementById('newsImage')?.files[0];
            let imageUrl = null;
            
            if (uploadedFile) {
                try {
                    this.showLoader(null, 'Afbeelding verwerken...');
                    const compressedBase64 = await this.compressNewsImage(uploadedFile);
                    console.log('News image compressed (temp base64), length:', compressedBase64.length);
                    
                    if (compressedBase64.length > 4 * 1024 * 1024) {
                        this.enableSaveButton(buttonStates);
                        this.showNotification('Afbeelding is te groot. Kies een kleinere afbeelding.', 'error');
                        return;
                    }

                    this.showLoader(null, 'Afbeelding uploaden...');
                    imageUrl = await this.uploadBase64ToBackend(compressedBase64, `news-image-${Date.now()}.jpg`, organization_id);
                } catch (error) {
                    console.error('Error processing image:', error);
                    this.enableSaveButton(buttonStates);
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
                this.enableSaveButton(buttonStates);
                this.showNotification(`Vul de volgende verplichte velden in: ${missingFields.join(', ')}`, 'error');
                return;
            }

            const body = {
                title,
                excerpt: excerpt || null,
                content,
                category,
                organization_id,
                is_published: document.getElementById('newsPublished').checked,
                published_at: published_at // Stuur publicatiedatum mee
            };
            
            // Voeg image_url alleen toe als het gedefinieerd is
            if (imageUrl !== undefined) {
                body.image_url = imageUrl;
            }

            const url = actualNewsId ? `${this.apiBaseUrl}/admin/news/${actualNewsId}` : `${this.apiBaseUrl}/news`;
            const method = actualNewsId ? 'PUT' : 'POST';

            console.log('🚀 Sending request:', { url, method, body });
            console.log('🔍 Body keys:', Object.keys(body));
            console.log('❌ published_at in body?', 'published_at' in body);

            this.showLoader(null, actualNewsId ? 'Nieuws bijwerken...' : 'Nieuws opslaan...');

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
                this.hideLoader();
                this.enableSaveButton(buttonStates);
                this.showNotification(`Opslaan mislukt: ${msg}`, 'error');
                return;
            }

            this.hideLoader();
            this.showNotification('Nieuws artikel opgeslagen', 'success');
            
            // Sluit alle modals direct na succes
            document.querySelectorAll('.modal-overlay')?.forEach(el => el.remove());
            
            this.loadNews();
        } catch (e) {
            console.error('saveNews error:', e);
            this.hideLoader();
            this.enableSaveButton(buttonStates);
            this.showNotification(`Fout bij opslaan nieuws: ${e?.message || 'Onbekende fout'}`, 'error');
        }
    }

    async viewNews(newsId) {
        try {
            console.log('🔍 viewNews called with ID:', newsId);
            const response = await fetch(`${this.apiBaseUrl}/admin/news?minimal=1`, {
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
                        <span>${new Date(article.published_at || article.created_at).toLocaleDateString('nl-NL')}</span>
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
            this.showLoader(null, 'Nieuws verwijderen...');
            const response = await fetch(`${this.apiBaseUrl}/admin/news/${newsId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                this.hideLoader();
                this.showNotification('Nieuws artikel verwijderd', 'success');
                this.loadNews();
            } else {
                const error = await response.json();
                this.hideLoader();
                this.showNotification(`Fout bij verwijderen: ${error.message || 'Onbekende fout'}`, 'error');
            }
        } catch (error) {
            console.error('Error deleting news:', error);
            this.hideLoader();
            this.showNotification('Fout bij verwijderen nieuws artikel', 'error');
        }
    }

    async loadEvents() {
        try {
            this.showLoader('eventsContent', 'Evenementen laden...');
            const response = await fetch(`${this.apiBaseUrl}/admin/events`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayEvents(data.events || []);
            } else {
                const container = document.getElementById('eventsContent');
                if (container) container.innerHTML = '<p>Fout bij laden events.</p>';
            }
            this.hideLoader('eventsContent');
        } catch (error) {
            console.error('Error loading events:', error);
            const container = document.getElementById('eventsContent');
            if (container) container.innerHTML = '<p>Fout bij laden events.</p>';
            this.hideLoader('eventsContent');
        }
    }

    // Nieuwe editor (create/edit) voor events, nieuws-stijl
    async openEventEditor(eventId = null) {
        // Verwijder bestaande overlays
        document.querySelectorAll('.modal-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.35)',
            zIndex: '9999'
        });

        // Defaults
        let initial = {
            title: '',
            description: '',
            event_date: '',
            event_end_date: '',
            location: '',
            organization_id: '',
            price: '',
            image_url: ''
        };
        let imageCleared = false;

        // Haal event op via proxy (snel) als we bewerken
        if (eventId) {
            try {
                const res = await fetch(`https://holwert.appenvloed.com/admin/db-proxy.php`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': 'holwert-db-proxy-2026-secure-key-change-in-production'
                    },
                    body: JSON.stringify({
                        action: 'execute',
                        query: `SELECT * FROM events WHERE id = ? LIMIT 1`,
                        params: [eventId]
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const ev = data.rows?.[0];
                    if (ev) {
                        initial = {
                            title: ev.title || '',
                            description: ev.description || '',
                            event_date: ev.event_date ? new Date(ev.event_date).toISOString().slice(0,16) : '',
                            event_end_date: ev.event_end_date ? new Date(ev.event_end_date).toISOString().slice(0,16) : (ev.event_date ? new Date(ev.event_date).toISOString().slice(0,16) : ''),
                            location: ev.location || '',
                            organization_id: ev.organization_id || '',
                            price: ev.price || '',
                            image_url: ev.image_url || ''
                        };
                    } else {
                        this.showNotification('Event niet gevonden', 'error');
                        return;
                    }
                } else {
                    this.showNotification('Fout bij laden event', 'error');
                    return;
                }
            } catch (err) {
                console.error('Error loading event via proxy:', err);
                this.showNotification('Fout bij laden event', 'error');
                return;
            }
        }

        // Modal HTML
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.maxWidth = '720px';
        modal.style.width = '95%';
        modal.innerHTML = `
            <div class="modal-header">
                <h3>${eventId ? 'Evenement bewerken' : 'Nieuw evenement'}</h3>
                <button class="close" aria-label="Sluiten">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form">
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
                        <label>Kosten (optioneel, bijv. 5.00)</label>
                        <input type="number" step="0.01" min="0" id="evPrice" value="${initial.price || ''}" placeholder="Kosten">
                    </div>
                    <div class="form-group">
                        <label>Organisatie (optioneel)</label>
                        <select id="evOrg">
                            <option value="">Geen organisatie</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Afbeelding (optioneel)</label>
                        <input type="file" id="evImage" accept="image/*">
                        <div id="evImagePreview" style="${initial.image_url ? 'display:block' : 'display:none'};margin-top:10px;">
                            <img id="evImagePreviewImg" src="${initial.image_url || ''}" style="max-width:200px;max-height:200px;border-radius:8px;">
                            <button type="button" class="btn btn-sm btn-secondary" id="evImageClear" style="margin-top:5px;">Verwijder afbeelding</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary btn-cancel">Annuleren</button>
                <button class="btn btn-primary btn-save">${eventId ? 'Opslaan' : 'Opslaan'}</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close handlers
        const close = () => overlay.remove();
        modal.querySelector('.close')?.addEventListener('click', close);
        modal.querySelector('.btn-cancel')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        modal.addEventListener('click', (e) => e.stopPropagation());

        // Image preview handlers
        const imgInput = modal.querySelector('#evImage');
        const imgPreview = modal.querySelector('#evImagePreview');
        const imgPreviewImg = modal.querySelector('#evImagePreviewImg');
        const imgClear = modal.querySelector('#evImageClear');
        if (imgInput) {
            imgInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) {
                    imgPreview.style.display = 'none';
                    imgPreviewImg.src = '';
                    return;
                }
                try {
                    const compressedBase64 = await this.compressEventImage(file);
                    imgPreviewImg.src = compressedBase64;
                    imgPreview.style.display = 'block';
                } catch (err) {
                    console.error('Error processing image:', err);
                    this.showNotification('Fout bij verwerken van afbeelding', 'error');
                    imgPreview.style.display = 'none';
                    imgPreviewImg.src = '';
                }
            });
        }
        if (imgClear) {
            imgClear.addEventListener('click', () => {
                if (imgInput) imgInput.value = '';
                imgPreview.style.display = 'none';
                imgPreviewImg.src = '';
                imageCleared = true;
            });
        }

        // Async load organizations via proxy
        const orgSelect = modal.querySelector('#evOrg');
        (async () => {
            try {
                const orgRes = await fetch(`https://holwert.appenvloed.com/admin/db-proxy.php`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': 'holwert-db-proxy-2026-secure-key-change-in-production'
                    },
                    body: JSON.stringify({
                        action: 'execute',
                        query: 'SELECT id, name FROM organizations ORDER BY name ASC'
                    })
                });
                if (orgRes.ok) {
                    const orgData = await orgRes.json();
                    const organizations = orgData.rows || [];
                    if (orgSelect) {
                        const opts = ['<option value="">Geen organisatie</option>'].concat(
                            organizations.map(org => `<option value="${org.id}">${org.name || `Organisatie ${org.id}`}</option>`)
                        );
                        orgSelect.innerHTML = opts.join('');
                        if (initial.organization_id) {
                            orgSelect.value = initial.organization_id;
                        }
                    }
                } else {
                    console.warn('Organizations via proxy mislukt:', orgRes.status);
                }
            } catch (err) {
                console.warn('Organizations via proxy error:', err);
            }
        })();

        // Save handler
        modal.querySelector('.btn-save')?.addEventListener('click', async () => {
            try {
                const saveBtn = modal.querySelector('.btn-save');
                const cancelBtn = modal.querySelector('.btn-cancel');
                if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Opslaan...'; }
                if (cancelBtn) { cancelBtn.disabled = true; }
                this.showLoader(null, 'Evenement opslaan...');

                const title = (modal.querySelector('#evTitle')?.value || '').trim();
                const description = (modal.querySelector('#evDesc')?.value || '').trim();
                const event_date_raw = modal.querySelector('#evStart')?.value;
                const event_end_date_raw = modal.querySelector('#evEnd')?.value;
                const location = (modal.querySelector('#evLocation')?.value || '').trim();
                const orgVal = modal.querySelector('#evOrg')?.value;
                const organization_id = orgVal ? parseInt(orgVal) : null;
                const priceVal = modal.querySelector('#evPrice')?.value;
                const price = priceVal ? parseFloat(priceVal) : null;
                const imgVal = modal.querySelector('#evImagePreviewImg')?.src;
                let image_url = imgVal && imgVal.startsWith('data:image') ? imgVal : (initial.image_url || null);
                if (imageCleared) {
                    image_url = null; // gebruiker heeft afbeelding verwijderd
                }

                if (!title || !description || !event_date_raw || !location) {
                    this.showNotification('Vul alle verplichte velden in', 'error');
                    this.hideLoader();
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Opslaan'; }
                    if (cancelBtn) { cancelBtn.disabled = false; }
                    return;
                }

                const body = {
                    title,
                    description,
                    event_date: new Date(event_date_raw).toISOString(),
                    event_end_date: event_end_date_raw ? new Date(event_end_date_raw).toISOString() : null,
                    location,
                    organization_id,
                    status: 'scheduled',
                    price,
                    image_url
                };

                const url = eventId ? `${this.apiBaseUrl}/admin/events/${eventId}` : `${this.apiBaseUrl}/admin/events`;
                const method = eventId ? 'PUT' : 'POST';

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
                    try { const j = await res.json(); msg = j.message || j.error || msg; } catch {}
                    this.showNotification(`Opslaan mislukt: ${msg}`, 'error');
                } else {
                    this.showNotification('Evenement opgeslagen', 'success');
                    overlay.remove();
                    this.loadEvents();
                    this.loadNotificationCounts();
                }
                this.hideLoader();
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Opslaan'; }
                if (cancelBtn) { cancelBtn.disabled = false; }
            } catch (err) {
                console.error('saveEvent (editor) error:', err);
                this.showNotification('Fout bij opslaan evenement: ' + (err?.message || err), 'error');
                this.hideLoader();
            }
        });

        // Scroll naar top
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
                        <button class="btn-icon btn-edit" onclick="admin.openEventEditor(${ev.id})" title="Bewerken">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon btn-delete" onclick="admin.deleteEvent(${ev.id}, '${(ev.title || '').replace(/'/g, "\\'")}')">
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

    // Legacy view/edit niet meer gebruiken; we werken met openEventEditor
    async viewEvent(id, eventData = null) {
        console.log('viewEvent legacy called, use openEventEditor instead');
    }

    async editEvent(id) {
        console.log('editEvent legacy called, use openEventEditor instead');
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
        console.log('openCreateEventModal legacy called, use openEventEditor(null) instead');
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
        
        // Format dates for input fields
        const startDate = event.event_date ? new Date(event.event_date).toISOString().split('T')[0] : '';
        const startTime = event.event_date ? new Date(event.event_date).toTimeString().slice(0, 5) : '';
        const endDate = event.event_end_date ? new Date(event.event_end_date).toISOString().split('T')[0] : '';
        const endTime = event.event_end_date ? new Date(event.event_end_date).toTimeString().slice(0, 5) : '';
        
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
                document.querySelector('.modal-overlay').remove();
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

        // Disable save button to prevent double clicks
        const buttonStates = this.disableSaveButton('Bijwerken...');

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
            // Show loader during update
            this.showLoader(null, 'Evenement bijwerken...');

            const response = await fetch(`${this.apiBaseUrl}/admin/events/${id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(eventData)
            });

            if (response.ok) {
                this.hideLoader();
                this.enableSaveButton(buttonStates);
                this.showNotification('Evenement succesvol bijgewerkt', 'success');
                setTimeout(() => {
                    document.querySelector('.modal-overlay')?.remove();
                }, 500);
                this.loadEvents(); // Herlaad de lijst
                this.loadNotificationCounts(); // Refresh notification badges
            } else {
                const error = await response.json();
                this.hideLoader();
                this.enableSaveButton(buttonStates);
                this.showNotification(error.message || 'Fout bij bijwerken', 'error');
            }
        } catch (err) {
            console.error('Error updating event:', err);
            this.hideLoader();
            this.enableSaveButton(buttonStates);
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
        document.body.appendChild(modalOverlay);
    }

    async loadPracticalInfo() {
        const container = document.getElementById('practicalItemContent');
        const tbody = document.getElementById('practicalTableBody');
        if (!tbody) return;

        this.showLoader('practicalContent', 'Praktische info laden...');
        try {
            const res = await fetch(`${this.apiBaseUrl}/admin/practical-info`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!res.ok) throw new Error('Server error ' + res.status);
            const data = await res.json();
            const items = data.items || [];

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Nog geen items. Klik "Nieuw item" om te beginnen.</td></tr>';
            } else {
                const typeLabels = { info: 'Info', schedule: 'Schema', link: 'Link', phone: 'Telefoon' };
                tbody.innerHTML = items.map(item => `
                    <tr>
                        <td>${item.sort_order || 0}</td>
                        <td><i class="fas fa-${this.ionToFa(item.icon)}"></i> ${item.icon || '-'}</td>
                        <td>
                            <strong>${this.escapeHtml(item.title)}</strong>
                            ${item.subtitle ? '<br><small class="text-muted">' + this.escapeHtml(item.subtitle) + '</small>' : ''}
                        </td>
                        <td><span class="badge badge-${item.type || 'info'}">${typeLabels[item.type] || item.type}</span></td>
                        <td>${item.is_active ? '<span class="status-active">Actief</span>' : '<span class="status-inactive">Inactief</span>'}</td>
                        <td>
                            <button class="btn btn-sm btn-secondary" onclick="admin.showPracticalModal(${item.id})" title="Bewerken">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="admin.deletePracticalItem(${item.id}, '${this.escapeHtml(item.title)}')" title="Verwijderen">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
            this.hideLoader('practicalContent');
        } catch (error) {
            console.error('Error loading practical info:', error);
            tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Fout bij laden: ' + error.message + '</td></tr>';
            this.hideLoader('practicalContent');
        }
    }

    ionToFa(ionIcon) {
        const map = {
            'information-circle-outline': 'info-circle',
            'call-outline': 'phone',
            'link-outline': 'link',
            'calendar-outline': 'calendar',
            'trash-outline': 'trash',
            'map-outline': 'map-marker-alt',
            'bus-outline': 'bus',
            'medkit-outline': 'medkit',
            'school-outline': 'graduation-cap',
            'restaurant-outline': 'utensils',
            'cart-outline': 'shopping-cart',
            'home-outline': 'home',
            'people-outline': 'users',
            'newspaper-outline': 'newspaper',
            'settings-outline': 'cog',
            'alert-circle-outline': 'exclamation-circle',
            'time-outline': 'clock',
            'location-outline': 'map-pin',
        };
        return map[ionIcon] || 'circle';
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    async showPracticalModal(itemId) {
        let item = null;
        if (itemId) {
            try {
                const res = await fetch(`${this.apiBaseUrl}/admin/practical-info`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    item = (data.items || []).find(i => i.id === itemId);
                }
            } catch (e) {
                console.error('Error fetching item for edit:', e);
            }
        }

        const isEdit = !!item;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-content large">
                <div class="modal-header">
                    <h3>${isEdit ? 'Item bewerken' : 'Nieuw praktisch item'}</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="practicalForm" class="event-form">
                        <input type="hidden" id="practicalId" value="${isEdit ? item.id : ''}">

                        <div class="form-row">
                            <div class="form-group" style="flex:2">
                                <label for="practicalTitle">Titel *</label>
                                <input type="text" id="practicalTitle" placeholder="Bijv. Huisarts" required value="${isEdit ? this.escapeHtml(item.title) : ''}">
                            </div>
                            <div class="form-group" style="flex:1">
                                <label for="practicalSortOrder">Volgorde</label>
                                <input type="number" id="practicalSortOrder" placeholder="0" value="${isEdit ? (item.sort_order || 0) : 0}">
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="practicalSubtitle">Ondertitel</label>
                            <input type="text" id="practicalSubtitle" placeholder="Bijv. Praktijk Holwerd" value="${isEdit && item.subtitle ? this.escapeHtml(item.subtitle) : ''}">
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label for="practicalType">Type</label>
                                <select id="practicalType">
                                    <option value="info" ${isEdit && item.type === 'info' ? 'selected' : ''}>Info (alleen tekst)</option>
                                    <option value="link" ${isEdit && item.type === 'link' ? 'selected' : ''}>Link (opent URL)</option>
                                    <option value="phone" ${isEdit && item.type === 'phone' ? 'selected' : ''}>Telefoon (belt nummer)</option>
                                    <option value="schedule" ${isEdit && item.type === 'schedule' ? 'selected' : ''}>Schema (tekst)</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="practicalIcon">Icoon</label>
                                <input type="text" id="practicalIcon" placeholder="information-circle-outline" value="${isEdit ? (item.icon || 'information-circle-outline') : 'information-circle-outline'}" style="margin-bottom:8px;">
                                <div class="icon-choices">
                                    <!-- Basis -->
                                    <button type="button" class="icon-choice" data-icon="information-circle-outline" onclick="admin.setPracticalIcon('information-circle-outline')" title="Info">
                                        <i class="fas fa-info-circle"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="alert-circle-outline" onclick="admin.setPracticalIcon('alert-circle-outline')" title="Let op / melding">
                                        <i class="fas fa-exclamation-circle"></i>
                                    </button>
                                    <!-- Contact -->
                                    <button type="button" class="icon-choice" data-icon="call-outline" onclick="admin.setPracticalIcon('call-outline')" title="Telefoon">
                                        <i class="fas fa-phone"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="link-outline" onclick="admin.setPracticalIcon('link-outline')" title="Website / link">
                                        <i class="fas fa-link"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="mail-outline" onclick="admin.setPracticalIcon('mail-outline')" title="E-mail">
                                        <i class="fas fa-envelope"></i>
                                    </button>
                                    <!-- Locatie & vervoer -->
                                    <button type="button" class="icon-choice" data-icon="map-outline" onclick="admin.setPracticalIcon('map-outline')" title="Locatie / route">
                                        <i class="fas fa-map-marker-alt"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="bus-outline" onclick="admin.setPracticalIcon('bus-outline')" title="Vervoer / bus">
                                        <i class="fas fa-bus"></i>
                                    </button>
                                    <!-- Voorzieningen -->
                                    <button type="button" class="icon-choice" data-icon="home-outline" onclick="admin.setPracticalIcon('home-outline')" title="Gebouw / locatie">
                                        <i class="fas fa-home"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="medkit-outline" onclick="admin.setPracticalIcon('medkit-outline')" title="Zorg / EHBO">
                                        <i class="fas fa-briefcase-medical"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="school-outline" onclick="admin.setPracticalIcon('school-outline')" title="School / onderwijs">
                                        <i class="fas fa-school"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="restaurant-outline" onclick="admin.setPracticalIcon('restaurant-outline')" title="Horeca / eten">
                                        <i class="fas fa-utensils"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="cart-outline" onclick="admin.setPracticalIcon('cart-outline')" title="Winkels / boodschappen">
                                        <i class="fas fa-shopping-cart"></i>
                                    </button>
                                    <!-- Mensen & activiteiten -->
                                    <button type="button" class="icon-choice" data-icon="people-outline" onclick="admin.setPracticalIcon('people-outline')" title="Groep / vereniging">
                                        <i class="fas fa-users"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="calendar-outline" onclick="admin.setPracticalIcon('calendar-outline')" title="Agenda / tijden">
                                        <i class="fas fa-calendar-alt"></i>
                                    </button>
                                    <button type="button" class="icon-choice" data-icon="newspaper-outline" onclick="admin.setPracticalIcon('newspaper-outline')" title="Nieuws / info">
                                        <i class="fas fa-newspaper"></i>
                                    </button>
                                </div>
                                <small class="form-hint">Kies een icoon of vul handmatig een Ionicons naam in (bijv. information-circle-outline).</small>
                            </div>
                        </div>

                        <div class="form-group" id="practicalUrlGroup">
                            <label for="practicalUrl" id="practicalUrlLabel">URL / Telefoonnummer</label>
                            <input type="text" id="practicalUrl" placeholder="https://... of 0512-123456" value="${isEdit && item.url ? this.escapeHtml(item.url) : ''}">
                            <small class="form-hint">Bij type "Link": volledige URL. Bij type "Telefoon": telefoonnummer.</small>
                        </div>

                        <div class="form-group">
                            <label for="practicalItemContent">Inhoud / Extra tekst</label>
                            <textarea id="practicalItemContent" rows="4" placeholder="Optionele extra informatie...">${isEdit && item.content ? this.escapeHtml(item.content) : ''}</textarea>
                        </div>

                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="practicalActive" ${!isEdit || item.is_active ? 'checked' : ''}>
                                <span>Actief (zichtbaar in de app)</span>
                            </label>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                        Annuleren
                    </button>
                    <button class="btn btn-primary" onclick="admin.savePracticalItem()">
                        ${isEdit ? 'Bijwerken' : 'Toevoegen'}
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    setPracticalIcon(icon) {
        const input = document.getElementById('practicalIcon');
        if (input) {
            input.value = icon;
        }
        const buttons = document.querySelectorAll('.icon-choice');
        buttons.forEach(btn => btn.classList.remove('selected'));
        const active = document.querySelector(`.icon-choice[data-icon=\"${icon}\"]`);
        if (active) {
            active.classList.add('selected');
        }
    }

    async savePracticalItem() {
        const id = document.getElementById('practicalId').value;
        const title = document.getElementById('practicalTitle').value.trim();
        const subtitle = document.getElementById('practicalSubtitle').value.trim();
        const type = document.getElementById('practicalType').value;
        const icon = document.getElementById('practicalIcon').value.trim() || 'information-circle-outline';
        const url = document.getElementById('practicalUrl').value.trim();
        const content = document.getElementById('practicalItemContent').value.trim();
        const sort_order = parseInt(document.getElementById('practicalSortOrder').value) || 0;
        const is_active = document.getElementById('practicalActive').checked;

        if (!title) {
            this.showNotification('Titel is verplicht', 'error');
            return;
        }

        const payload = { title, subtitle, icon, content, type, url, sort_order, is_active };

        try {
            this.showLoader(null, 'Opslaan...');
            const isEdit = !!id;
            const endpoint = isEdit
                ? `${this.apiBaseUrl}/admin/practical-info/${id}`
                : `${this.apiBaseUrl}/admin/practical-info`;

            const res = await fetch(endpoint, {
                method: isEdit ? 'PUT' : 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            this.hideLoader();

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || err.error || 'Server error');
            }

            const modal = document.querySelector('.modal-overlay');
            if (modal) modal.remove();

            this.showNotification(isEdit ? 'Item bijgewerkt!' : 'Item toegevoegd!', 'success');
            this.loadPracticalInfo();
        } catch (error) {
            this.hideLoader();
            this.showNotification('Fout bij opslaan: ' + error.message, 'error');
        }
    }

    async deletePracticalItem(id, title) {
        if (!confirm(`Weet je zeker dat je "${title}" wilt verwijderen?`)) return;

        try {
            this.showLoader(null, 'Verwijderen...');
            const res = await fetch(`${this.apiBaseUrl}/admin/practical-info/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            this.hideLoader();

            if (!res.ok) throw new Error('Server error ' + res.status);

            this.showNotification('Item verwijderd', 'success');
            this.loadPracticalInfo();
        } catch (error) {
            this.hideLoader();
            this.showNotification('Fout bij verwijderen: ' + error.message, 'error');
        }
    }

    async loadContentPages() {
        const container = document.getElementById('contentPagesContainer');
        if (!container) return;

        this.showLoader('contentPagesContainer', 'Content pagina\'s laden...');
        try {
            const res = await fetch(`${this.apiBaseUrl}/admin/content-pages`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!res.ok) throw new Error('Server error ' + res.status);
            const data = await res.json();
            const pages = data.pages || [];

            const slugLabels = {
                'privacy': { icon: 'shield-alt', label: 'Privacybeleid' },
                'terms': { icon: 'file-contract', label: 'Gebruiksvoorwaarden' }
            };

            if (pages.length === 0) {
                container.innerHTML = '<p class="text-muted">Nog geen content pagina\'s gevonden. Ze worden automatisch aangemaakt bij de eerste keer laden.</p>';
            } else {
                container.innerHTML = pages.map(page => {
                    const meta = slugLabels[page.slug] || { icon: 'file-alt', label: page.title };
                    const updatedAt = page.updated_at ? new Date(page.updated_at).toLocaleDateString('nl-NL', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'onbekend';
                    return `
                        <div class="content-page-card" style="background:#fff; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                                <div>
                                    <h3 style="margin:0; font-size:1.1rem;">
                                        <i class="fas fa-${meta.icon}" style="color:#3B82F6; margin-right:8px;"></i>
                                        ${this.escapeHtml(page.title)}
                                    </h3>
                                    <small style="color:#888;">Slug: ${page.slug} &bull; Laatst bijgewerkt: ${updatedAt}</small>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="admin.editContentPage('${page.slug}')">
                                    <i class="fas fa-edit"></i> Bewerken
                                </button>
                            </div>
                            <div class="content-preview" style="max-height:150px; overflow:hidden; border:1px solid #eee; border-radius:8px; padding:12px; font-size:0.85rem; color:#555; position:relative;">
                                ${page.content || '<em>Nog geen inhoud</em>'}
                                <div style="position:absolute; bottom:0; left:0; right:0; height:40px; background:linear-gradient(transparent, white);"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            this.hideLoader('contentPagesContainer');
        } catch (error) {
            console.error('Error loading content pages:', error);
            container.innerHTML = '<p class="text-muted">Fout bij laden: ' + error.message + '</p>';
            this.hideLoader('contentPagesContainer');
        }
    }

    async editContentPage(slug) {
        let page = null;
        try {
            const res = await fetch(`${this.apiBaseUrl}/admin/content-pages`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (res.ok) {
                const data = await res.json();
                page = (data.pages || []).find(p => p.slug === slug);
            }
        } catch (e) {
            console.error('Error fetching content page:', e);
        }

        if (!page) {
            this.showNotification('Pagina niet gevonden', 'error');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-content large" style="max-width:900px; max-height:90vh;">
                <div class="modal-header">
                    <h3><i class="fas fa-edit"></i> ${this.escapeHtml(page.title)} bewerken</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="overflow-y:auto;">
                    <form id="contentPageForm" class="event-form">
                        <input type="hidden" id="cpSlug" value="${page.slug}">

                        <div class="form-group">
                            <label for="cpTitle">Titel</label>
                            <input type="text" id="cpTitle" value="${this.escapeHtml(page.title)}" required>
                        </div>

                        <div class="form-group">
                            <label for="cpContent">Inhoud (HTML)</label>
                            <div style="display:flex; gap:8px; margin-bottom:8px;">
                                <button type="button" class="btn btn-secondary btn-sm" onclick="admin.insertHtmlTag('h2')">H2</button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="admin.insertHtmlTag('h3')">H3</button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="admin.insertHtmlTag('p')">Alinea</button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="admin.insertHtmlTag('strong')">Vet</button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="admin.insertHtmlTag('ul')">Lijst</button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="admin.insertHtmlTag('a')">Link</button>
                            </div>
                            <textarea id="cpContent" rows="20" style="font-family:monospace; font-size:0.85rem; line-height:1.5;">${this.escapeHtml(page.content || '')}</textarea>
                        </div>

                        <details style="margin-top:8px;">
                            <summary style="cursor:pointer; color:#666; font-size:0.85rem;">Voorbeeld weergave</summary>
                            <div id="cpPreview" style="border:1px solid #ddd; border-radius:8px; padding:16px; margin-top:8px; max-height:300px; overflow-y:auto; font-size:0.9rem; line-height:1.6;"></div>
                        </details>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                        Annuleren
                    </button>
                    <button class="btn btn-primary" onclick="admin.saveContentPage()">
                        <i class="fas fa-save"></i> Opslaan
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const textarea = document.getElementById('cpContent');
        const preview = document.getElementById('cpPreview');
        if (textarea && preview) {
            preview.innerHTML = textarea.value;
            textarea.addEventListener('input', () => {
                preview.innerHTML = textarea.value;
            });
        }
    }

    insertHtmlTag(tag) {
        const textarea = document.getElementById('cpContent');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        let insertion = '';

        switch (tag) {
            case 'h2': insertion = `<h2>${selected || 'Koptekst'}</h2>`; break;
            case 'h3': insertion = `<h3>${selected || 'Subkop'}</h3>`; break;
            case 'p': insertion = `<p>${selected || 'Tekst hier...'}</p>`; break;
            case 'strong': insertion = `<strong>${selected || 'vette tekst'}</strong>`; break;
            case 'ul': insertion = `<ul>\n  <li>${selected || 'Item 1'}</li>\n  <li>Item 2</li>\n</ul>`; break;
            case 'a': insertion = `<a href="https://">${selected || 'linktekst'}</a>`; break;
            default: insertion = `<${tag}>${selected}</${tag}>`;
        }

        textarea.value = textarea.value.substring(0, start) + insertion + textarea.value.substring(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
        textarea.dispatchEvent(new Event('input'));
    }

    async saveContentPage() {
        const slug = document.getElementById('cpSlug').value;
        const title = document.getElementById('cpTitle').value.trim();
        const contentVal = document.getElementById('cpContent').value;

        if (!title) {
            this.showNotification('Titel is verplicht', 'error');
            return;
        }

        try {
            this.showLoader(null, 'Opslaan...');
            const res = await fetch(`${this.apiBaseUrl}/admin/content-pages/${slug}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title, content: contentVal })
            });

            this.hideLoader();

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || err.error || 'Server error');
            }

            const modal = document.querySelector('.modal-overlay');
            if (modal) modal.remove();

            this.showNotification('Pagina opgeslagen!', 'success');
            this.loadContentPages();
        } catch (error) {
            this.hideLoader();
            this.showNotification('Fout bij opslaan: ' + error.message, 'error');
        }
    }

    async loadModeration() {
        try {
            const container = document.getElementById('moderationContent');
            if (!container) return;

            // Show loader
            this.showLoader('moderationContent', 'Moderatie content laden...');

            // Haal pending content op
            const response = await fetch(`${this.apiBaseUrl}/admin/moderation/pending`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const pendingItems = await response.json();
                this.displayModerationContent(pendingItems);
            } else {
                container.innerHTML = '<p class="text-muted">Geen content wacht op moderatie</p>';
            }
            this.hideLoader('moderationContent');
        } catch (error) {
            console.error('Error loading moderation content:', error);
            document.getElementById('moderationContent').innerHTML = '<p class="text-muted">Fout bij laden moderatie content</p>';
            this.hideLoader('moderationContent');
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

        const itemsHtml = items.map(item => `
            <div class="moderation-item" style="background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #ffc107;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div>
                        <h4 style="margin: 0; color: #212529; font-size: 18px;">${item.title || 'Geen titel'}</h4>
                        <p style="margin: 4px 0 0 0; color: #6c757d; font-size: 14px;">
                            <i class="fas fa-tag" style="margin-right: 6px;"></i>
                            ${item.type || 'Onbekend type'}
                        </p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-icon btn-approve" onclick="admin.approveContent('${item.type}', ${item.id})" title="Goedkeuren">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn-icon btn-reject" onclick="admin.rejectContent('${item.type}', ${item.id})" title="Afwijzen">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                
                ${item.description ? `
                    <div style="margin-bottom: 12px;">
                        <p style="color: #495057; line-height: 1.5; margin: 0;">${item.description}</p>
                    </div>
                ` : ''}
                
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #6c757d;">
                    <span>
                        <i class="fas fa-user" style="margin-right: 4px;"></i>
                        ${item.author_name || 'Onbekende gebruiker'}
                    </span>
                    <span>
                        <i class="fas fa-clock" style="margin-right: 4px;"></i>
                        ${item.created_at ? new Date(item.created_at).toLocaleDateString('nl-NL') : 'Onbekende datum'}
                    </span>
                </div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="moderation-header" style="margin-bottom: 20px;">
                <h3 style="margin: 0; color: #212529;">Content wacht op moderatie (${items.length})</h3>
                <p style="margin: 4px 0 0 0; color: #6c757d;">Beoordeel en goedkeur of wijs af</p>
            </div>
            ${itemsHtml}
        `;
    }

    // User management methods
    async viewUser(id) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/users`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const user = data.users.find(u => u.id === id);
                if (user) {
                    this.showUserModal(user);
                }
            }
        } catch (error) {
            console.error('Error getting user details:', error);
            this.showNotification('Fout bij ophalen gebruikersgegevens', 'error');
        }
    }

    showUserModal(user) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Gebruikersprofiel</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
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
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Sluiten</button>
                    <button class="btn btn-primary" onclick="admin.editUser(${user.id}); this.closest('.modal-overlay').remove()">Bewerken</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    showCreateUserModal() {
        const self = this;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Nieuwe Dorpsbewoner</h3>
                    <button type="button" class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="createUserForm" class="edit-form">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="createFirstName">Voornaam *</label>
                                <input type="text" id="createFirstName" name="first_name" required>
                            </div>
                            <div class="form-group">
                                <label for="createLastName">Achternaam *</label>
                                <input type="text" id="createLastName" name="last_name" required>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="createEmail">E-mail *</label>
                            <input type="email" id="createEmail" name="email" required>
                        </div>
                        <div class="form-group">
                            <label for="createPassword">Wachtwoord *</label>
                            <input type="password" id="createPassword" name="password" required minlength="6">
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
            if (!first_name || !last_name || !email || !password || password.length < 6) {
                this.showNotification('Vul alle velden in. Wachtwoord minimaal 6 tekens.', 'error');
                return;
            }
            if (!this.token) {
                this.showNotification('Niet ingelogd. Log opnieuw in.', 'error');
                return;
            }
            this.showLoader(null, 'Gebruiker aanmaken...');
            const res = await fetch(`${this.apiBaseUrl}/admin/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ first_name, last_name, email, password, role: 'user', is_active: true })
            });
            const data = await res.json().catch(() => ({}));
            this.hideLoader();
            if (res.ok) {
                this.showNotification('Gebruiker succesvol aangemaakt', 'success');
                document.querySelector('.modal-overlay')?.remove();
                this.loadUsers('user');
            } else {
                const msg = res.status === 401 ? 'Sessie verlopen. Log opnieuw in.'
                    : res.status === 403 ? 'Geen beheerdersrechten. Log in als admin.'
                    : data.error || data.message || `Aanmaken mislukt (HTTP ${res.status})`;
                this.showNotification(msg, 'error');
            }
        } catch (e) {
            this.hideLoader();
            this.showNotification('Fout: ' + (e?.message || e), 'error');
        }
    }

    async editUser(id) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/users`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const user = data.users.find(u => u.id === id);
                if (user) {
                    this.showEditUserModal(user);
                }
            }
        } catch (error) {
            console.error('Error getting user details:', error);
            this.showNotification('Fout bij ophalen gebruikersgegevens', 'error');
        }
    }

    showEditUserModal(user) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h3>Gebruiker Bewerken</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
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
                                        <button type="button" class="tab-btn active" onclick="admin.switchImageTab('url')">URL</button>
                                        <button type="button" class="tab-btn" onclick="admin.switchImageTab('upload')">Upload</button>
                                    </div>
                                    <div class="tab-content">
                                        <div id="url-tab" class="tab-pane active">
                                            <input type="url" id="editProfileImage" name="profile_image_url" value="${user.profile_image_url || ''}" placeholder="https://...">
                                        </div>
                                        <div id="upload-tab" class="tab-pane">
                                            <input type="file" id="profileImageUpload" name="profile_image_file" accept="image/*" onchange="admin.previewUploadedImage(this)">
                                            <div id="uploadPreview" class="upload-preview" style="display: none;">
                                                <img id="uploadedImagePreview" src="" alt="Preview" class="preview-img">
                                                <button type="button" class="btn btn-sm btn-secondary" onclick="admin.clearUploadPreview()">Verwijder</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuleren</button>
                    <button class="btn btn-primary" onclick="admin.saveUserChanges(${user.id})">Opslaan</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
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
                document.querySelector('.modal-overlay').remove();
                this.loadUsersSectionData(); // Refresh de actieve tab
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
        // Remove active class from all tabs and panes
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        
        // Add active class to selected tab and pane
        document.querySelector(`[onclick="admin.switchImageTab('${tab}')"]`).classList.add('active');
        document.getElementById(`${tab}-tab`).classList.add('active');
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

            const response = await fetch(`${this.apiBaseUrl}/admin/news?organization_id=${orgId}&minimal=1`, {
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
                            <small>${new Date(article.published_at || article.created_at).toLocaleDateString('nl-NL')}</small>
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
                            <button class="btn btn-sm btn-secondary" onclick="admin.openEventModal(${event.id}, 'edit')">
                                <i class="fas fa-edit"></i> Bewerken
                            </button>
                            <button class="btn btn-sm btn-primary" onclick="admin.openEventModal(${event.id}, 'view')">
                                <i class="fas fa-eye"></i> Bekijken
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
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
            
            // Stap 1: toon eerst de modal met lege dropdown; laad organisaties daarna async
            // (voorkomt dat een trage call de modal blokkeert)
            
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
                        event_date: ev.event_date ? new Date(ev.event_date).toISOString().slice(0,16) : '',
                        event_end_date: ev.event_end_date ? new Date(ev.event_end_date).toISOString().slice(0,16) : (ev.event_date ? new Date(ev.event_date).toISOString().slice(0,16) : ''),
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
                            <button class="close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
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
                            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Sluiten</button>
                        </div>
                    </div>
                `;
            } else {
                // Create/Edit modus - toon formulier
                overlay.innerHTML = `
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>${mode === 'create' ? 'Nieuw event' : 'Event bewerken'}</h3>
                            <button class="close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
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
                                    <input type="file" id="evImage" accept="image/*" onchange="admin.previewEventImage(this)">
                                    <div id="evImagePreview" style="display: none; margin-top: 10px;">
                                        <img id="evImagePreviewImg" src="" style="max-width: 200px; max-height: 200px; border-radius: 8px;">
                                        <button type="button" class="btn btn-sm btn-secondary" onclick="admin.clearEventImagePreview()" style="margin-top: 5px;">Verwijder afbeelding</button>
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
                            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuleren</button>
                            <button class="btn btn-primary" onclick="admin.saveEvent(${eventId ? eventId : 'null'})">Opslaan</button>
                        </div>
                    </div>
                `;
            }
            document.body.appendChild(overlay);

            // Koppel einddatum aan begindatum (alleen voor create/edit modus)
            if (mode !== 'view') {
                const startEl = overlay.querySelector('#evStart');
                const endEl = overlay.querySelector('#evEnd');
                const syncEnd = () => {
                    if (startEl && startEl.value && endEl) {
                        endEl.min = startEl.value;
                        if (!endEl.value || endEl.value < startEl.value) {
                            endEl.value = startEl.value;
                        }
                    }
                };
                startEl?.addEventListener('change', syncEnd);
                endEl?.addEventListener('change', syncEnd);
                syncEnd();
            }

            // Scroll naar top zodat modal niet buiten beeld valt (zeker op mobiel)
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            console.error('openEventModal error:', e);
            this.showNotification('Fout bij openen event-modal', 'error');
        }
    }

    // Eenvoudige event-modal (naar voorbeeld nieuws) - toont direct, laadt organisaties async
    async showCreateEventModalSimple() {
        // Verwijder bestaande overlays
        document.querySelectorAll('.modal-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.35)',
            zIndex: '9999'
        });

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.maxWidth = '720px';
        modal.style.width = '95%';
        modal.innerHTML = `
            <div class="modal-header">
                <h3>Nieuw evenement</h3>
                <button class="close" aria-label="Sluiten">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form">
                    <div class="form-group">
                        <label>Titel</label>
                        <input type="text" id="evTitle" placeholder="Titel">
                    </div>
                    <div class="form-group">
                        <label>Omschrijving</label>
                        <textarea id="evDesc" style="min-height:120px" placeholder="Omschrijving"></textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Begindatum</label>
                            <input type="datetime-local" id="evStart">
                        </div>
                        <div class="form-group">
                            <label>Einddatum</label>
                            <input type="datetime-local" id="evEnd">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Locatie</label>
                        <input type="text" id="evLocation" placeholder="Locatie">
                    </div>
                    <div class="form-group">
                        <label>Kosten (optioneel, bijv. 5.00)</label>
                        <input type="number" step="0.01" min="0" id="evPrice" placeholder="Kosten">
                    </div>
                    <div class="form-group">
                        <label>Organisatie (optioneel)</label>
                        <select id="evOrg">
                            <option value="">Geen organisatie</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Afbeelding (optioneel)</label>
                        <input type="file" id="evImage" accept="image/*">
                        <div id="evImagePreview" style="display:none;margin-top:10px;">
                            <img id="evImagePreviewImg" src="" style="max-width:200px;max-height:200px;border-radius:8px;">
                            <button type="button" class="btn btn-sm btn-secondary" id="evImageClear" style="margin-top:5px;">Verwijder afbeelding</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary btn-cancel">Annuleren</button>
                <button class="btn btn-primary btn-save">Opslaan</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        console.log('[Events] Simple modal overlay added');

        // Close handlers
        const close = () => overlay.remove();
        modal.querySelector('.close')?.addEventListener('click', close);
        modal.querySelector('.btn-cancel')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        modal.addEventListener('click', (e) => e.stopPropagation());

        // Image preview handlers
        const imgInput = modal.querySelector('#evImage');
        const imgPreview = modal.querySelector('#evImagePreview');
        const imgPreviewImg = modal.querySelector('#evImagePreviewImg');
        const imgClear = modal.querySelector('#evImageClear');
        if (imgInput) {
            imgInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) {
                    imgPreview.style.display = 'none';
                    imgPreviewImg.src = '';
                    return;
                }
                try {
                    const compressedBase64 = await this.compressEventImage(file);
                    imgPreviewImg.src = compressedBase64;
                    imgPreview.style.display = 'block';
                } catch (err) {
                    console.error('Error processing image:', err);
                    this.showNotification('Fout bij verwerken van afbeelding', 'error');
                    imgPreview.style.display = 'none';
                    imgPreviewImg.src = '';
                }
            });
        }
        if (imgClear) {
            imgClear.addEventListener('click', () => {
                if (imgInput) imgInput.value = '';
                imgPreview.style.display = 'none';
                imgPreviewImg.src = '';
            });
        }

        // Async load organizations via proxy (snelste route)
        const orgSelect = modal.querySelector('#evOrg');
        (async () => {
            try {
                const orgRes = await fetch(`https://holwert.appenvloed.com/admin/db-proxy.php`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': 'holwert-db-proxy-2026-secure-key-change-in-production'
                    },
                    body: JSON.stringify({
                        action: 'execute',
                        query: 'SELECT id, name FROM organizations ORDER BY name ASC'
                    })
                });
                if (orgRes.ok) {
                    const orgData = await orgRes.json();
                    const organizations = orgData.rows || [];
                    console.log('Organizations loaded (proxy, simple modal):', organizations.length);
                    if (orgSelect) {
                        const opts = ['<option value="">Geen organisatie</option>'].concat(
                            organizations.map(org => `<option value="${org.id}">${org.name || `Organisatie ${org.id}`}</option>`)
                        );
                        orgSelect.innerHTML = opts.join('');
                    }
                } else {
                    console.warn('Organizations via proxy mislukt:', orgRes.status);
                }
            } catch (err) {
                console.warn('Organizations via proxy error (simple modal):', err);
            }
        })();

        // Save handler
        modal.querySelector('.btn-save')?.addEventListener('click', async () => {
            try {
                const saveBtn = modal.querySelector('.btn-save');
                const cancelBtn = modal.querySelector('.btn-cancel');
                if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Opslaan...'; }
                if (cancelBtn) { cancelBtn.disabled = true; }
                this.showLoader(null, 'Evenement opslaan...');

                const title = (modal.querySelector('#evTitle')?.value || '').trim();
                const description = (modal.querySelector('#evDesc')?.value || '').trim();
                const event_date_raw = modal.querySelector('#evStart')?.value;
                const event_end_date_raw = modal.querySelector('#evEnd')?.value;
                const location = (modal.querySelector('#evLocation')?.value || '').trim();
                const orgVal = modal.querySelector('#evOrg')?.value;
                const organization_id = orgVal ? parseInt(orgVal) : null;
                const priceVal = modal.querySelector('#evPrice')?.value;
                const price = priceVal ? parseFloat(priceVal) : null;
                const imgVal = modal.querySelector('#evImagePreviewImg')?.src;
                let image_url = null;
                if (imgVal && imgVal.startsWith('data:image')) {
                    this.showLoader(null, 'Afbeelding uploaden...');
                    image_url = await this.uploadBase64ToBackend(imgVal, `event-image-${Date.now()}.jpg`, organization_id);
                } else if (imgVal && (imgVal.startsWith('http://') || imgVal.startsWith('https://'))) {
                    image_url = imgVal;
                } else {
                    image_url = null;
                }

                if (!title || !description || !event_date_raw || !location) {
                    this.showNotification('Vul alle verplichte velden in', 'error');
                    this.hideLoader();
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Opslaan'; }
                    if (cancelBtn) { cancelBtn.disabled = false; }
                    return;
                }

                const body = {
                    title,
                    description,
                    event_date: new Date(event_date_raw).toISOString(),
                    event_end_date: event_end_date_raw ? new Date(event_end_date_raw).toISOString() : null,
                    location,
                    organization_id,
                    status: 'scheduled',
                    price,
                    image_url
                };

                const res = await fetch(`${this.apiBaseUrl}/admin/events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify(body)
                });

                if (!res.ok) {
                    let msg = `HTTP ${res.status}`;
                    try { const j = await res.json(); msg = j.message || j.error || msg; } catch {}
                    this.showNotification(`Opslaan mislukt: ${msg}`, 'error');
                } else {
                    this.showNotification('Evenement opgeslagen', 'success');
                    overlay.remove();
                    this.loadEvents();
                    this.loadNotificationCounts();
                }
                this.hideLoader();
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Opslaan'; }
                if (cancelBtn) { cancelBtn.disabled = false; }
            } catch (err) {
                console.error('saveEvent (simple) error:', err);
                this.showNotification('Fout bij opslaan evenement: ' + (err?.message || err), 'error');
                this.hideLoader();
            }
        });

        // Scroll naar top
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

                    this.showLoader(null, 'Afbeelding uploaden...');
                    imageUrl = await this.uploadBase64ToBackend(compressedBase64, `event-image-${Date.now()}.jpg`, organization_id);
                } catch (error) {
                    console.error('Error processing image:', error);
                    this.showNotification('Fout bij verwerken van afbeelding', 'error');
                    return;
                }
            } else {
                // Als er geen nieuwe afbeelding is geüpload, behoud de bestaande (bij edit)
                const existingImage = document.querySelector('#evImagePreviewImg')?.src;
                if (existingImage && existingImage.startsWith('data:image')) {
                    this.showLoader(null, 'Afbeelding uploaden...');
                    imageUrl = await this.uploadBase64ToBackend(existingImage, `event-image-${Date.now()}.jpg`, organization_id);
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
                event_date: new Date(event_date_raw).toISOString(),
                event_end_date: event_end_date_raw ? new Date(event_end_date_raw).toISOString() : null,
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
            setTimeout(() => {
                document.querySelector('.modal-overlay')?.remove();
            }, 500);
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
