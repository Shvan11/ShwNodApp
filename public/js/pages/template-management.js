/**
 * Template Management Page - File-Based Templates
 * Handles template listing, creation, and management for file-based templates
 */

let documentTypes = [];
let allTemplates = [];
let currentDocumentType = null;
let templateStats = {
    total: 0,
    active: 0,
    system: 0
};

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    console.log('Template Management page loaded');
    loadDocumentTypes();
    loadAllTemplates();

    // Set up event listeners
    document.getElementById('createTemplateBtn').addEventListener('click', openCreateModal);
    document.getElementById('createTemplateForm').addEventListener('submit', handleCreateTemplate);
    document.getElementById('documentType').addEventListener('change', handleDocumentTypeChange);
});

/**
 * Load all document types
 */
async function loadDocumentTypes() {
    try {
        const response = await fetch('/api/templates/document-types');
        const result = await response.json();

        if (result.status === 'success') {
            documentTypes = result.data;
            renderDocumentTypeTabs();
            populateDocumentTypeSelect();
        } else {
            throw new Error(result.message || 'Failed to load document types');
        }
    } catch (error) {
        console.error('Error loading document types:', error);
        showNotification('Error loading document types', 'error');
    }
}

/**
 * Load all templates
 */
async function loadAllTemplates() {
    try {
        showLoadingState();

        const response = await fetch('/api/templates');
        const result = await response.json();

        if (result.status === 'success') {
            allTemplates = result.data;
            calculateStats();
            renderStats();

            // Select first document type if none selected
            if (!currentDocumentType && documentTypes.length > 0) {
                currentDocumentType = documentTypes[0].type_id;
            }

            filterAndRenderTemplates();
        } else {
            throw new Error(result.message || 'Failed to load templates');
        }
    } catch (error) {
        console.error('Error loading templates:', error);
        showNotification('Error loading templates', 'error');
        showEmptyState();
    }
}

/**
 * Calculate template statistics
 */
function calculateStats() {
    templateStats = {
        total: allTemplates.length,
        active: allTemplates.filter(t => t.is_active).length,
        system: allTemplates.filter(t => t.is_system).length
    };
}

/**
 * Render statistics cards
 */
function renderStats() {
    document.getElementById('totalTemplates').textContent = templateStats.total;
    document.getElementById('activeTemplates').textContent = templateStats.active;
    document.getElementById('systemTemplates').textContent = templateStats.system;
}

/**
 * Render document type tabs
 */
function renderDocumentTypeTabs() {
    const tabsContainer = document.getElementById('documentTypeTabs');
    tabsContainer.innerHTML = '';

    documentTypes.forEach(docType => {
        const templateCount = allTemplates.filter(t => t.document_type_id === docType.type_id).length;

        const tab = document.createElement('button');
        tab.className = 'tab';
        if (currentDocumentType === docType.type_id) {
            tab.classList.add('active');
        }

        tab.innerHTML = `
            <i class="fas ${docType.icon}"></i>
            ${docType.type_name}
            <span class="tab-badge">${templateCount}</span>
        `;

        tab.addEventListener('click', () => selectDocumentType(docType.type_id));
        tabsContainer.appendChild(tab);
    });
}

/**
 * Select a document type
 */
function selectDocumentType(typeId) {
    currentDocumentType = typeId;
    renderDocumentTypeTabs();
    filterAndRenderTemplates();
}

/**
 * Filter and render templates for current document type
 */
function filterAndRenderTemplates() {
    const filtered = allTemplates.filter(t => t.document_type_id === currentDocumentType);

    if (filtered.length === 0) {
        showEmptyState();
    } else {
        renderTemplates(filtered);
    }
}

/**
 * Render templates grid
 */
function renderTemplates(templates) {
    const grid = document.getElementById('templatesGrid');
    const loadingState = document.getElementById('loadingState');
    const emptyState = document.getElementById('emptyState');

    loadingState.style.display = 'none';
    emptyState.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    templates.forEach(template => {
        const card = createTemplateCard(template);
        grid.appendChild(card);
    });
}

/**
 * Create template card element
 */
function createTemplateCard(template) {
    const card = document.createElement('div');
    card.className = 'template-card';
    if (template.is_default) {
        card.classList.add('default');
    }

    const badges = [];
    if (template.is_default) badges.push('<span class="badge default"><i class="fas fa-star"></i> Default</span>');
    if (template.is_active) {
        badges.push('<span class="badge active"><i class="fas fa-check"></i> Active</span>');
    } else {
        badges.push('<span class="badge inactive"><i class="fas fa-times"></i> Inactive</span>');
    }
    if (template.is_system) badges.push('<span class="badge system"><i class="fas fa-shield-alt"></i> System</span>');

    const lastUsed = template.last_used_date
        ? new Date(template.last_used_date).toLocaleDateString()
        : 'Never';

    card.innerHTML = `
        <div class="template-card-header">
            <div class="template-title">
                <h4>${escapeHtml(template.template_name)}</h4>
            </div>
            <div class="template-badges">
                ${badges.join('')}
            </div>
            <div class="template-meta">
                <div class="meta-item">
                    <i class="fas fa-file"></i>
                    <span>${template.template_file_path || 'No file'}</span>
                </div>
                <div class="meta-item">
                    <i class="fas fa-clock"></i>
                    <span>Last used: ${lastUsed}</span>
                </div>
                <div class="meta-item">
                    <i class="fas fa-user"></i>
                    <span>Created by: ${escapeHtml(template.created_by || 'Unknown')}</span>
                </div>
            </div>
        </div>
        <div class="template-card-body">
            ${template.description ? `<p class="template-description">${escapeHtml(template.description)}</p>` : ''}
            <div class="template-actions">
                <button class="btn btn-sm btn-primary" onclick="editTemplateFile(${template.template_id})">
                    <i class="fas fa-edit"></i> Edit Design
                </button>
                ${!template.is_default ? `
                    <button class="btn btn-sm btn-success" onclick="setAsDefault(${template.template_id})">
                        <i class="fas fa-star"></i> Set Default
                    </button>
                ` : ''}
                ${!template.is_system ? `
                    <button class="btn btn-sm btn-danger" onclick="deleteTemplate(${template.template_id})">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    return card;
}

/**
 * Show loading state
 */
function showLoadingState() {
    document.getElementById('loadingState').style.display = 'flex';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('templatesGrid').style.display = 'none';
}

/**
 * Show empty state
 */
function showEmptyState() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('templatesGrid').style.display = 'none';
}

/**
 * Populate document type select in create modal
 */
function populateDocumentTypeSelect() {
    const select = document.getElementById('documentType');
    select.innerHTML = '<option value="">Select document type...</option>';

    documentTypes.forEach(docType => {
        const option = document.createElement('option');
        option.value = docType.type_id;
        option.textContent = `${docType.type_name}`;
        select.appendChild(option);
    });
}

/**
 * Handle document type change in create form
 */
function handleDocumentTypeChange(event) {
    // Template file path will be manually entered
}

/**
 * Open create template modal
 */
function openCreateModal() {
    document.getElementById('createTemplateModal').style.display = 'flex';
    document.getElementById('createTemplateForm').reset();

    // Pre-select current document type if viewing one
    if (currentDocumentType) {
        document.getElementById('documentType').value = currentDocumentType;
    }
}

/**
 * Close create template modal
 */
function closeCreateModal() {
    document.getElementById('createTemplateModal').style.display = 'none';
}

/**
 * Handle create template form submission
 */
async function handleCreateTemplate(event) {
    event.preventDefault();

    const formData = {
        template_name: document.getElementById('templateName').value,
        description: document.getElementById('templateDescription').value || null,
        document_type_id: parseInt(document.getElementById('documentType').value),
        is_default: document.getElementById('setAsDefault').checked,
        is_active: true,
        created_by: 'user'
    };

    try {
        const response = await fetch('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (result.status === 'success') {
            showNotification('Template created successfully!', 'success');
            closeCreateModal();

            // Open in designer to create the template design
            window.location.href = `/template-designer.html?templateId=${result.data.template_id}`;
        } else {
            throw new Error(result.message || 'Failed to create template');
        }
    } catch (error) {
        console.error('Error creating template:', error);
        showNotification(error.message, 'error');
    }
}

/**
 * Edit template in designer
 */
function editTemplateFile(templateId) {
    window.location.href = `/template-designer.html?templateId=${templateId}`;
}

/**
 * Set template as default
 */
async function setAsDefault(templateId) {
    if (!confirm('Set this template as the default for this document type?')) {
        return;
    }

    try {
        const response = await fetch(`/api/templates/${templateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                is_default: true,
                modified_by: 'user'
            })
        });

        const result = await response.json();

        if (result.status === 'success') {
            showNotification('Template set as default!', 'success');
            await loadAllTemplates();
        } else {
            throw new Error(result.message || 'Failed to set as default');
        }
    } catch (error) {
        console.error('Error setting default:', error);
        showNotification(error.message, 'error');
    }
}

/**
 * Delete template
 */
async function deleteTemplate(templateId) {
    const template = allTemplates.find(t => t.template_id === templateId);

    if (!confirm(`Are you sure you want to delete "${template.template_name}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/templates/${templateId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.status === 'success') {
            showNotification('Template deleted successfully!', 'success');
            await loadAllTemplates();
        } else {
            throw new Error(result.message || 'Failed to delete template');
        }
    } catch (error) {
        console.error('Error deleting template:', error);
        showNotification(error.message, 'error');
    }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    alert(message);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modals on background click
document.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-overlay')) {
        closeCreateModal();
    }
});

// Close modals on Escape key
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeCreateModal();
    }
});
