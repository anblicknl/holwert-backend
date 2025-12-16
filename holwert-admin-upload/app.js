console.log('=== SCRIPT LOADED ===');

class HolwertAdmin {
    constructor() {
        // Use production API if available, otherwise localhost
        this.apiBaseUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000/api'
            : 'https://holwert-backend.vercel.app/api';
        this.token = localStorage.getItem('authToken');
        this.currentUser = null;
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

        // Navigation
        const navLinks = document.querySelectorAll('.nav-link');
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
        const mainScreen = document.getElementById('dashboardScreen');
        
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
        const mainScreen = document.getElementById('dashboardScreen');
        
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
        
        // Hide DEMO MODE indicator (we're using real API)
        const demoIndicator = document.getElementById('demoModeIndicator');
        if (demoIndicator) {
            demoIndicator.style.display = 'none';
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
        
        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        const navLink = document.querySelector(`[data-section="${sectionName}"]`);
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

    // User management
    async loadUsers() {
        try {
            console.log('Loading users...');
            const response = await fetch(`${this.apiBaseUrl}/admin/users`, {
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
        } catch (error) {
            console.error('Error loading users:', error);
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
    displayOrganizations(organizations) {
        const container = document.getElementById('organizationsList');
        if (!container) {
            console.error('organizationsList container not found');
            return;
        }

        if (!organizations || organizations.length === 0) {
            container.innerHTML = '<p class="empty-message">Geen organisaties gevonden</p>';
            return;
        }

        container.innerHTML = organizations.map(org => `
            <div class="content-item">
                <div class="content-item-header">
                    <div class="content-item-info">
                        <h3>${org.name || '-'}</h3>
                        <p>${org.category || 'Geen categorie'}</p>
                    </div>
                    <div class="content-item-meta">
                        <span class="status-badge status-${org.is_active ? 'active' : 'inactive'}">
                            ${org.is_active ? 'Actief' : 'Inactief'}
                        </span>
                        <span class="meta-text">${org.user_count || 0} gebruikers</span>
                    </div>
                </div>
                <div class="content-item-actions">
                    <button class="btn btn-sm btn-warning" onclick="admin.editOrganization(${org.id})">
                        <i class="fas fa-edit"></i> Bewerken
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="admin.deleteOrganization(${org.id})">
                        <i class="fas fa-trash"></i> Verwijderen
                    </button>
                </div>
            </div>
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
                    this.displayOrganizations(data.organizations);
                } else {
                    console.log('No organizations found in response');
                    const container = document.getElementById('organizationsList');
                    if (container) {
                        container.innerHTML = '<p class="empty-message">Geen organisaties gevonden</p>';
                    }
                }
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error('Failed to load organizations:', response.status, errorData);
                this.showNotification(`Fout bij laden organisaties: ${errorData.error || response.statusText}`, 'error');
                
                const container = document.getElementById('organizationsList');
                if (container) {
                    container.innerHTML = `<p class="empty-message">Fout: ${errorData.error || response.statusText}</p>`;
                }
            }
        } catch (error) {
            console.error('Error loading organizations:', error);
            this.showNotification(`Fout bij laden organisaties: ${error.message}`, 'error');
            
            const container = document.getElementById('organizationsList');
            if (container) {
                container.innerHTML = `<p class="empty-message">Fout: ${error.message}</p>`;
            }
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
                
                // Add pending news
                if (data.news && data.news.length > 0) {
                    data.news.forEach(news => {
                        allPending.push({
                            type: 'news',
                            id: news.id,
                            title: news.title,
                            meta: `Nieuws • ${this.formatDate(news.created_at)}`,
                            icon: 'newspaper'
                        });
                    });
                }
                
                // Add pending events
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
            console.log('Loading news...');
            const response = await fetch(`${this.apiBaseUrl}/admin/news`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            console.log('News response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                console.log('News data:', data);
                this.displayNews(data.news || []);
            } else {
                console.error('Failed to load news');
                this.displayNews([]);
            }
        } catch (error) {
            console.error('Error loading news:', error);
            this.displayNews([]);
        }
    }

    displayNews(news) {
        console.log('displayNews called with:', news);
        
        // Wait a bit for the DOM to update after section activation
        setTimeout(() => {
            // Try both possible container IDs
            let container = document.getElementById('newsList');
            if (!container) {
                container = document.getElementById('newsContent');
                console.log('newsList not found, trying newsContent:', container);
            }
            
            console.log('Container found:', container);
            console.log('All elements with id newsList:', document.querySelectorAll('#newsList'));
            console.log('All elements with id newsContent:', document.querySelectorAll('#newsContent'));
            console.log('News section element:', document.getElementById('news'));
            
            if (!container) {
                console.error('Neither newsList nor newsContent container found!');
                console.log('Available elements with "news" in ID:', document.querySelectorAll('[id*="news"]'));
                return;
            }
            
            this.renderNewsContent(container, news);
        }, 200);
    }
    
    renderNewsContent(container, news) {
        
        if (!news || news.length === 0) {
            console.log('No news, showing empty state');
            container.innerHTML = `
                <div class="section-header">
                    <h3>Nieuws Beheer</h3>
                    <button class="btn btn-primary" onclick="admin.showCreateNewsModal()">
                        <i class="fas fa-plus"></i> Nieuw Artikel
                    </button>
                </div>
                <p class="text-muted">Geen nieuws artikelen gevonden</p>
            `;
            return;
        }

        const newsHTML = `
            <div class="section-header">
                <h3>Nieuws Beheer</h3>
                <button class="btn btn-primary" onclick="admin.showCreateNewsModal()">
                    <i class="fas fa-plus"></i> Nieuw Artikel
                </button>
            </div>
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
                                    <small>${new Date(article.created_at).toLocaleDateString('nl-NL')}</small>
                                </td>
                                <td>
                                    <div class="action-buttons">
                                        <button class="btn btn-icon btn-view" onclick="admin.viewNews(${article.id})" title="Bekijken">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                        <button class="btn btn-icon btn-edit" onclick="admin.editNews(${article.id})" title="Bewerken">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn btn-icon btn-delete" onclick="admin.deleteNews(${article.id}, '${article.title}')" title="Verwijderen">
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
    }

    async showCreateNewsModal() {
        // First load organizations for the dropdown
        let organizations = [];
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                organizations = data.organizations || [];
            }
        } catch (error) {
            console.error('Error loading organizations:', error);
        }

        const categories = ['dorpsnieuws', 'sport', 'cultuur', 'onderwijs', 'zorg', 'overig'];
        
        const modalHTML = `
            <div class="modal-overlay">
                <div class="modal-content large">
                    <div class="modal-header">
                        <h3>Nieuw Nieuws Artikel</h3>
                        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="createNewsForm" class="edit-form">
                            <div class="form-group">
                                <label for="createNewsTitle">Titel *</label>
                                <input type="text" id="createNewsTitle" name="title" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="createNewsExcerpt">Samenvatting</label>
                                <textarea id="createNewsExcerpt" name="excerpt" rows="3" placeholder="Korte samenvatting van het artikel..."></textarea>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="createNewsCategory">Categorie</label>
                                    <select id="createNewsCategory" name="category" onchange="admin.toggleCreateCustomCategory()">
                                        ${categories.map(cat => `
                                            <option value="${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="form-group" id="createCustomCategoryGroup" style="display: none;">
                                    <label for="createNewsCustomCategory">Aangepaste Categorie</label>
                                    <input type="text" id="createNewsCustomCategory" name="custom_category" placeholder="Voer eigen categorie in...">
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="createNewsOrganization">Organisatie (optioneel)</label>
                                <select id="createNewsOrganization" name="organization_id">
                                    <option value="">Geen organisatie</option>
                                    ${organizations.map(org => `
                                        <option value="${org.id}">${org.name}</option>
                                    `).join('')}
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label>Afbeelding</label>
                                <div class="profile-image-section">
                                    <div class="image-options">
                                        <div class="option-tabs">
                                            <button type="button" class="tab-btn active" onclick="admin.switchImageTab('url')">URL</button>
                                            <button type="button" class="tab-btn" onclick="admin.switchImageTab('upload')">Upload</button>
                                        </div>
                                        <div class="tab-content">
                                            <div id="url-tab" class="tab-pane active">
                                                <input type="url" id="createNewsImage" name="image_url" placeholder="https://...">
                                            </div>
                                            <div id="upload-tab" class="tab-pane">
                                                <input type="file" id="createNewsImageUpload" name="image_file" accept="image/*" onchange="admin.previewUploadedImage(this)">
                                                <div id="uploadPreview" class="upload-preview" style="display: none;">
                                                    <img id="uploadedImagePreview" src="" alt="Preview" class="preview-img">
                                                    <button type="button" class="btn btn-sm btn-secondary" onclick="admin.clearUploadPreview()">Verwijder</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="createNewsContent">Inhoud *</label>
                                <textarea id="createNewsContent" name="content" rows="10" required></textarea>
                            </div>
                            
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="createNewsPublished" name="is_published" checked>
                                    Direct publiceren
                                </label>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuleren</button>
                        <button class="btn btn-primary" onclick="admin.createNews()">Artikel Aanmaken</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    toggleCreateCustomCategory() {
        const categorySelect = document.getElementById('createNewsCategory');
        const customGroup = document.getElementById('createCustomCategoryGroup');
        
        if (categorySelect.value === 'overig') {
            customGroup.style.display = 'block';
        } else {
            customGroup.style.display = 'none';
        }
    }

    async createNews() {
        const form = document.getElementById('createNewsForm');
        const formData = new FormData(form);
        
        // Handle image upload
        const uploadedFile = document.getElementById('createNewsImageUpload').files[0];
        let imageUrl = formData.get('image_url') || null;
        
        if (uploadedFile) {
            try {
                const compressedBase64 = await this.compressAndConvertToBase64(uploadedFile);
                imageUrl = compressedBase64;
                console.log('Image compressed and converted to base64, length:', compressedBase64.length);
                
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

        const newsData = {
            title: formData.get('title'),
            content: formData.get('content'),
            excerpt: formData.get('excerpt') || null,
            category: formData.get('category'),
            custom_category: formData.get('custom_category') || null,
            organization_id: formData.get('organization_id') || null,
            image_url: imageUrl,
            is_published: document.getElementById('createNewsPublished').checked
        };

        try {
            const response = await fetch(`${this.apiBaseUrl}/news`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(newsData)
            });

            if (response.ok) {
                this.showNotification('Nieuws artikel aangemaakt', 'success');
                document.querySelector('.modal-overlay').remove();
                this.loadNews();
            } else {
                let errorMessage = 'Onbekende fout';
                try {
                    const error = await response.json();
                    console.error('Create error response:', error);
                    errorMessage = error.message || error.error || 'Onbekende fout';
                } catch (parseError) {
                    console.error('Error parsing response:', parseError);
                    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }
                this.showNotification(`Fout bij aanmaken: ${errorMessage}`, 'error');
            }
        } catch (error) {
            console.error('Error creating news:', error);
            this.showNotification('Fout bij aanmaken nieuws artikel', 'error');
        }
    }

    async viewNews(newsId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/news`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const article = data.news.find(n => n.id === newsId);
                
                if (article) {
                    this.showNewsModal(article);
                } else {
                    this.showNotification('Nieuws artikel niet gevonden', 'error');
                }
            } else {
                this.showNotification('Fout bij laden nieuws artikel', 'error');
            }
        } catch (error) {
            console.error('Error viewing news:', error);
            this.showNotification('Fout bij laden nieuws artikel', 'error');
        }
    }

    showNewsModal(article) {
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
                        <span>${new Date(article.created_at).toLocaleDateString('nl-NL')}</span>
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

    async editNews(newsId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/news`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const article = data.news.find(n => n.id === newsId);
                
                if (article) {
                    this.showEditNewsModal(article);
                } else {
                    this.showNotification('Nieuws artikel niet gevonden', 'error');
                }
            } else {
                this.showNotification('Fout bij laden nieuws artikel', 'error');
            }
        } catch (error) {
            console.error('Error editing news:', error);
            this.showNotification('Fout bij laden nieuws artikel', 'error');
        }
    }

    showEditNewsModal(article) {
        const categories = ['dorpsnieuws', 'sport', 'cultuur', 'onderwijs', 'zorg', 'overig'];
        
        const modalHTML = `
            <div class="modal-overlay">
                <div class="modal-content large">
                    <div class="modal-header">
                        <h3>Nieuws Bewerken</h3>
                        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="editNewsForm" class="edit-form">
                            <div class="form-group">
                                <label for="editNewsTitle">Titel *</label>
                                <input type="text" id="editNewsTitle" name="title" value="${article.title}" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="editNewsExcerpt">Samenvatting</label>
                                <textarea id="editNewsExcerpt" name="excerpt" rows="3" placeholder="Korte samenvatting van het artikel...">${article.excerpt || ''}</textarea>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="editNewsCategory">Categorie</label>
                                    <select id="editNewsCategory" name="category" onchange="admin.toggleCustomCategory()">
                                        ${categories.map(cat => `
                                            <option value="${cat}" ${cat === article.category ? 'selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="form-group" id="customCategoryGroup" style="display: ${article.category === 'overig' ? 'block' : 'none'};">
                                    <label for="editNewsCustomCategory">Aangepaste Categorie</label>
                                    <input type="text" id="editNewsCustomCategory" name="custom_category" value="${article.custom_category || ''}" placeholder="Voer eigen categorie in...">
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label>Afbeelding</label>
                                <div class="profile-image-section">
                                    <div class="current-image">
                                        <label>Huidige afbeelding:</label>
                                        <div class="current-image-preview">
                                            ${article.image_url && article.image_url !== '' ? 
                                                `<img src="${article.image_url}" alt="Huidige afbeelding" class="preview-img">` : 
                                                `<div class="preview-placeholder">
                                                    <i class="fas fa-image"></i>
                                                    <span>Geen afbeelding</span>
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
                                                <input type="url" id="editNewsImage" name="image_url" value="${article.image_url || ''}" placeholder="https://...">
                                            </div>
                                            <div id="upload-tab" class="tab-pane">
                                                <input type="file" id="newsImageUpload" name="image_file" accept="image/*" onchange="admin.previewUploadedImage(this)">
                                                <div id="uploadPreview" class="upload-preview" style="display: none;">
                                                    <img id="uploadedImagePreview" src="" alt="Preview" class="preview-img">
                                                    <button type="button" class="btn btn-sm btn-secondary" onclick="admin.clearUploadPreview()">Verwijder</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="editNewsContent">Inhoud *</label>
                                <textarea id="editNewsContent" name="content" rows="10" required>${article.content}</textarea>
                            </div>
                            
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="editNewsPublished" name="is_published" ${article.is_published ? 'checked' : ''}>
                                    Gepubliceerd
                                </label>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuleren</button>
                        <button class="btn btn-primary" onclick="admin.saveNewsChanges(${article.id})">Opslaan</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    toggleCustomCategory() {
        const categorySelect = document.getElementById('editNewsCategory');
        const customGroup = document.getElementById('customCategoryGroup');
        
        if (categorySelect.value === 'overig') {
            customGroup.style.display = 'block';
        } else {
            customGroup.style.display = 'none';
        }
    }

    async saveNewsChanges(newsId) {
        const form = document.getElementById('editNewsForm');
        const formData = new FormData(form);
        
        // Handle image upload
        const uploadedFile = document.getElementById('newsImageUpload').files[0];
        let imageUrl = formData.get('image_url') || null;
        
        if (uploadedFile) {
            try {
                const compressedBase64 = await this.compressAndConvertToBase64(uploadedFile);
                imageUrl = compressedBase64;
                console.log('Image compressed and converted to base64, length:', compressedBase64.length);
                
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

        const newsData = {
            title: formData.get('title'),
            content: formData.get('content'),
            excerpt: formData.get('excerpt') || null,
            category: formData.get('category'),
            custom_category: formData.get('custom_category') || null,
            image_url: imageUrl,
            is_published: document.getElementById('editNewsPublished').checked
        };

        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/news/${newsId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(newsData)
            });

            if (response.ok) {
                this.showNotification('Nieuws artikel bijgewerkt', 'success');
                document.querySelector('.modal-overlay').remove();
                this.loadNews();
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
            console.error('Error updating news:', error);
            this.showNotification('Fout bij bijwerken nieuws artikel', 'error');
        }
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

    async loadEvents() {
        try {
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
        } catch (error) {
            console.error('Error loading events:', error);
            const container = document.getElementById('eventsContent');
            if (container) container.innerHTML = '<p>Fout bij laden events.</p>';
        }
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
                        <button class="btn-icon btn-view" onclick="admin.viewEvent(${ev.id}, ${JSON.stringify(ev).replace(/"/g, '&quot;')})" title="Bekijken">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon btn-edit" onclick="admin.editEvent(${ev.id})" title="Bewerken">
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

    async viewEvent(id, eventData = null) {
        try {
            let event;
            if (eventData) {
                // Gebruik de doorgegeven event data
                event = eventData;
            } else {
                // Fallback: haal event data op via API
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
                document.querySelector('.modal-overlay').remove();
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
        document.body.appendChild(modalOverlay);
    }

    async loadFoundLost() {
        document.getElementById('foundLostContent').innerHTML = '<p class="text-muted">Gevonden/Verloren sectie - Wordt geïmplementeerd</p>';
    }

    async loadModeration() {
        try {
            const container = document.getElementById('moderationContent');
            if (!container) return;

            // Toon loading state
            container.innerHTML = '<div class="loading-spinner">Laden...</div>';

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
        } catch (error) {
            console.error('Error loading moderation content:', error);
            document.getElementById('moderationContent').innerHTML = '<p class="text-muted">Fout bij laden moderatie content</p>';
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
                            <small>${new Date(article.created_at).toLocaleDateString('nl-NL')}</small>
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
                        organizations = orgData.organizations || [];
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
                    if (startEl.value) {
                        endEl.min = startEl.value;
                        if (!endEl.value || endEl.value < startEl.value) {
                            endEl.value = startEl.value;
                        }
                    }
                };
                startEl.addEventListener('change', syncEnd);
                syncEnd();
            }
        } catch (e) {
            console.error('openEventModal error:', e);
            this.showNotification('Fout bij openen event-modal', 'error');
        }
    }

    async saveEvent(eventId) {
        try {
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
                    imageUrl = compressedBase64;
                    console.log('Event image compressed and converted to base64, length:', compressedBase64.length);
                    
                    if (compressedBase64.length > 4 * 1024 * 1024) {
                        this.showNotification('Afbeelding is te groot. Kies een kleinere afbeelding.', 'error');
                        return;
                    }
                } catch (error) {
                    console.error('Error processing image:', error);
                    this.showNotification('Fout bij verwerken van afbeelding', 'error');
                    return;
                }
            } else {
                // Als er geen nieuwe afbeelding is geüpload, behoud de bestaande (bij edit)
                const existingImage = document.querySelector('#evImagePreviewImg')?.src;
                if (existingImage && existingImage.startsWith('data:image')) {
                    imageUrl = existingImage;
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

            // Parse eventId correct (kan 'null' string zijn)
            const actualEventId = eventId && eventId !== 'null' && eventId !== null ? parseInt(eventId) : null;
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
            document.querySelector('.modal-overlay')?.remove();
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
