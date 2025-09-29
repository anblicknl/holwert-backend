// API Configuration
const apiBaseUrl = 'https://holwert-backend.vercel.app/api';

// Global variables
let currentUser = null;
let authToken = null;

// DOM elements
const loginForm = document.getElementById('loginForm');
const dashboard = document.getElementById('dashboard');
const loginSection = document.getElementById('loginSection');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is already logged in
    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');
    
    if (savedToken && savedUser) {
        authToken = savedToken;
        currentUser = JSON.parse(savedUser);
        showDashboard();
    } else {
        showLogin();
    }
    
    // Setup event listeners
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // Login form
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Dashboard navigation
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', handleNavClick);
    });
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = document.querySelector('#loginForm button[type="submit"]');
    const loadingSpan = submitBtn.querySelector('span');
    
    // Clear previous errors
    clearFieldErrors();
    
    // Show loading state
    submitBtn.disabled = true;
    if (loadingSpan) {
        loadingSpan.textContent = 'Inloggen...';
    }
    
    try {
        const response = await fetch(`${apiBaseUrl}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Login successful
            authToken = data.token;
            currentUser = data.user;
            
            // Save to localStorage
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            // Show dashboard
            showDashboard();
            
            // Show success message
            showNotification('Succesvol ingelogd!', 'success');
            
        } else {
            // Login failed
            handleLoginError(data);
        }
        
    } catch (error) {
        console.error('Login error:', error);
        showError('Er is een fout opgetreden. Probeer het opnieuw.');
    } finally {
        // Reset button state
        submitBtn.disabled = false;
        if (loadingSpan) {
            loadingSpan.textContent = 'Inloggen';
        }
    }
}

// Handle login error
function handleLoginError(errorData) {
    if (errorData.field) {
        // Field-specific error
        showFieldError(errorData.field, errorData.message);
        if (errorData.suggestion) {
            showError(errorData.suggestion);
        }
    } else {
        // General error
        showError(errorData.message || 'Inloggen mislukt');
    }
}

// Show field error
function showFieldError(field, message) {
    const fieldElement = document.getElementById(field);
    if (fieldElement) {
        fieldElement.classList.add('error');
        
        // Add error message
        let errorDiv = fieldElement.parentNode.querySelector('.error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            fieldElement.parentNode.appendChild(errorDiv);
        }
        errorDiv.textContent = message;
    }
}

// Clear field errors
function clearFieldErrors() {
    const errorFields = document.querySelectorAll('.error');
    errorFields.forEach(field => field.classList.remove('error'));
    
    const errorMessages = document.querySelectorAll('.error-message');
    errorMessages.forEach(msg => msg.remove());
}

// Show general error
function showError(message) {
    showNotification(message, 'error');
}

// Handle logout
function handleLogout() {
    authToken = null;
    currentUser = null;
    
    // Clear localStorage
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    
    // Show login
    showLogin();
    
    // Show notification
    showNotification('Uitgelogd', 'info');
}

// Show login section
function showLogin() {
    if (loginSection) loginSection.style.display = 'block';
    if (dashboard) dashboard.style.display = 'none';
}

// Show dashboard
function showDashboard() {
    if (loginSection) loginSection.style.display = 'none';
    if (dashboard) dashboard.style.display = 'block';
    
    // Load dashboard data
    loadDashboard();
}

// Load dashboard data
async function loadDashboard() {
    try {
        // Load stats
        const [usersStats, orgsStats, newsStats, eventsStats] = await Promise.all([
            fetch(`${apiBaseUrl}/admin/stats/users`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }).then(res => res.json()),
            fetch(`${apiBaseUrl}/admin/stats/organizations`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }).then(res => res.json()),
            fetch(`${apiBaseUrl}/admin/stats/news`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }).then(res => res.json()),
            fetch(`${apiBaseUrl}/admin/stats/events`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            }).then(res => res.json())
        ]);
        
        // Update stats display
        updateStatsDisplay(usersStats, orgsStats, newsStats, eventsStats);
        
        // Load pending content
        loadPendingContent();
        
        // Load recent activity
        loadRecentActivity();
        
    } catch (error) {
        console.error('Dashboard load error:', error);
        showNotification('Fout bij laden dashboard', 'error');
    }
}

// Update stats display
function updateStatsDisplay(users, orgs, news, events) {
    const statsElements = {
        users: document.querySelector('.stat-card[data-type="users"] .stat-number'),
        organizations: document.querySelector('.stat-card[data-type="organizations"] .stat-number'),
        news: document.querySelector('.stat-card[data-type="news"] .stat-number'),
        events: document.querySelector('.stat-card[data-type="events"] .stat-number')
    };
    
    if (statsElements.users) statsElements.users.textContent = users.count || 0;
    if (statsElements.organizations) statsElements.organizations.textContent = orgs.count || 0;
    if (statsElements.news) statsElements.news.textContent = news.count || 0;
    if (statsElements.events) statsElements.events.textContent = events.count || 0;
}

// Load pending content
async function loadPendingContent() {
    // Placeholder for pending content
    const pendingContent = document.getElementById('pendingContent');
    if (pendingContent) {
        pendingContent.innerHTML = `
            <div class="pending-item">
                <i class="fas fa-user"></i>
                <span>Nieuwe gebruiker registratie</span>
                <div class="actions">
                    <button onclick="approveContent('user', 1)" class="btn-approve">
                        <i class="fas fa-check"></i>
                    </button>
                    <button onclick="rejectContent('user', 1)" class="btn-reject">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    }
}

// Load recent activity
async function loadRecentActivity() {
    // Placeholder for recent activity
    const recentActivity = document.getElementById('recentActivity');
    if (recentActivity) {
        recentActivity.innerHTML = `
            <div class="activity-item">
                <i class="fas fa-newspaper"></i>
                <span>Nieuw nieuwsbericht toegevoegd</span>
                <small>2 minuten geleden</small>
            </div>
        `;
    }
}

// Handle navigation click
function handleNavClick(e) {
    e.preventDefault();
    
    const target = e.currentTarget.getAttribute('data-target');
    const navItems = document.querySelectorAll('.nav-item');
    
    // Remove active class from all items
    navItems.forEach(item => item.classList.remove('active'));
    
    // Add active class to clicked item
    e.currentTarget.classList.add('active');
    
    // Show corresponding content
    showContent(target);
}

// Show content based on navigation
function showContent(target) {
    const contentSections = document.querySelectorAll('.content-section');
    contentSections.forEach(section => {
        section.style.display = 'none';
    });
    
    const targetSection = document.getElementById(target);
    if (targetSection) {
        targetSection.style.display = 'block';
        
        // Load content based on target
        switch (target) {
            case 'dashboard':
                loadDashboard();
                break;
            case 'users':
                loadUsers();
                break;
            case 'organizations':
                loadOrganizations();
                break;
            case 'news':
                loadNews();
                break;
            case 'events':
                loadEvents();
                break;
            case 'found-lost':
                loadFoundLost();
                break;
            case 'moderation':
                loadModeration();
                break;
        }
    }
}

// Content loading functions (placeholders)
async function loadUsers() {
    showNotification('Gebruikers laden...', 'info');
}

async function loadOrganizations() {
    showNotification('Organisaties laden...', 'info');
}

async function loadNews() {
    showNotification('Nieuws laden...', 'info');
}

async function loadEvents() {
    showNotification('Evenementen laden...', 'info');
}

async function loadFoundLost() {
    showNotification('Gevonden/Verloren laden...', 'info');
}

async function loadModeration() {
    showNotification('Moderatie laden...', 'info');
}

// Approve content
function approveContent(type, id) {
    showNotification(`${type} goedgekeurd`, 'success');
}

// Reject content
function rejectContent(type, id) {
    showNotification(`${type} afgewezen`, 'info');
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">&times;</button>
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

// Admin object for external access
window.admin = {
    approveContent,
    rejectContent,
    loadUsers,
    loadOrganizations,
    loadNews,
    loadEvents,
    loadFoundLost,
    loadModeration
};
