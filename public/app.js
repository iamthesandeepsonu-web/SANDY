// State Management
const state = {
  token: localStorage.getItem('admin_token') || '',
  user: null,
  currentView: 'overview',
  services: [],
  validities: [],
  ldProducts: [],
  mappings: [],
  maintenance: { enabled: false, message: '' }
};

// API Helper
async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const res = await fetch(`/api${endpoint}`, {
      ...options,
      headers
    });

    if (res.status === 401) {
      handleLogout();
      throw new Error('Session expired. Please log in again.');
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    throw err;
  }
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.add('hidden');
}

function openModal(modalId) {
  document.getElementById(modalId)?.classList.remove('hidden');
}

// Initialization & Auth
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  if (!state.token) {
    showLoginView();
    return;
  }

  try {
    const res = await api('/auth/status');
    if (res.success && res.authenticated) {
      state.user = res.user;
      showAppLayout();
      loadViewData(state.currentView);
    } else {
      showLoginView();
    }
  } catch {
    showLoginView();
  }
}

function showLoginView() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-layout').classList.add('hidden');
}

function showAppLayout() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');
  if (state.user) {
    document.getElementById('current-admin-name').textContent = state.user.username || 'Administrator';
  }
}

function handleLogout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('admin_token');
  showLoginView();
}

// Navigation
function switchView(viewName) {
  state.currentView = viewName;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `view-${viewName}`);
  });

  const titles = {
    overview: { title: 'Overview Dashboard', sub: 'Real-time store statistics and quick metrics' },
    services: { title: 'Services & Validities', sub: 'Manage products, validity plans, pricing, and stock visibility' },
    licenses: { title: 'License Stock Inventory', sub: 'Upload bulk keys and manage available license codes' },
    'ld-api': { title: 'API / License Provider', sub: 'Manage License Dashboard connection, balance, and external mapping' },
    payments: { title: 'Payment Gateways & Top-Ups', sub: 'Configure Binance Pay, UPI Auto QR, and verify top-ups' },
    orders: { title: 'Orders & Fulfillment History', sub: 'Audit and inspect all customer digital license purchases' },
    users: { title: 'User & Wallet Management', sub: 'Search users, inspect balances, adjust credits, and view history' },
    maintenance: { title: 'Maintenance Mode', sub: 'Instantly pause shopping flows with custom notice messages' }
  };

  const meta = titles[viewName] || { title: 'Admin Dashboard', sub: '' };
  document.getElementById('page-title').textContent = meta.title;
  document.getElementById('page-subtitle').textContent = meta.sub;

  loadViewData(viewName);
}

function loadViewData(viewName) {
  switch (viewName) {
    case 'overview':
      loadOverviewData();
      break;
    case 'services':
      loadServicesData();
      break;
    case 'licenses':
      loadLicensesData();
      loadServicesForFilters();
      break;
    case 'ld-api':
      loadLdApiData();
      break;
    case 'payments':
      loadPaymentsData();
      break;
    case 'orders':
      loadOrdersData();
      break;
    case 'users':
      loadUsersData();
      break;
    case 'maintenance':
      loadMaintenanceData();
      break;
  }
}

// 1. OVERVIEW VIEW
async function loadOverviewData() {
  try {
    const data = await api('/stats/overview');
    if (!data.success) return;

    const stats = data.stats;
    document.getElementById('stat-revenue').textContent = `₹${stats.totalRevenue.toFixed(2)}`;
    document.getElementById('stat-orders').textContent = stats.totalOrders.toLocaleString();
    document.getElementById('stat-users').textContent = stats.totalUsers.toLocaleString();
    document.getElementById('stat-available-stock').textContent = stats.availableStock.toLocaleString();

    // Update maintenance chip in header
    const maintBadge = document.getElementById('maintenance-badge');
    if (stats.maintenanceEnabled) {
      maintBadge.className = 'status-chip chip-danger';
      maintBadge.innerHTML = '<span class="pulse-dot"></span><span>Maintenance Mode ON</span>';
    } else {
      maintBadge.className = 'status-chip chip-success';
      maintBadge.innerHTML = '<span class="pulse-dot"></span><span>Store Live</span>';
    }

    // Render Recent Orders
    const ordersTbody = document.getElementById('overview-recent-orders');
    if (data.recentOrders && data.recentOrders.length > 0) {
      ordersTbody.innerHTML = data.recentOrders.map(o => `
        <tr>
          <td><code>${escapeHtml(o.id)}</code></td>
          <td>${escapeHtml(o.user_username ? '@' + o.user_username : o.telegram_id)}</td>
          <td><strong>${escapeHtml(o.service_name)}</strong> <small class="text-muted">(${escapeHtml(o.validity_name)})</small></td>
          <td><strong>₹${o.price_paid.toFixed(2)}</strong></td>
          <td><span class="badge ${o.fulfillment_type === 'LOCAL' ? 'badge-success' : 'badge-info'}">${o.fulfillment_type}</span></td>
          <td><small class="text-muted">${new Date(o.created_at).toLocaleTimeString()}</small></td>
        </tr>
      `).join('');
    } else {
      ordersTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No orders placed yet.</td></tr>';
    }

    // Render Recent Payments
    const payTbody = document.getElementById('overview-recent-payments');
    if (data.recentPayments && data.recentPayments.length > 0) {
      payTbody.innerHTML = data.recentPayments.map(p => `
        <tr>
          <td><code>${escapeHtml(p.reference_id)}</code></td>
          <td><span class="badge badge-purple">${p.payment_method}</span></td>
          <td><strong>₹${p.amount.toFixed(2)}</strong></td>
          <td><span class="badge ${p.status === 'COMPLETED' ? 'badge-success' : (p.status === 'PENDING' ? 'badge-warning' : 'badge-danger')}">${p.status}</span></td>
          <td><small class="text-muted">${new Date(p.created_at).toLocaleTimeString()}</small></td>
        </tr>
      `).join('');
    } else {
      payTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No payment transactions yet.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load overview data', 'error');
  }
}

// 2. SERVICES & VALIDITIES VIEW
async function loadServicesData() {
  try {
    const data = await api('/services');
    if (!data.success) return;

    state.services = data.services;
    const container = document.getElementById('services-catalog-container');

    if (state.services.length === 0) {
      container.innerHTML = `
        <div class="glass-card text-center p-5">
          <p class="text-muted">No services created yet. Click "Add New Service" above to add your first product!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = state.services.map(srv => {
      const validitiesHtml = srv.validities && srv.validities.length > 0 
        ? srv.validities.map(v => `
          <tr>
            <td><strong>${escapeHtml(v.name)}</strong></td>
            <td><code>${escapeHtml(v.id)}</code></td>
            <td><strong class="text-success">₹${v.price.toFixed(2)}</strong></td>
            <td>
              <span class="badge ${v.available_stock > 0 ? 'badge-success' : 'badge-warning'}">
                ${v.available_stock} Available
              </span>
              <small class="text-muted">(${v.used_stock} used)</small>
            </td>
            <td>
              ${v.is_api_mapped 
                ? `<span class="badge badge-info" title="Mapped to: ${escapeHtml(v.external_product_id)}"><i class="fa-solid fa-link"></i> Mapped: ${escapeHtml(v.external_product_id)}</span>` 
                : '<span class="badge badge-secondary">Local Only</span>'}
            </td>
            <td>
              <span class="badge ${v.is_active ? 'badge-success' : 'badge-danger'}">
                ${v.is_active ? 'Active' : 'Disabled'}
              </span>
            </td>
            <td>
              <button class="btn btn-sm btn-outline" onclick="editValidityModal('${srv.id}', '${v.id}')"><i class="fa-solid fa-pen"></i></button>
              <button class="btn btn-sm btn-danger" onclick="deleteValidity('${v.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        `).join('')
        : '<tr><td colspan="7" class="text-center text-muted">No validities created for this service yet.</td></tr>';

      return `
        <div class="service-card">
          <div class="service-card-header">
            <div class="service-title-meta">
              <div class="service-icon-box"><i class="fa-solid fa-gamepad"></i></div>
              <div>
                <h3>${escapeHtml(srv.name)} <small class="text-muted">(${escapeHtml(srv.id)})</small></h3>
                <p>${srv.description ? escapeHtml(srv.description) : 'No description'} • <strong>${srv.validities_count} Validities</strong> • <strong>${srv.available_licenses} Keys in Stock</strong></p>
              </div>
            </div>
            <div class="service-header-actions">
              <span class="badge ${srv.is_active ? 'badge-success' : 'badge-danger'}">${srv.is_active ? 'Visible' : 'Hidden'}</span>
              <button class="btn btn-sm btn-primary" onclick="openAddValidityModal('${srv.id}')">
                <i class="fa-solid fa-plus"></i> Add Validity
              </button>
              <button class="btn btn-sm btn-outline" onclick="editServiceModal('${srv.id}')">
                <i class="fa-solid fa-pen"></i> Edit
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteService('${srv.id}')">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
          <div class="validities-subtable-container">
            <div class="validities-subtable-header">
              <h4>Validity Pricing Plans & Stock</h4>
            </div>
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Validity Name</th>
                    <th>Validity ID</th>
                    <th>Price</th>
                    <th>Stock Count</th>
                    <th>API Fulfillment Status</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${validitiesHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load services', 'error');
  }
}

// 3. LICENSE STOCK VIEW
async function loadLicensesData() {
  const serviceId = document.getElementById('lic-filter-service').value;
  const validityId = document.getElementById('lic-filter-validity').value;
  const isUsed = document.getElementById('lic-filter-status').value;
  const search = document.getElementById('lic-filter-search').value;

  const params = new URLSearchParams();
  if (serviceId) params.append('serviceId', serviceId);
  if (validityId) params.append('validityId', validityId);
  if (isUsed !== '') params.append('isUsed', isUsed);
  if (search) params.append('search', search);

  try {
    const data = await api(`/licenses?${params.toString()}`);
    if (!data.success) return;

    const tbody = document.getElementById('licenses-table-body');
    if (data.licenses && data.licenses.length > 0) {
      tbody.innerHTML = data.licenses.map(l => `
        <tr>
          <td>#${l.id}</td>
          <td><strong>${escapeHtml(l.service_name || l.service_id)}</strong></td>
          <td>${escapeHtml(l.validity_name || l.validity_id)}</td>
          <td><code>${escapeHtml(l.license_key)}</code></td>
          <td>
            <span class="badge ${l.is_used === 0 ? 'badge-success' : 'badge-danger'}">
              ${l.is_used === 0 ? 'Available' : 'Delivered / Used'}
            </span>
          </td>
          <td>${l.used_by_order_id ? `<code>${escapeHtml(l.used_by_order_id)}</code>` : '<span class="text-muted">—</span>'}</td>
          <td><small class="text-muted">${new Date(l.added_at).toLocaleString()}</small></td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="deleteLicense(${l.id})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No licenses found matching current filter.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load licenses', 'error');
  }
}

async function loadServicesForFilters() {
  if (state.services.length === 0) {
    const data = await api('/services');
    if (data.success) state.services = data.services;
  }

  const srvSelect = document.getElementById('lic-filter-service');
  const bulkSrvSelect = document.getElementById('bulk-service-select');
  const mapSrvSelect = document.getElementById('map-service-select');

  const optionsHtml = '<option value="">Select Service</option>' + state.services.map(s => `
    <option value="${s.id}">${escapeHtml(s.name)} (${s.id})</option>
  `).join('');

  if (srvSelect) srvSelect.innerHTML = '<option value="">All Services</option>' + state.services.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (bulkSrvSelect) bulkSrvSelect.innerHTML = optionsHtml;
  if (mapSrvSelect) mapSrvSelect.innerHTML = optionsHtml;
}

// 4. API / LICENSE PROVIDER (LD API) VIEW
async function loadLdApiData() {
  try {
    const [cfgRes, diagRes, mapRes] = await Promise.all([
      api('/settings/ld'),
      api('/settings/ld/test', { method: 'POST' }),
      api('/settings/ld/mappings')
    ]);

    if (cfgRes.success) {
      document.getElementById('ld-endpoint-input').value = cfgRes.endpoint;
      if (cfgRes.tokenMasked) {
        document.getElementById('ld-token-input').placeholder = `Current token: ${cfgRes.tokenMasked}`;
      }
    }

    if (diagRes) {
      const isWorking = diagRes.success;
      const statusBadge = document.getElementById('ld-live-status-badge');
      statusBadge.className = `badge ${isWorking ? 'badge-success' : 'badge-danger'}`;
      statusBadge.textContent = isWorking ? 'API Connected / Working' : 'API Connection Failed';

      document.getElementById('diag-ld-status').textContent = diagRes.status || (isWorking ? 'Connected' : 'Failed');
      document.getElementById('diag-ld-balance').textContent = `$${(diagRes.balance || 0).toFixed(2)}`;
      document.getElementById('diag-ld-msg').textContent = diagRes.message || 'Status updated';
      document.getElementById('ld-balance-val').textContent = `$${(diagRes.balance || 0).toFixed(2)}`;
    }

    if (mapRes.success) {
      state.mappings = mapRes.mappings;
      renderMappingsTable();
    }
  } catch (err) {
    showToast('Failed to load LD API data', 'error');
  }
}

function renderMappingsTable() {
  const tbody = document.getElementById('api-mappings-table-body');
  if (state.mappings && state.mappings.length > 0) {
    tbody.innerHTML = state.mappings.map(m => `
      <tr>
        <td><strong>${escapeHtml(m.service_name || m.service_id)}</strong></td>
        <td>${escapeHtml(m.validity_name || m.validity_id)}</td>
        <td><code>${escapeHtml(m.external_product_id)}</code></td>
        <td>${escapeHtml(m.external_product_name || '—')}</td>
        <td><span class="badge ${m.is_enabled ? 'badge-success' : 'badge-danger'}">${m.is_enabled ? 'Active Mapped' : 'Disabled'}</span></td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="deleteMapping('${m.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No external API product mappings defined. Local stock will be used exclusively.</td></tr>';
  }
}

// 5. PAYMENTS & GATEWAYS VIEW
async function loadPaymentsData() {
  try {
    const [cfgRes, payRes] = await Promise.all([
      api('/settings/payments'),
      api('/payments?limit=100')
    ]);

    if (cfgRes.success) {
      if (cfgRes.binance) {
        document.getElementById('binance-api-key').value = cfgRes.binance.apiKeyMasked || '';
        document.getElementById('binance-merchant-id').value = cfgRes.binance.merchantId || '';
        document.getElementById('binance-bep20').value = cfgRes.binance.bep20Address || '';
        document.getElementById('binance-relay-url').value = cfgRes.binance.relayUrl || '';
      }
      if (cfgRes.upi) {
        document.getElementById('upi-vpa').value = cfgRes.upi.merchantVpa || '';
        document.getElementById('upi-name').value = cfgRes.upi.merchantName || '';
        document.getElementById('upi-secret').placeholder = cfgRes.upi.webhookSecretMasked ? `Secret: ${cfgRes.upi.webhookSecretMasked}` : 'Enter secret';
      }
    }

    if (payRes.success) {
      const tbody = document.getElementById('payments-table-body');
      if (payRes.payments && payRes.payments.length > 0) {
        tbody.innerHTML = payRes.payments.map(p => `
          <tr>
            <td><code>${escapeHtml(p.reference_id)}</code></td>
            <td><strong>${escapeHtml(p.user_name || p.telegram_id)}</strong></td>
            <td><span class="badge badge-purple">${p.payment_method}</span></td>
            <td><strong>₹${p.amount.toFixed(2)}</strong></td>
            <td><span class="badge ${p.status === 'COMPLETED' ? 'badge-success' : (p.status === 'PENDING' ? 'badge-warning' : 'badge-danger')}">${p.status}</span></td>
            <td><small class="text-muted">${new Date(p.created_at).toLocaleString()}</small></td>
            <td>
              ${p.status === 'PENDING' ? `
                <button class="btn btn-sm btn-primary" onclick="approvePayment('${p.id}')">
                  <i class="fa-solid fa-check"></i> Approve & Credit
                </button>
              ` : '<span class="text-muted">—</span>'}
            </td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No top-up payment transactions recorded.</td></tr>';
      }
    }
  } catch (err) {
    showToast('Failed to load payments data', 'error');
  }
}

// 6. ORDERS & HISTORY VIEW
async function loadOrdersData() {
  const fulfillmentType = document.getElementById('orders-filter-type').value;
  const search = document.getElementById('orders-filter-search').value;

  const params = new URLSearchParams();
  if (fulfillmentType) params.append('fulfillmentType', fulfillmentType);
  if (search) params.append('search', search);

  try {
    const data = await api(`/orders?${params.toString()}`);
    if (!data.success) return;

    const tbody = document.getElementById('orders-table-body');
    if (data.orders && data.orders.length > 0) {
      tbody.innerHTML = data.orders.map(o => `
        <tr>
          <td><code>${escapeHtml(o.id)}</code></td>
          <td><strong>${escapeHtml(o.user_name || o.telegram_id)}</strong></td>
          <td><strong>${escapeHtml(o.service_name)}</strong></td>
          <td>${escapeHtml(o.validity_name)}</td>
          <td><strong class="text-success">₹${o.price_paid.toFixed(2)}</strong></td>
          <td><span class="badge ${o.fulfillment_type === 'LOCAL' ? 'badge-success' : 'badge-info'}">${o.fulfillment_type}</span></td>
          <td><code>${escapeHtml(o.license_key)}</code></td>
          <td><small class="text-muted">${new Date(o.created_at).toLocaleString()}</small></td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No orders found.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load orders', 'error');
  }
}

// 7. USERS & WALLETS VIEW
async function loadUsersData() {
  const search = document.getElementById('users-search-input').value;
  const params = new URLSearchParams();
  if (search) params.append('search', search);

  try {
    const data = await api(`/users?${params.toString()}`);
    if (!data.success) return;

    const tbody = document.getElementById('users-table-body');
    if (data.users && data.users.length > 0) {
      tbody.innerHTML = data.users.map(u => `
        <tr>
          <td><code>${u.telegram_id}</code></td>
          <td><strong>${escapeHtml(u.first_name || '—')}</strong></td>
          <td>${u.username ? '@' + escapeHtml(u.username) : '<span class="text-muted">—</span>'}</td>
          <td><span class="badge badge-purple">${u.account_type}</span></td>
          <td><strong class="text-success">₹${u.balance.toFixed(2)}</strong></td>
          <td>${u.total_orders}</td>
          <td>₹${u.total_spent.toFixed(2)}</td>
          <td><small class="text-muted">${new Date(u.created_at).toLocaleDateString()}</small></td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="viewUserDetail('${u.id}')">
              <i class="fa-solid fa-user-gear"></i> Inspect & Adjust
            </button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No users found.</td></tr>';
    }
  } catch (err) {
    showToast('Failed to load users', 'error');
  }
}

async function viewUserDetail(userId) {
  try {
    const data = await api(`/users/${userId}`);
    if (!data.success) return;

    const u = data.user;
    document.getElementById('modal-user-name').textContent = `Account: ${u.first_name || u.telegram_id} (@${u.username || 'no_user'})`;

    const body = document.getElementById('user-detail-body');
    body.innerHTML = `
      <div class="stats-grid mb-4">
        <div class="stat-card glass-card">
          <div class="stat-info">
            <span class="stat-label">Current Balance</span>
            <h3 class="stat-value text-success">₹${u.balance.toFixed(2)}</h3>
          </div>
        </div>
        <div class="stat-card glass-card">
          <div class="stat-info">
            <span class="stat-label">Total Orders</span>
            <h3 class="stat-value">${u.total_orders}</h3>
          </div>
        </div>
        <div class="stat-card glass-card">
          <div class="stat-info">
            <span class="stat-label">Total Spent</span>
            <h3 class="stat-value">₹${u.total_spent.toFixed(2)}</h3>
          </div>
        </div>
      </div>

      <div class="glass-card mb-4">
        <h4 class="mb-3"><i class="fa-solid fa-coins"></i> Adjust Wallet Balance</h4>
        <form onsubmit="handleUserBalanceAdjust(event, '${u.id}')">
          <div class="grid-2-col">
            <div class="form-group">
              <label>Amount (Positive to Add, Negative to Deduct)</label>
              <input type="number" step="0.01" id="adj-amount-${u.id}" class="form-control" placeholder="e.g., 500 or -200" required>
            </div>
            <div class="form-group">
              <label>Reason / Audit Note</label>
              <input type="text" id="adj-reason-${u.id}" class="form-control" placeholder="e.g., Promotional bonus / manual correction">
            </div>
          </div>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-wallet"></i> Apply Balance Change</button>
        </form>
      </div>

      <div class="glass-card">
        <h4 class="mb-3"><i class="fa-solid fa-clock-rotate-left"></i> Wallet Audit Log</h4>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Before</th>
                <th>After</th>
                <th>Description</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${data.walletTransactions && data.walletTransactions.length > 0
                ? data.walletTransactions.map(t => `
                  <tr>
                    <td><span class="badge ${t.type === 'TOPUP' || t.amount > 0 ? 'badge-success' : 'badge-danger'}">${t.type}</span></td>
                    <td><strong>${t.amount > 0 ? '+' : ''}₹${t.amount.toFixed(2)}</strong></td>
                    <td>₹${t.balance_before.toFixed(2)}</td>
                    <td>₹${t.balance_after.toFixed(2)}</td>
                    <td>${escapeHtml(t.description || '—')}</td>
                    <td><small class="text-muted">${new Date(t.created_at).toLocaleString()}</small></td>
                  </tr>
                `).join('')
                : '<tr><td colspan="6" class="text-center text-muted">No wallet transactions logged yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    openModal('modal-user-detail');
  } catch (err) {
    showToast('Failed to load user details', 'error');
  }
}

async function handleUserBalanceAdjust(event, userId) {
  event.preventDefault();
  const amount = parseFloat(document.getElementById(`adj-amount-${userId}`).value);
  const description = document.getElementById(`adj-reason-${userId}`).value;

  try {
    const res = await api(`/users/${userId}/balance`, {
      method: 'POST',
      body: JSON.stringify({ amount, description })
    });

    if (res.success) {
      showToast(res.message, 'success');
      viewUserDetail(userId);
      loadUsersData();
    } else {
      showToast(res.message || 'Balance adjustment failed', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 8. MAINTENANCE MODE VIEW
async function loadMaintenanceData() {
  try {
    const data = await api('/settings/maintenance');
    if (!data.success) return;

    state.maintenance = data.maintenance;
    document.getElementById('maintenance-toggle-input').checked = data.maintenance.enabled;
    document.getElementById('maintenance-msg-input').value = data.maintenance.message;
  } catch (err) {
    showToast('Failed to load maintenance settings', 'error');
  }
}

// Event Listeners Setup
function setupEventListeners() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');

    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      if (res.success && res.token) {
        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('admin_token', res.token);
        showAppLayout();
        switchView('overview');
      } else {
        errBox.textContent = res.message || 'Invalid credentials';
        errBox.classList.remove('hidden');
      }
    } catch (err) {
      errBox.textContent = err.message || 'Login failed';
      errBox.classList.remove('hidden');
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Global Refresh
  document.getElementById('btn-refresh-global').addEventListener('click', () => {
    loadViewData(state.currentView);
    showToast('Dashboard refreshed');
  });

  // Sidebar navigation links
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      switchView(view);
    });
  });

  // Services View Actions
  document.getElementById('btn-add-service').addEventListener('click', () => {
    document.getElementById('modal-service-title').textContent = 'Add New Service';
    document.getElementById('service-is-edit').value = '0';
    document.getElementById('service-id-input').value = '';
    document.getElementById('service-id-input').readOnly = false;
    document.getElementById('service-name-input').value = '';
    document.getElementById('service-desc-input').value = '';
    document.getElementById('service-active-input').value = '1';
    openModal('modal-service');
  });

  document.getElementById('form-service').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEdit = document.getElementById('service-is-edit').value === '1';
    const id = document.getElementById('service-id-input').value.trim();
    const name = document.getElementById('service-name-input').value.trim();
    const description = document.getElementById('service-desc-input').value.trim();
    const is_active = parseInt(document.getElementById('service-active-input').value, 10);

    try {
      const endpoint = isEdit ? `/services/${id}` : '/services';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await api(endpoint, {
        method,
        body: JSON.stringify({ id, name, description, is_active })
      });

      if (res.success) {
        showToast(`Service ${isEdit ? 'updated' : 'created'} successfully!`);
        closeModal('modal-service');
        loadServicesData();
      } else {
        showToast(res.message || 'Operation failed', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Validity Form
  document.getElementById('form-validity').addEventListener('submit', async (e) => {
    e.preventDefault();
    const serviceId = document.getElementById('val-service-id').value;
    const isEdit = document.getElementById('val-is-edit').value === '1';
    const valId = document.getElementById('val-id-edit').value;
    const name = document.getElementById('val-name-input').value.trim();
    const price = parseFloat(document.getElementById('val-price-input').value);
    const is_active = parseInt(document.getElementById('val-active-input').value, 10);

    try {
      const endpoint = isEdit ? `/services/validities/${valId}` : `/services/${serviceId}/validities`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await api(endpoint, {
        method,
        body: JSON.stringify({ name, price, is_active })
      });

      if (res.success) {
        showToast(`Validity ${isEdit ? 'updated' : 'added'} successfully!`);
        closeModal('modal-validity');
        loadServicesData();
      } else {
        showToast(res.message || 'Operation failed', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Bulk License Modal Trigger
  document.getElementById('btn-bulk-license-modal').addEventListener('click', () => {
    loadServicesForFilters();
    openModal('modal-bulk-license');
  });

  // Bulk Service select change -> update validities
  document.getElementById('bulk-service-select').addEventListener('change', async (e) => {
    const srvId = e.target.value;
    const valSelect = document.getElementById('bulk-validity-select');
    if (!srvId) {
      valSelect.innerHTML = '<option value="">Select Service First</option>';
      return;
    }

    const srv = state.services.find(s => s.id === srvId);
    if (srv && srv.validities) {
      valSelect.innerHTML = srv.validities.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (Price: ₹${v.price})</option>`).join('');
    }
  });

  // Bulk Upload Form
  document.getElementById('form-bulk-license').addEventListener('submit', async (e) => {
    e.preventDefault();
    const serviceId = document.getElementById('bulk-service-select').value;
    const validityId = document.getElementById('bulk-validity-select').value;
    const keysText = document.getElementById('bulk-keys-textarea').value.trim();

    try {
      const res = await api('/licenses/bulk', {
        method: 'POST',
        body: JSON.stringify({ serviceId, validityId, keysText })
      });

      if (res.success) {
        showToast(res.message);
        closeModal('modal-bulk-license');
        document.getElementById('bulk-keys-textarea').value = '';
        loadLicensesData();
      } else {
        showToast(res.message || 'Failed to upload keys', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Filters for Licenses
  document.getElementById('lic-filter-service').addEventListener('change', (e) => {
    const srvId = e.target.value;
    const valSelect = document.getElementById('lic-filter-validity');
    if (!srvId) {
      valSelect.innerHTML = '<option value="">All Validities</option>';
    } else {
      const srv = state.services.find(s => s.id === srvId);
      if (srv && srv.validities) {
        valSelect.innerHTML = '<option value="">All Validities</option>' + srv.validities.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
      }
    }
    loadLicensesData();
  });
  document.getElementById('lic-filter-validity').addEventListener('change', loadLicensesData);
  document.getElementById('lic-filter-status').addEventListener('change', loadLicensesData);
  document.getElementById('lic-filter-search').addEventListener('input', debounce(loadLicensesData, 300));

  // LD API Settings
  document.getElementById('ld-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const endpoint = document.getElementById('ld-endpoint-input').value.trim();
    const token = document.getElementById('ld-token-input').value.trim();

    try {
      const res = await api('/settings/ld/config', {
        method: 'POST',
        body: JSON.stringify({ endpoint, token })
      });

      if (res.success) {
        showToast(res.message);
        loadLdApiData();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-test-ld-connection').addEventListener('click', async () => {
    try {
      const res = await api('/settings/ld/test', { method: 'POST' });
      showToast(res.message, res.success ? 'success' : 'error');
      loadLdApiData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-fetch-ld-products').addEventListener('click', async () => {
    try {
      const res = await api('/settings/ld/products');
      if (res.success && res.products) {
        state.ldProducts = res.products;
        showToast(`Fetched ${res.products.length} products from provider!`);
        openModal('modal-mapping');
        populateMappingModal();
      } else {
        showToast(res.message || 'Failed to fetch provider products', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-create-mapping-modal').addEventListener('click', () => {
    loadServicesForFilters();
    openModal('modal-mapping');
    populateMappingModal();
  });

  document.getElementById('map-service-select').addEventListener('change', (e) => {
    const srvId = e.target.value;
    const valSelect = document.getElementById('map-validity-select');
    const srv = state.services.find(s => s.id === srvId);
    if (srv && srv.validities) {
      valSelect.innerHTML = srv.validities.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
    }
  });

  document.getElementById('form-mapping').addEventListener('submit', async (e) => {
    e.preventDefault();
    const serviceId = document.getElementById('map-service-select').value;
    const validityId = document.getElementById('map-validity-select').value;
    const selectProd = document.getElementById('map-provider-product-select').value;
    const customProd = document.getElementById('map-external-id-custom').value.trim();
    const externalProductId = customProd || selectProd;

    if (!externalProductId) {
      showToast('Please select or enter an external provider product ID', 'error');
      return;
    }

    try {
      const res = await api('/settings/ld/mappings', {
        method: 'POST',
        body: JSON.stringify({ serviceId, validityId, externalProductId })
      });

      if (res.success) {
        showToast(res.message);
        closeModal('modal-mapping');
        loadLdApiData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Binance & UPI Settings
  document.getElementById('binance-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const apiKey = document.getElementById('binance-api-key').value;
    const secretKey = document.getElementById('binance-secret-key').value;
    const merchantId = document.getElementById('binance-merchant-id').value;
    const bep20Address = document.getElementById('binance-bep20').value;
    const relayUrl = document.getElementById('binance-relay-url').value;

    try {
      const res = await api('/settings/payments/binance', {
        method: 'POST',
        body: JSON.stringify({ apiKey, secretKey, merchantId, bep20Address, relayUrl })
      });
      showToast(res.message);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-test-binance-connection').addEventListener('click', async () => {
    try {
      const res = await api('/settings/payments/binance/test', { method: 'POST' });
      showToast(res.message, res.success ? 'success' : 'error');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('upi-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const merchantVpa = document.getElementById('upi-vpa').value;
    const merchantName = document.getElementById('upi-name').value;
    const webhookSecret = document.getElementById('upi-secret').value;

    try {
      const res = await api('/settings/payments/upi', {
        method: 'POST',
        body: JSON.stringify({ merchantVpa, merchantName, webhookSecret })
      });
      showToast(res.message);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Maintenance Toggle & Form
  document.getElementById('maintenance-toggle-input').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    try {
      const res = await api('/settings/maintenance', {
        method: 'POST',
        body: JSON.stringify({ enabled })
      });
      showToast(res.message, enabled ? 'error' : 'success');
      loadOverviewData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('maintenance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('maintenance-msg-input').value;
    try {
      const res = await api('/settings/maintenance', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      showToast('Maintenance notice message saved successfully!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Orders and Users filters
  document.getElementById('orders-filter-type').addEventListener('change', loadOrdersData);
  document.getElementById('orders-filter-search').addEventListener('input', debounce(loadOrdersData, 300));
  document.getElementById('users-search-input').addEventListener('input', debounce(loadUsersData, 300));
}

function populateMappingModal() {
  loadServicesForFilters();
  const select = document.getElementById('map-provider-product-select');
  if (state.ldProducts && state.ldProducts.length > 0) {
    select.innerHTML = '<option value="">-- Select from Provider Catalog --</option>' + state.ldProducts.map(p => `
      <option value="${p.id}">${escapeHtml(p.name)} (${p.id}) - $${p.price || 0}</option>
    `).join('');
  }
}

// Global actions
window.openAddValidityModal = function(serviceId) {
  document.getElementById('modal-validity-title').textContent = 'Add Validity Plan';
  document.getElementById('val-service-id').value = serviceId;
  document.getElementById('val-is-edit').value = '0';
  document.getElementById('val-id-edit').value = '';
  document.getElementById('val-name-input').value = '';
  document.getElementById('val-price-input').value = '';
  document.getElementById('val-active-input').value = '1';
  openModal('modal-validity');
};

window.editServiceModal = function(serviceId) {
  const srv = state.services.find(s => s.id === serviceId);
  if (!srv) return;

  document.getElementById('modal-service-title').textContent = 'Edit Service';
  document.getElementById('service-is-edit').value = '1';
  document.getElementById('service-id-input').value = srv.id;
  document.getElementById('service-id-input').readOnly = true;
  document.getElementById('service-name-input').value = srv.name;
  document.getElementById('service-desc-input').value = srv.description || '';
  document.getElementById('service-active-input').value = String(srv.is_active);
  openModal('modal-service');
};

window.editValidityModal = function(serviceId, validityId) {
  const srv = state.services.find(s => s.id === serviceId);
  if (!srv) return;
  const val = srv.validities.find(v => v.id === validityId);
  if (!val) return;

  document.getElementById('modal-validity-title').textContent = 'Edit Validity Plan';
  document.getElementById('val-service-id').value = serviceId;
  document.getElementById('val-is-edit').value = '1';
  document.getElementById('val-id-edit').value = validityId;
  document.getElementById('val-name-input').value = val.name;
  document.getElementById('val-price-input').value = val.price;
  document.getElementById('val-active-input').value = String(val.is_active);
  openModal('modal-validity');
};

window.deleteService = async function(serviceId) {
  if (!confirm(`Are you sure you want to delete service "${serviceId}" and all its validities and licenses?`)) return;
  try {
    const res = await api(`/services/${serviceId}`, { method: 'DELETE' });
    showToast(res.message);
    loadServicesData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteValidity = async function(validityId) {
  if (!confirm('Are you sure you want to delete this validity option?')) return;
  try {
    const res = await api(`/services/validities/${validityId}`, { method: 'DELETE' });
    showToast(res.message);
    loadServicesData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteLicense = async function(licenseId) {
  if (!confirm('Delete this license key from inventory?')) return;
  try {
    const res = await api(`/licenses/${licenseId}`, { method: 'DELETE' });
    showToast(res.message);
    loadLicensesData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteMapping = async function(mappingId) {
  if (!confirm('Remove this product API mapping?')) return;
  try {
    const res = await api(`/settings/ld/mappings/${mappingId}`, { method: 'DELETE' });
    showToast(res.message);
    loadLdApiData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.approvePayment = async function(paymentId) {
  if (!confirm('Approve this payment and credit the customer wallet balance?')) return;
  try {
    const res = await api(`/payments/${paymentId}/approve`, { method: 'POST' });
    showToast(res.message, res.success ? 'success' : 'error');
    loadPaymentsData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
