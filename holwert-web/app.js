class HolwertAdmin {
    constructor() {
        // Use production API if available, otherwise localhost
        this.apiBaseUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000/api'
            : 'https://holwert-backend-production.up.railway.app/api';
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
        if (this.token) {
            this.showMainScreen();
            this.loadDashboard();
        } else {
            this.showLoginScreen();
        }
    }

    showLoginScreen() {
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('mainScreen').classList.remove('active');
    }

    showMainScreen() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
    }

    async handleLogin() {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');
        const submitBtn = document.querySelector('#loginForm button[type="submit"]');

        // Clear previous errors and field highlights
        errorDiv.classList.remove('show');
        errorDiv.innerHTML = '';
        this.clearFieldErrors();

        // Basic validation
        if (!email || !password) {
            this.showFieldError('email', !email ? 'E-mailadres is vereist' : '');
            this.showFieldError('password', !password ? 'Wachtwoord is vereist' : '');
            this.showError('Vul alle velden in');
            return;
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            this.showFieldError('email', 'Ongeldig e-mailadres formaat');
            this.showError('Controleer het e-mailadres formaat');
            return;
        }

        // Show loading state
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
        const span = submitBtn.querySelector('span');
        if (span) span.textContent = 'Inloggen...';

        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                this.currentUser = data.user;
                localStorage.setItem('authToken', this.token);
                
                if (span) span.textContent = 'Succesvol!';
                setTimeout(() => {
                    this.showMainScreen();
                    this.loadDashboard();
                }, 500);
            } else {
                // Handle specific error types
                this.handleLoginError(data, email, password);
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Verbindingsfout: ' + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            if (span) span.textContent = 'Inloggen';
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
        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');

        // Show section content
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(sectionName).classList.add('active');

        // Load section data
        this.loadSectionData(sectionName);
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
            // Load dashboard statistics from original admin routes
            const [usersRes, orgsRes, newsRes, eventsRes] = await Promise.all([
                fetch(`${this.apiBaseUrl}/admin/stats/users`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                }),
                fetch(`${this.apiBaseUrl}/admin/stats/organizations`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                }),
                fetch(`${this.apiBaseUrl}/admin/stats/news`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                }),
                fetch(`${this.apiBaseUrl}/admin/stats/events`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                })
            ]);

            if (usersRes.ok) {
                const usersData = await usersRes.json();
                document.getElementById('totalUsers').textContent = usersData.count || 0;
            }

            if (orgsRes.ok) {
                const orgsData = await orgsRes.json();
                document.getElementById('totalOrganizations').textContent = orgsData.count || 0;
            }

            if (newsRes.ok) {
                const newsData = await newsRes.json();
                document.getElementById('totalNews').textContent = newsData.count || 0;
            }

            if (eventsRes.ok) {
                const eventsData = await eventsRes.json();
                document.getElementById('totalEvents').textContent = eventsData.count || 0;
            }

            // Load pending content
            this.loadPendingContent();
            this.loadRecentActivity();

        } catch (error) {
            console.error('Error loading dashboard:', error);
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

    // Content moderation functions (placeholder for now)
    async approveContent(type, id) {
        this.showNotification('Goedkeuren functionaliteit wordt geïmplementeerd', 'info');
    }

    async rejectContent(type, id) {
        this.showNotification('Afwijzen functionaliteit wordt geïmplementeerd', 'info');
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
            const response = await fetch(`${this.apiBaseUrl}/admin/users`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayUsers(data.users);
            } else {
                console.error('Failed to load users');
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
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Naam</th>
                            <th>E-mail</th>
                            <th>Rol</th>
                            <th>Organisatie</th>
                            <th>Status</th>
                            <th>Acties</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map(user => `
                            <tr>
                                <td>${user.first_name} ${user.last_name}</td>
                                <td>${user.email}</td>
                                <td><span class="role-badge role-${user.role}">${user.role}</span></td>
                                <td>${user.organization_name || '-'}</td>
                                <td><span class="status-badge status-${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Actief' : 'Inactief'}</span></td>
                                <td>
                                    <button class="btn btn-sm btn-primary" onclick="admin.editUser(${user.id})">Bewerken</button>
                                    <button class="btn btn-sm btn-danger" onclick="admin.deleteUser(${user.id})">Verwijderen</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Organization management
    async loadOrganizations() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/admin/organizations`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.displayOrganizations(data.organizations);
            } else {
                console.error('Failed to load organizations');
            }
        } catch (error) {
            console.error('Error loading organizations:', error);
        }
    }

    displayOrganizations(organizations) {
        const container = document.getElementById('organizationsContent');
        if (!container) return;

        if (organizations.length === 0) {
            container.innerHTML = '<p class="text-muted">Geen organisaties gevonden</p>';
            return;
        }

        container.innerHTML = `
            <div class="organizations-grid">
                ${organizations.map(org => `
                    <div class="organization-card">
                        <h3>${org.name}</h3>
                        <p>${org.description || 'Geen beschrijving'}</p>
                        <div class="org-meta">
                            <span class="status-badge status-${org.is_active ? 'active' : 'inactive'}">${org.is_active ? 'Actief' : 'Inactief'}</span>
                            <span class="role-badge role-${org.type}">${org.type}</span>
                        </div>
                        <div class="org-actions">
                            <button class="btn btn-sm btn-primary" onclick="admin.editOrganization(${org.id})">Bewerken</button>
                            <button class="btn btn-sm btn-danger" onclick="admin.deleteOrganization(${org.id})">Verwijderen</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
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

        // Placeholder content for now
        container.innerHTML = `
            <div class="pending-item">
                <div class="content-icon">
                    <i class="fas fa-newspaper"></i>
                </div>
                <div class="content-info">
                    <div class="content-title">Nieuwe speeltuin geopend</div>
                    <div class="content-meta">Door Jan de Vries • 2 uur geleden</div>
                </div>
                <div class="content-actions">
                    <button class="btn btn-sm btn-primary" onclick="admin.approveContent('news', 1)">
                        Goedkeuren
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="admin.rejectContent('news', 1)">
                        Afwijzen
                    </button>
                </div>
            </div>
        `;
    }

    // Load recent activity
    async loadRecentActivity() {
        const container = document.getElementById('recentActivity');
        if (!container) return;

        // Placeholder content for now
        container.innerHTML = `
            <div class="activity-item">
                <div class="content-icon">
                    <i class="fas fa-user-plus"></i>
                </div>
                <div class="content-info">
                    <div class="content-title">Nieuwe gebruiker geregistreerd</div>
                    <div class="content-meta">Lisa van der Berg • 1 uur geleden</div>
                </div>
            </div>
        `;
    }

    // Placeholder methods for other sections
    async loadNews() {
        document.getElementById('newsContent').innerHTML = '<p class="text-muted">Nieuws sectie - Wordt geïmplementeerd</p>';
    }

    async loadEvents() {
        document.getElementById('eventsContent').innerHTML = '<p class="text-muted">Evenementen sectie - Wordt geïmplementeerd</p>';
    }

    async loadFoundLost() {
        document.getElementById('foundLostContent').innerHTML = '<p class="text-muted">Gevonden/Verloren sectie - Wordt geïmplementeerd</p>';
    }

    async loadModeration() {
        document.getElementById('moderationContent').innerHTML = '<p class="text-muted">Moderatie sectie - Wordt geïmplementeerd</p>';
    }

    // Placeholder methods for user/organization management
    editUser(id) {
        this.showNotification('Gebruiker bewerken - Wordt geïmplementeerd', 'info');
    }

    deleteUser(id) {
        if (confirm('Weet je zeker dat je deze gebruiker wilt verwijderen?')) {
            this.showNotification('Gebruiker verwijderen - Wordt geïmplementeerd', 'info');
        }
    }

    editOrganization(id) {
        this.showNotification('Organisatie bewerken - Wordt geïmplementeerd', 'info');
    }

    deleteOrganization(id) {
        if (confirm('Weet je zeker dat je deze organisatie wilt verwijderen?')) {
            this.showNotification('Organisatie verwijderen - Wordt geïmplementeerd', 'info');
        }
    }
}

// Initialize admin when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.admin = new HolwertAdmin();
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
