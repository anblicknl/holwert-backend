// Holwert Dorpsapp Admin Panel
class HolwertAdmin {
    constructor() {
        this.apiBaseUrl = window.location.hostname === 'localhost'
            ? 'http://localhost:3000/api'
            : 'https://holwert-backend.vercel.app/api';
        this.token = localStorage.getItem('authToken');
        this.currentUser = null;
        this.demoMode = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
    }

    setupEventListeners() {
        // Login form
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout button
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.switchSection(e.currentTarget.dataset.section);
            });
        });

        // Modal close
        document.querySelector('.modal-close').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') {
                this.closeModal();
            }
        });

        // Add buttons
        document.getElementById('addUserBtn').addEventListener('click', () => {
            this.showAddUserModal();
        });

        document.getElementById('addOrganizationBtn').addEventListener('click', () => {
            this.showAddOrganizationModal();
        });

        document.getElementById('addNewsBtn').addEventListener('click', () => {
            this.showAddNewsModal();
        });

        document.getElementById('addEventBtn').addEventListener('click', () => {
            this.showAddEventModal();
        });

        document.getElementById('saveAfvalkalenderBtn').addEventListener('click', () => {
            this.saveAfvalkalender();
        });

        document.getElementById('afvalOudPapierType').addEventListener('change', (e) => {
            const isRecurring = e.target.value === 'recurring';
            document.getElementById('afvalOudPapierRecurring').style.display = isRecurring ? 'block' : 'none';
            document.getElementById('afvalOudPapierDates').style.display = isRecurring ? 'none' : 'block';
        });

        // Moderation tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchModerationTab(e.currentTarget.dataset.type);
            });
        });
    }

    async checkAuth() {
        if (this.token) {
            try {
                const response = await this.apiCall('/auth/me');
                if (response.user) {
                    this.currentUser = response.user;
                    this.showMainScreen();
                    this.loadDashboard();
                } else {
                    this.showLoginScreen();
                }
            } catch (error) {
                console.error('Auth check failed:', error);
                this.showLoginScreen();
            }
        } else {
            this.showLoginScreen();
        }
    }

    async handleLogin() {
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');
        const submitBtn = document.querySelector('#loginForm button[type="submit"]');

        // Clear previous errors
        errorDiv.classList.remove('show');
        errorDiv.textContent = '';

        // Demo mode login
        if (this.demoMode) {
            submitBtn.disabled = true;
            submitBtn.classList.add('loading');
            submitBtn.querySelector('span').textContent = 'Inloggen...';

            // Simulate API call delay
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Demo credentials
            if (email === 'admin@holwert.nl' && password === 'admin123') {
                this.token = 'demo-token';
                this.currentUser = {
                    id: 1,
                    email: 'admin@holwert.nl',
                    first_name: 'Super',
                    last_name: 'Admin',
                    role: 'superadmin'
                };
                localStorage.setItem('authToken', this.token);
                
                submitBtn.querySelector('span').textContent = 'Succesvol!';
                setTimeout(() => {
                    this.showMainScreen();
                    this.loadDemoDashboard();
                }, 500);
            } else {
                errorDiv.textContent = 'Demo login: gebruik admin@holwert.nl / admin123';
                errorDiv.classList.add('show');
            }

            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            submitBtn.querySelector('span').textContent = 'Inloggen';
            return;
        }

        // Real API login
        try {
            // Show loading state
            submitBtn.disabled = true;
            submitBtn.classList.add('loading');
            submitBtn.querySelector('span').textContent = 'Inloggen...';

            const response = await fetch(`${this.apiBaseUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                this.currentUser = data.user;
                localStorage.setItem('authToken', this.token);
                
                // Success animation
                submitBtn.querySelector('span').textContent = 'Succesvol!';
                setTimeout(() => {
                    this.showMainScreen();
                    this.loadDashboard();
                }, 500);
            } else {
                errorDiv.textContent = data.error || 'Login mislukt. Controleer je gegevens.';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            console.error('Login error:', error);
            errorDiv.textContent = 'Verbindingsfout. Controleer of de backend draait.';
            errorDiv.classList.add('show');
        } finally {
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            submitBtn.querySelector('span').textContent = 'Inloggen';
        }
    }

    handleLogout() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('authToken');
        this.showLoginScreen();
    }

    showLoginScreen() {
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('mainScreen').classList.remove('active');
    }

    showMainScreen() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        
        if (this.currentUser) {
            document.getElementById('userInfo').textContent = 
                `${this.currentUser.first_name} ${this.currentUser.last_name} (${this.currentUser.role})`;
        }
    }

    switchSection(sectionName) {
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(sectionName).classList.add('active');

        // Load section data
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
            case 'afvalkalender':
                this.loadAfvalkalender();
                break;
        }
    }

    async loadDashboard() {
        try {
            const stats = await this.apiCall('/admin/dashboard/stats');
            
            document.getElementById('totalUsers').textContent = stats.users.total_users;
            document.getElementById('totalOrganizations').textContent = stats.organizations.total_organizations;
            document.getElementById('totalNews').textContent = stats.content.published_news;
            document.getElementById('totalEvents').textContent = stats.content.published_events;

            // Load pending content
            const pending = await this.apiCall('/admin/moderation/pending');
            this.displayPendingContent(pending.pendingContent);
        } catch (error) {
            console.error('Failed to load dashboard:', error);
        }
    }

    loadDemoDashboard() {
        // Demo data
        document.getElementById('totalUsers').textContent = '24';
        document.getElementById('totalOrganizations').textContent = '8';
        document.getElementById('totalNews').textContent = '156';
        document.getElementById('totalEvents').textContent = '43';

        // Demo pending content
        const demoPending = [
            {
                id: 1,
                content_type: 'news',
                title: 'Nieuwe speeltuin geopend',
                first_name: 'Jan',
                last_name: 'de Vries',
                created_at: new Date().toISOString()
            },
            {
                id: 2,
                content_type: 'event',
                title: 'Dorpsfeest 2024',
                first_name: 'Maria',
                last_name: 'Jansen',
                created_at: new Date(Date.now() - 86400000).toISOString()
            },
            {
                id: 3,
                content_type: 'found-lost',
                title: 'Gevonden: Zwarte fiets',
                first_name: 'Piet',
                last_name: 'Bakker',
                created_at: new Date(Date.now() - 172800000).toISOString()
            }
        ];

        this.displayPendingContent(demoPending);
    }

    displayPendingContent(pendingContent) {
        const container = document.getElementById('pendingContent');
        
        if (pendingContent.length === 0) {
            container.innerHTML = '<p>Geen pending content.</p>';
            return;
        }

        container.innerHTML = pendingContent.map(item => `
            <div class="pending-item">
                <div class="pending-item-info">
                    <h4>${item.title}</h4>
                    <p>${item.content_type} - ${item.first_name} ${item.last_name}</p>
                </div>
                <div class="pending-item-actions">
                    <button class="btn btn-success btn-sm" onclick="admin.approveContent('${item.content_type}', ${item.id})">
                        <i class="fas fa-check"></i> Goedkeuren
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="admin.rejectContent('${item.content_type}', ${item.id})">
                        <i class="fas fa-times"></i> Afwijzen
                    </button>
                </div>
            </div>
        `).join('');
    }

    async loadUsers() {
        try {
            const users = await this.apiCall('/admin/users');
            this.displayUsers(users.users);
        } catch (error) {
            console.error('Failed to load users:', error);
        }
    }

    displayUsers(users) {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = users.map(user => `
            <tr>
                <td>${user.first_name} ${user.last_name}</td>
                <td>${user.email}</td>
                <td><span class="status-badge status-${user.role}">${user.role}</span></td>
                <td>${user.organization_name || '-'}</td>
                <td><span class="status-badge status-${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Actief' : 'Inactief'}</span></td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="admin.editUser(${user.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="admin.deleteUser(${user.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async loadOrganizations() {
        try {
            const orgs = await this.apiCall('/admin/organizations');
            console.log('Organizations response:', orgs);
            if (orgs.organizations && orgs.organizations.length > 0) {
                this.displayOrganizations(orgs.organizations);
            } else {
                console.log('No organizations found');
                const tbody = document.getElementById('organizationsTableBody');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="5">Geen organisaties gevonden</td></tr>';
                }
            }
        } catch (error) {
            console.error('Failed to load organizations:', error);
            const tbody = document.getElementById('organizationsTableBody');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="5">Fout bij laden: ${error.message || error}</td></tr>`;
            }
        }
    }

    displayOrganizations(organizations) {
        const tbody = document.getElementById('organizationsTableBody');
        tbody.innerHTML = organizations.map(org => `
            <tr>
                <td>${org.name}</td>
                <td>${org.category}</td>
                <td>${org.user_count}</td>
                <td><span class="status-badge status-${org.is_active ? 'active' : 'inactive'}">${org.is_active ? 'Actief' : 'Inactief'}</span></td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="admin.editOrganization(${org.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="admin.deleteOrganization(${org.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async loadNews() {
        try {
            const news = await this.apiCall('/news');
            this.displayNews(news.articles);
        } catch (error) {
            console.error('Failed to load news:', error);
        }
    }

    displayNews(articles) {
        const tbody = document.getElementById('newsTableBody');
        tbody.innerHTML = articles.map(article => `
            <tr>
                <td>${article.title}</td>
                <td>${article.first_name} ${article.last_name}</td>
                <td>${article.organization_name || '-'}</td>
                <td><span class="status-badge status-published">Gepubliceerd</span></td>
                <td>${new Date(article.published_at).toLocaleDateString('nl-NL')}</td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="admin.editNews(${article.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="admin.deleteNews(${article.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async loadEvents() {
        try {
            const events = await this.apiCall('/events');
            this.displayEvents(events.events);
        } catch (error) {
            console.error('Failed to load events:', error);
        }
    }

    displayEvents(events) {
        const tbody = document.getElementById('eventsTableBody');
        tbody.innerHTML = events.map(event => `
            <tr>
                <td>${event.title}</td>
                <td>${new Date(event.event_date).toLocaleDateString('nl-NL')} ${event.event_time}</td>
                <td>${event.location}</td>
                <td>${event.first_name} ${event.last_name}</td>
                <td><span class="status-badge status-published">Gepubliceerd</span></td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="admin.editEvent(${event.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="admin.deleteEvent(${event.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async loadFoundLost() {
        try {
            const items = await this.apiCall('/found-lost');
            this.displayFoundLost(items.items);
        } catch (error) {
            console.error('Failed to load found/lost items:', error);
        }
    }

    displayFoundLost(items) {
        const tbody = document.getElementById('foundLostTableBody');
        tbody.innerHTML = items.map(item => `
            <tr>
                <td><span class="status-badge status-${item.type}">${item.type === 'found' ? 'Gevonden' : 'Verloren'}</span></td>
                <td>${item.title}</td>
                <td>${item.location || '-'}</td>
                <td>${item.first_name} ${item.last_name}</td>
                <td><span class="status-badge status-approved">Goedgekeurd</span></td>
                <td>${new Date(item.created_at).toLocaleDateString('nl-NL')}</td>
                <td>
                    <button class="btn btn-sm btn-warning" onclick="admin.editFoundLost(${item.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="admin.deleteFoundLost(${item.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    async loadModeration() {
        try {
            const pending = await this.apiCall('/admin/moderation/pending');
            this.displayModerationContent(pending.pendingContent);
        } catch (error) {
            console.error('Failed to load moderation content:', error);
        }
    }

    displayModerationContent(pendingContent) {
        const container = document.getElementById('moderationContent');
        
        if (pendingContent.length === 0) {
            container.innerHTML = '<p>Geen content wachtend op goedkeuring.</p>';
            return;
        }

        container.innerHTML = pendingContent.map(item => `
            <div class="moderation-item">
                <div class="moderation-item-info">
                    <h4>${item.title}</h4>
                    <p>Type: ${item.content_type} | Auteur: ${item.first_name} ${item.last_name} | Datum: ${new Date(item.created_at).toLocaleDateString('nl-NL')}</p>
                </div>
                <div class="moderation-item-actions">
                    <button class="btn btn-success btn-sm" onclick="admin.approveContent('${item.content_type}', ${item.id})">
                        <i class="fas fa-check"></i> Goedkeuren
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="admin.rejectContent('${item.content_type}', ${item.id})">
                        <i class="fas fa-times"></i> Afwijzen
                    </button>
                </div>
            </div>
        `).join('');
    }

    switchModerationTab(type) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-type="${type}"]`).classList.add('active');
        
        // Filter content based on type
        this.loadModeration();
    }

    async approveContent(type, id) {
        try {
            await this.apiCall(`/admin/moderation/approve/${type}/${id}`, 'POST');
            this.showNotification('Content goedgekeurd!', 'success');
            this.loadModeration();
            this.loadDashboard();
        } catch (error) {
            console.error('Failed to approve content:', error);
            this.showNotification('Fout bij goedkeuren', 'error');
        }
    }

    async rejectContent(type, id) {
        try {
            await this.apiCall(`/admin/moderation/reject/${type}/${id}`, 'POST');
            this.showNotification('Content afgewezen!', 'success');
            this.loadModeration();
            this.loadDashboard();
        } catch (error) {
            console.error('Failed to reject content:', error);
            this.showNotification('Fout bij afwijzen', 'error');
        }
    }

    async loadAfvalkalender() {
        const msgEl = document.getElementById('afvalkalenderMessage');
        msgEl.textContent = '';
        try {
            const res = await this.apiCall('/admin/afvalkalender');
            const c = res.config || {};
            const op = c.oudPapier || {};
            const cont = c.containers || {};
            document.getElementById('afvalOudPapierType').value = op.type || 'recurring';
            document.getElementById('afvalOudPapierWeekday').value = op.weekday ?? 2;
            document.getElementById('afvalOudPapierInterval').value = op.interval_weeks ?? 6;
            document.getElementById('afvalOudPapierFirstDate').value = op.first_date || '';
            document.getElementById('afvalOudPapierDatesList').value = (op.dates || []).join('\n');
            document.getElementById('afvalContainersWeekday').value = cont.weekday ?? 5;
            document.getElementById('afvalContainersExtra').value = (cont.extra_dates || []).join('\n');
            const isRecurring = (op.type || 'recurring') === 'recurring';
            document.getElementById('afvalOudPapierRecurring').style.display = isRecurring ? 'block' : 'none';
            document.getElementById('afvalOudPapierDates').style.display = isRecurring ? 'none' : 'block';
        } catch (error) {
            msgEl.textContent = 'Kon afvalkalender niet laden: ' + (error.message || error);
            msgEl.className = 'form-message error';
        }
    }

    async saveAfvalkalender() {
        const msgEl = document.getElementById('afvalkalenderMessage');
        msgEl.textContent = '';
        const type = document.getElementById('afvalOudPapierType').value;
        const oudPapier = type === 'dates'
            ? { type: 'dates', dates: document.getElementById('afvalOudPapierDatesList').value.split('\n').map(s => s.trim()).filter(Boolean) }
            : {
                type: 'recurring',
                weekday: parseInt(document.getElementById('afvalOudPapierWeekday').value, 10) || 2,
                interval_weeks: parseInt(document.getElementById('afvalOudPapierInterval').value, 10) || 6,
                first_date: document.getElementById('afvalOudPapierFirstDate').value.trim() || new Date().toISOString().slice(0, 10)
            };
        const extraText = document.getElementById('afvalContainersExtra').value.split('\n').map(s => s.trim()).filter(Boolean);
        const containers = {
            weekday: parseInt(document.getElementById('afvalContainersWeekday').value, 10) || 5,
            extra_dates: extraText
        };
        try {
            await this.apiCall('/admin/afvalkalender', 'PUT', { oudPapier, containers });
            msgEl.textContent = 'Afvalkalender opgeslagen. De app toont de nieuwe datums na vernieuwen.';
            msgEl.className = 'form-message success';
        } catch (error) {
            msgEl.textContent = 'Opslaan mislukt: ' + (error.message || error);
            msgEl.className = 'form-message error';
        }
    }

    showAddUserModal() {
        this.showModal('Nieuwe Gebruiker', `
            <form id="addUserForm">
                <div class="form-group">
                    <label for="userEmail">E-mailadres</label>
                    <input type="email" id="userEmail" required>
                </div>
                <div class="form-group">
                    <label for="userPassword">Wachtwoord</label>
                    <input type="password" id="userPassword" required>
                </div>
                <div class="form-group">
                    <label for="userFirstName">Voornaam</label>
                    <input type="text" id="userFirstName" required>
                </div>
                <div class="form-group">
                    <label for="userLastName">Achternaam</label>
                    <input type="text" id="userLastName" required>
                </div>
                <div class="form-group">
                    <label for="userRole">Rol</label>
                    <select id="userRole" required>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                        <option value="superadmin">Superadmin</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="userPhone">Telefoon</label>
                    <input type="tel" id="userPhone">
                </div>
                <div class="form-group">
                    <label for="userAddress">Adres</label>
                    <textarea id="userAddress"></textarea>
                </div>
                <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1rem;">
                    <button type="button" class="btn btn-secondary" onclick="admin.closeModal()">Annuleren</button>
                    <button type="submit" class="btn btn-primary">Gebruiker Aanmaken</button>
                </div>
            </form>
        `);

        document.getElementById('addUserForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createUser();
        });
    }

    async createUser() {
        try {
            const userData = {
                email: document.getElementById('userEmail').value,
                password: document.getElementById('userPassword').value,
                firstName: document.getElementById('userFirstName').value,
                lastName: document.getElementById('userLastName').value,
                role: document.getElementById('userRole').value,
                phone: document.getElementById('userPhone').value,
                address: document.getElementById('userAddress').value
            };

            await this.apiCall('/admin/users', 'POST', userData);
            this.showNotification('Gebruiker aangemaakt!', 'success');
            this.closeModal();
            this.loadUsers();
        } catch (error) {
            console.error('Failed to create user:', error);
            this.showNotification('Fout bij aanmaken gebruiker', 'error');
        }
    }

    showAddOrganizationModal() {
        this.showModal('Nieuwe Organisatie', `
            <form id="addOrganizationForm">
                <div class="form-group">
                    <label for="orgName">Naam</label>
                    <input type="text" id="orgName" required>
                </div>
                <div class="form-group">
                    <label for="orgDescription">Beschrijving</label>
                    <textarea id="orgDescription"></textarea>
                </div>
                <div class="form-group">
                    <label for="orgCategory">Categorie</label>
                    <select id="orgCategory" required>
                        <option value="gemeente">Gemeente</option>
                        <option value="natuur">Natuur</option>
                        <option value="cultuur">Cultuur</option>
                        <option value="sport">Sport</option>
                        <option value="onderwijs">Onderwijs</option>
                        <option value="zorg">Zorg</option>
                        <option value="overig">Overig</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="orgWebsite">Website</label>
                    <input type="url" id="orgWebsite">
                </div>
                <div class="form-group">
                    <label for="orgEmail">E-mail</label>
                    <input type="email" id="orgEmail">
                </div>
                <div class="form-group">
                    <label for="orgPhone">Telefoon</label>
                    <input type="tel" id="orgPhone">
                </div>
                <div class="form-group">
                    <label for="orgAddress">Adres</label>
                    <textarea id="orgAddress"></textarea>
                </div>
                <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 1rem;">
                    <button type="button" class="btn btn-secondary" onclick="admin.closeModal()">Annuleren</button>
                    <button type="submit" class="btn btn-primary">Organisatie Aanmaken</button>
                </div>
            </form>
        `);

        document.getElementById('addOrganizationForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createOrganization();
        });
    }

    async createOrganization() {
        try {
            const orgData = {
                name: document.getElementById('orgName').value,
                description: document.getElementById('orgDescription').value,
                category: document.getElementById('orgCategory').value,
                website: document.getElementById('orgWebsite').value,
                email: document.getElementById('orgEmail').value,
                phone: document.getElementById('orgPhone').value,
                address: document.getElementById('orgAddress').value
            };

            await this.apiCall('/admin/organizations', 'POST', orgData);
            this.showNotification('Organisatie aangemaakt!', 'success');
            this.closeModal();
            this.loadOrganizations();
        } catch (error) {
            console.error('Failed to create organization:', error);
            this.showNotification('Fout bij aanmaken organisatie', 'error');
        }
    }

    showModal(title, content) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = content;
        document.getElementById('modalOverlay').classList.add('active');
    }

    closeModal() {
        document.getElementById('modalOverlay').classList.remove('active');
    }

    showLoading() {
        document.getElementById('loadingSpinner').classList.add('active');
    }

    hideLoading() {
        document.getElementById('loadingSpinner').classList.remove('active');
    }

    showNotification(message, type = 'info') {
        // Simple notification - you could enhance this with a proper notification system
        alert(message);
    }

    async apiCall(endpoint, method = 'GET', data = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (this.token) {
            options.headers['Authorization'] = `Bearer ${this.token}`;
        }

        if (data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(`${this.apiBaseUrl}${endpoint}`, options);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'API call failed');
        }

        return await response.json();
    }
}

// Initialize the admin panel when the page loads
const admin = new HolwertAdmin();
