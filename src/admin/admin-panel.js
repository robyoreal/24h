import {
  verifyAdminPassword,
  loadAdminConfig,
  saveAdminConfig,
  getSystemStats,
  searchUsers,
  cleanupOldStrokes,
  resetAllUserInk,
  exportAllData
} from '../services/admin.service.js';
import { DEFAULT_COLOR_PALETTE, DEFAULT_FONTS } from '../config/firebase.config.js';

let isAdminAuthenticated = false;
let currentConfig = null;
let currentColorIndex = null; // Track which color is being edited
let currentFontIndex = null; // Track which font is being edited

export function initAdminPanel() {
  // Admin access button
  document.getElementById('admin-access-btn').addEventListener('click', () => {
    if (isAdminAuthenticated) {
      showAdminPanel();
    } else {
      showAdminLogin();
    }
  });

  // Close panel
  document.getElementById('admin-close').addEventListener('click', hideAdminPanel);

  // Login modal
  document.getElementById('admin-login-submit').addEventListener('click', handleAdminLogin);
  document.getElementById('admin-login-cancel').addEventListener('click', hideAdminLogin);
  document.getElementById('admin-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAdminLogin();
  });

  // Tab switching
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      switchAdminTab(targetTab);
    });
  });

  // Stats tab
  document.getElementById('admin-refresh-stats').addEventListener('click', loadStats);

  // Config tab
  document.getElementById('admin-save-config').addEventListener('click', handleSaveConfig);
  document.getElementById('admin-add-color').addEventListener('click', handleAddColor);
  document.getElementById('admin-reset-colors').addEventListener('click', handleResetColors);
  document.getElementById('admin-add-font').addEventListener('click', handleAddFont);
  document.getElementById('admin-reset-fonts').addEventListener('click', handleResetFonts);

  // Color picker modal
  document.getElementById('admin-color-save').addEventListener('click', handleColorSave);
  document.getElementById('admin-color-cancel').addEventListener('click', hideColorPicker);
  document.getElementById('admin-color-picker').addEventListener('input', (e) => {
    document.getElementById('admin-color-hex').value = e.target.value;
  });
  document.getElementById('admin-color-hex').addEventListener('input', (e) => {
    const hex = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(hex)) {
      document.getElementById('admin-color-picker').value = hex;
    }
  });

  // Font editor modal
  document.getElementById('admin-font-save').addEventListener('click', handleFontSave);
  document.getElementById('admin-font-cancel').addEventListener('click', hideFontEditor);
  document.getElementById('admin-font-family').addEventListener('input', updateFontPreview);
  document.getElementById('admin-font-name').addEventListener('input', updateFontPreview);

  // Users tab
  document.getElementById('admin-search-users').addEventListener('click', handleSearchUsers);
  document.getElementById('admin-user-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearchUsers();
  });

  // Data tab
  document.getElementById('admin-cleanup-old-strokes').addEventListener('click', handleCleanupStrokes);
  document.getElementById('admin-reset-all-ink').addEventListener('click', handleResetInk);
  document.getElementById('admin-export-data').addEventListener('click', handleExportData);
}

// Login flow
function showAdminLogin() {
  document.getElementById('admin-login-modal').classList.remove('hidden');
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-login-error').classList.add('hidden');
  document.getElementById('admin-password').focus();
}

function hideAdminLogin() {
  document.getElementById('admin-login-modal').classList.add('hidden');
}

async function handleAdminLogin() {
  const password = document.getElementById('admin-password').value;
  const isValid = await verifyAdminPassword(password);

  if (isValid) {
    isAdminAuthenticated = true;
    hideAdminLogin();
    showAdminPanel();
  } else {
    document.getElementById('admin-login-error').classList.remove('hidden');
  }
}

// Panel visibility
async function showAdminPanel() {
  document.getElementById('admin-panel').classList.remove('hidden');

  // Load initial data
  currentConfig = await loadAdminConfig();
  if (currentConfig) {
    populateConfigForm();
    renderColorPalette();
    renderFontList();
  }
  loadStats();
}

function hideAdminPanel() {
  document.getElementById('admin-panel').classList.add('hidden');
}

// Tab switching
function switchAdminTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.admin-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `admin-tab-${tabName}`);
  });

  // Load tab-specific data
  if (tabName === 'stats') loadStats();
}

// Stats tab
async function loadStats() {
  const stats = await getSystemStats();
  if (stats) {
    document.getElementById('stat-total-users').textContent = stats.totalUsers.toLocaleString();
    document.getElementById('stat-active-tiles').textContent = stats.activeTiles.toLocaleString();
    document.getElementById('stat-total-strokes').textContent = stats.totalStrokes.toLocaleString();
  }
}

// Config tab
function populateConfigForm() {
  if (!currentConfig) return;

  document.getElementById('config-max-ink').value = currentConfig.maxInkPerUser;
  document.getElementById('config-refill-rate').value = Math.round(currentConfig.inkRefillRate * 3600);
  document.getElementById('config-fade-duration').value = currentConfig.fadeDuration / 3600000;
  document.getElementById('config-inactivity').value = currentConfig.inactivityTimeout / 1000;
  document.getElementById('config-maintenance-mode').checked = currentConfig.maintenanceMode;
  document.getElementById('config-allow-text').checked = currentConfig.allowText;
  document.getElementById('config-allow-eraser').checked = currentConfig.allowEraser;
}

function renderColorPalette() {
  const container = document.getElementById('admin-color-palette');
  container.innerHTML = '';

  if (!currentConfig || !currentConfig.colorPalette) return;

  currentConfig.colorPalette.forEach((color, index) => {
    const item = document.createElement('div');
    item.className = 'admin-color-item';
    item.dataset.index = index;

    const swatch = document.createElement('div');
    swatch.className = 'admin-color-swatch';
    swatch.style.background = color;

    const hex = document.createElement('span');
    hex.className = 'admin-color-hex';
    hex.textContent = color.toUpperCase();

    const remove = document.createElement('button');
    remove.className = 'admin-color-remove';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRemoveColor(index);
    });

    item.appendChild(swatch);
    item.appendChild(hex);
    item.appendChild(remove);

    item.addEventListener('click', () => {
      showColorPicker(index);
    });

    container.appendChild(item);
  });
}

function showColorPicker(index) {
  currentColorIndex = index;
  const color = currentConfig.colorPalette[index];
  document.getElementById('admin-color-picker').value = color;
  document.getElementById('admin-color-hex').value = color;
  document.getElementById('admin-color-picker-modal').classList.remove('hidden');
}

function hideColorPicker() {
  document.getElementById('admin-color-picker-modal').classList.add('hidden');
  currentColorIndex = null;
}

function handleColorSave() {
  if (currentColorIndex === null) return;

  const newColor = document.getElementById('admin-color-picker').value;
  currentConfig.colorPalette[currentColorIndex] = newColor;
  renderColorPalette();
  hideColorPicker();
}

function handleAddColor() {
  if (!currentConfig.colorPalette) currentConfig.colorPalette = [];
  currentConfig.colorPalette.push('#000000');
  renderColorPalette();
}

function handleRemoveColor(index) {
  if (currentConfig.colorPalette.length <= 2) {
    alert('Must have at least 2 colors');
    return;
  }
  currentConfig.colorPalette.splice(index, 1);
  renderColorPalette();
}

function handleResetColors() {
  if (!confirm('Reset color palette to default?')) return;
  currentConfig.colorPalette = [...DEFAULT_COLOR_PALETTE];
  renderColorPalette();
}

// Font Management
function renderFontList() {
  const container = document.getElementById('admin-font-list');
  container.innerHTML = '';

  if (!currentConfig || !currentConfig.fonts) return;

  currentConfig.fonts.forEach((font, index) => {
    const item = document.createElement('div');
    item.className = 'admin-font-item';
    item.dataset.index = index;

    const info = document.createElement('div');
    info.className = 'admin-font-info';

    const name = document.createElement('div');
    name.className = 'admin-font-name';
    name.textContent = font.name;

    const family = document.createElement('div');
    family.className = 'admin-font-family';
    family.textContent = font.family;

    info.appendChild(name);
    info.appendChild(family);

    const preview = document.createElement('div');
    preview.className = 'admin-font-preview-inline';
    preview.style.fontFamily = font.family;
    preview.textContent = 'Aa';

    const remove = document.createElement('button');
    remove.className = 'admin-font-remove';
    remove.textContent = '✕';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRemoveFont(index);
    });

    item.appendChild(info);
    item.appendChild(preview);
    item.appendChild(remove);

    item.addEventListener('click', () => {
      showFontEditor(index);
    });

    container.appendChild(item);
  });
}

function showFontEditor(index) {
  currentFontIndex = index;
  const font = currentConfig.fonts[index];

  document.getElementById('admin-font-name').value = font.name;
  document.getElementById('admin-font-family').value = font.family;
  document.getElementById('admin-font-category').value = font.category || 'sans-serif';

  updateFontPreview();
  document.getElementById('admin-font-editor-modal').classList.remove('hidden');
}

function hideFontEditor() {
  document.getElementById('admin-font-editor-modal').classList.add('hidden');
  currentFontIndex = null;
}

function updateFontPreview() {
  const family = document.getElementById('admin-font-family').value;
  const preview = document.getElementById('admin-font-preview');
  preview.style.fontFamily = family;
}

function handleFontSave() {
  if (currentFontIndex === null) return;

  const name = document.getElementById('admin-font-name').value.trim();
  const family = document.getElementById('admin-font-family').value.trim();
  const category = document.getElementById('admin-font-category').value;

  if (!name || !family) {
    alert('Font name and family are required');
    return;
  }

  currentConfig.fonts[currentFontIndex] = { name, family, category };
  renderFontList();
  hideFontEditor();
}

function handleAddFont() {
  if (!currentConfig.fonts) currentConfig.fonts = [];

  currentConfig.fonts.push({
    name: 'New Font',
    family: 'Arial, sans-serif',
    category: 'sans-serif'
  });

  renderFontList();

  // Automatically open editor for the new font
  showFontEditor(currentConfig.fonts.length - 1);
}

function handleRemoveFont(index) {
  if (currentConfig.fonts.length <= 1) {
    alert('Must have at least 1 font');
    return;
  }

  if (!confirm(`Remove "${currentConfig.fonts[index].name}"?`)) return;

  currentConfig.fonts.splice(index, 1);
  renderFontList();
}

function handleResetFonts() {
  if (!confirm('Reset font list to default?')) return;
  currentConfig.fonts = [...DEFAULT_FONTS];
  renderFontList();
}

async function handleSaveConfig() {
  if (!currentConfig) return;

  // Update config from form
  currentConfig.maxInkPerUser = parseInt(document.getElementById('config-max-ink').value);
  currentConfig.inkRefillRate = parseInt(document.getElementById('config-refill-rate').value) / 3600;
  currentConfig.fadeDuration = parseInt(document.getElementById('config-fade-duration').value) * 3600000;
  currentConfig.inactivityTimeout = parseInt(document.getElementById('config-inactivity').value) * 1000;
  currentConfig.maintenanceMode = document.getElementById('config-maintenance-mode').checked;
  currentConfig.allowText = document.getElementById('config-allow-text').checked;
  currentConfig.allowEraser = document.getElementById('config-allow-eraser').checked;

  const success = await saveAdminConfig(currentConfig);
  if (success) {
    alert('Configuration saved! Users must refresh to see changes.');

    // Trigger a custom event so main app can reload config
    window.dispatchEvent(new CustomEvent('admin-config-updated', { detail: currentConfig }));
  } else {
    alert('Failed to save configuration');
  }
}

// Users tab
async function handleSearchUsers() {
  const searchTerm = document.getElementById('admin-user-search').value.trim();
  if (!searchTerm) return;

  const results = await searchUsers(searchTerm);
  const container = document.getElementById('admin-user-list');

  if (results.length === 0) {
    container.innerHTML = '<p class="admin-placeholder">No users found</p>';
    return;
  }

  container.innerHTML = results.map(user => `
    <div class="admin-user-card">
      <div><strong>IP Hash:</strong> ${user.id.substring(0, 16)}...</div>
      <div><strong>Country:</strong> ${user.country || 'Unknown'}</div>
      <div><strong>Ink:</strong> ${(user.inkRemaining || 0).toLocaleString()} / ${(currentConfig?.maxInkPerUser || 250000).toLocaleString()}</div>
      <div><strong>Last Refill:</strong> ${user.lastRefill ? new Date(user.lastRefill).toLocaleString() : 'Never'}</div>
    </div>
  `).join('');
}

// Data tab
async function handleCleanupStrokes() {
  if (!confirm('This will permanently delete all strokes older than 24 hours. Continue?')) return;

  const cleaned = await cleanupOldStrokes();
  alert(`Cleaned up ${cleaned} old stroke(s)`);
  loadStats();
}

async function handleResetInk() {
  if (!confirm('This will reset ALL users ink to maximum. This action cannot be undone. Continue?')) return;

  const maxInk = currentConfig?.maxInkPerUser || 250000;
  const count = await resetAllUserInk(maxInk);
  alert(`Reset ink for ${count} user(s)`);
}

async function handleExportData() {
  const data = await exportAllData();
  if (!data) {
    alert('Failed to export data');
    return;
  }

  // Create downloadable JSON file
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ephemeral-wall-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
