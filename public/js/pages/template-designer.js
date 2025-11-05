/**
 * Template Designer
 * Visual editor for receipt templates
 */

class TemplateDesigner {
    constructor() {
        this.template = null;
        this.elements = [];
        this.selectedElement = null;
        this.zoom = 1.0;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };

        this.init();
    }

    async init() {
        this.showLoading(true);

        try {
            // Load default receipt template
            await this.loadTemplate(2); // Template ID 2 = default receipt

            // Setup event listeners
            this.setupEventListeners();

            // Render initial state
            this.renderElementList();
            this.renderCanvas();

        } catch (error) {
            console.error('Failed to initialize designer:', error);
            this.showToast('Failed to load template', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadTemplate(templateId) {
        const response = await fetch(`/api/templates/${templateId}/full`);
        const result = await response.json();

        if (result.status === 'success') {
            this.template = result.data;
            this.elements = result.data.elements || [];
        } else {
            throw new Error(result.message);
        }
    }

    setupEventListeners() {
        // Header buttons
        document.getElementById('saveBtn').addEventListener('click', () => this.saveTemplate());
        document.getElementById('reloadBtn').addEventListener('click', () => this.reloadTemplate());
        document.getElementById('previewBtn').addEventListener('click', () => this.previewTemplate());

        // Zoom slider
        const zoomSlider = document.getElementById('zoomSlider');
        zoomSlider.addEventListener('input', (e) => {
            this.zoom = e.target.value / 100;
            document.getElementById('zoomValue').textContent = e.target.value + '%';
            this.updateCanvasZoom();
        });

        // Show labels toggle
        document.getElementById('showLabels').addEventListener('change', (e) => {
            document.querySelectorAll('.element-label').forEach(label => {
                label.style.display = e.target.checked ? 'block' : 'none';
            });
        });
    }

    renderElementList() {
        const listContainer = document.getElementById('elementList');

        if (this.elements.length === 0) {
            listContainer.innerHTML = '<div class="empty-state"><p>No elements found</p></div>';
            return;
        }

        listContainer.innerHTML = this.elements
            .sort((a, b) => a.element_order - b.element_order)
            .map(element => `
                <div class="element-item" data-element-id="${element.element_id}">
                    <span class="element-name">${element.element_name}</span>
                    <span class="element-type">${element.element_type}</span>
                </div>
            `)
            .join('');

        // Add click listeners
        listContainer.querySelectorAll('.element-item').forEach(item => {
            item.addEventListener('click', () => {
                const elementId = parseInt(item.dataset.elementId);
                this.selectElement(elementId);
            });
        });
    }

    renderCanvas() {
        const canvas = document.getElementById('templateCanvas');

        // Set canvas size based on template
        const widthPx = this.mmToPx(this.template.paper_width);
        const heightPx = this.mmToPx(this.template.paper_height);

        canvas.style.width = widthPx + 'px';
        canvas.style.height = heightPx + 'px';
        canvas.style.backgroundColor = this.template.background_color || '#FFFFFF';

        // Clear canvas
        canvas.innerHTML = '';

        // Render elements
        this.elements.forEach(element => {
            const elementDiv = this.createElementDiv(element);
            canvas.appendChild(elementDiv);
        });

        this.updateCanvasZoom();
    }

    createElementDiv(element) {
        const div = document.createElement('div');
        div.className = 'canvas-element';
        div.dataset.elementId = element.element_id;

        // Position and size
        div.style.left = element.pos_x + 'px';
        div.style.top = element.pos_y + 'px';
        div.style.width = element.width + 'px';
        div.style.height = element.height + 'px';

        // Typography
        if (element.font_family) div.style.fontFamily = element.font_family;
        if (element.font_size) div.style.fontSize = element.font_size + 'px';
        if (element.font_weight) div.style.fontWeight = element.font_weight;
        if (element.text_align) div.style.textAlign = element.text_align;
        if (element.text_color) div.style.color = element.text_color;
        if (element.background_color && element.background_color !== 'transparent') {
            div.style.backgroundColor = element.background_color;
        }

        // Content
        div.innerHTML = this.getElementContent(element);

        // Add label
        const label = document.createElement('div');
        label.className = 'element-label';
        label.textContent = element.element_name;
        div.appendChild(label);

        // Make draggable
        div.addEventListener('mousedown', (e) => this.startDrag(e, element));
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectElement(element.element_id);
        });

        return div;
    }

    getElementContent(element) {
        switch (element.element_type) {
            case 'text':
            case 'static_text':
                return element.static_content || '';

            case 'data_field':
                const label = element.static_content || '';
                const placeholder = `{${element.data_binding || 'data'}}`;
                return label + placeholder;

            case 'line':
                const isHorizontal = element.line_orientation === 'horizontal';
                const style = isHorizontal
                    ? `border-top: ${element.line_thickness || 1}px ${element.line_style || 'solid'} ${element.border_color || '#000'}; width: 100%;`
                    : `border-left: ${element.line_thickness || 1}px ${element.line_style || 'solid'} ${element.border_color || '#000'}; height: 100%;`;
                return `<div style="${style}"></div>`;

            default:
                return element.static_content || `[${element.element_type}]`;
        }
    }

    startDrag(e, element) {
        if (e.button !== 0) return; // Only left mouse button

        e.preventDefault();
        this.isDragging = true;
        this.draggedElement = element;

        const rect = e.currentTarget.getBoundingClientRect();
        const canvas = document.getElementById('templateCanvas');
        const canvasRect = canvas.getBoundingClientRect();

        this.dragStart = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            elementX: element.pos_x,
            elementY: element.pos_y
        };

        const mouseMoveHandler = (e) => this.onDrag(e, canvasRect);
        const mouseUpHandler = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
        };

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    }

    onDrag(e, canvasRect) {
        if (!this.isDragging) return;

        const newX = (e.clientX - canvasRect.left - this.dragStart.x) / this.zoom;
        const newY = (e.clientY - canvasRect.top - this.dragStart.y) / this.zoom;

        // Update element position
        this.draggedElement.pos_x = Math.max(0, Math.round(newX));
        this.draggedElement.pos_y = Math.max(0, Math.round(newY));

        // Update visual position
        const elementDiv = document.querySelector(`[data-element-id="${this.draggedElement.element_id}"]`);
        if (elementDiv) {
            elementDiv.style.left = this.draggedElement.pos_x + 'px';
            elementDiv.style.top = this.draggedElement.pos_y + 'px';
        }

        // Update properties panel if this element is selected
        if (this.selectedElement && this.selectedElement.element_id === this.draggedElement.element_id) {
            this.updatePropertiesForm();
        }
    }

    selectElement(elementId) {
        // Remove previous selection
        document.querySelectorAll('.element-item.selected, .canvas-element.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // Find and select element
        this.selectedElement = this.elements.find(e => e.element_id === elementId);

        if (this.selectedElement) {
            // Highlight in list
            const listItem = document.querySelector(`.element-item[data-element-id="${elementId}"]`);
            if (listItem) listItem.classList.add('selected');

            // Highlight on canvas
            const canvasItem = document.querySelector(`.canvas-element[data-element-id="${elementId}"]`);
            if (canvasItem) canvasItem.classList.add('selected');

            // Show properties
            this.renderPropertiesPanel();
        }
    }

    renderPropertiesPanel() {
        const panel = document.getElementById('propertiesForm');

        if (!this.selectedElement) {
            panel.innerHTML = '<div class="empty-state"><p>Select an element to edit</p></div>';
            return;
        }

        const el = this.selectedElement;

        panel.innerHTML = `
            <div class="property-group">
                <h3>Basic Info</h3>
                <div class="form-group">
                    <label>Element Name</label>
                    <input type="text" id="prop_element_name" value="${el.element_name || ''}">
                </div>
                <div class="form-group">
                    <label>Element Type</label>
                    <input type="text" value="${el.element_type}" disabled>
                </div>
            </div>

            <div class="property-group">
                <h3>Position & Size</h3>
                <div class="form-row">
                    <div class="form-group">
                        <label>X (px)</label>
                        <input type="number" id="prop_pos_x" value="${el.pos_x || 0}" min="0">
                    </div>
                    <div class="form-group">
                        <label>Y (px)</label>
                        <input type="number" id="prop_pos_y" value="${el.pos_y || 0}" min="0">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Width (px)</label>
                        <input type="number" id="prop_width" value="${el.width || 0}" min="0">
                    </div>
                    <div class="form-group">
                        <label>Height (px)</label>
                        <input type="number" id="prop_height" value="${el.height || 0}" min="0">
                    </div>
                </div>
            </div>

            <div class="property-group">
                <h3>Typography</h3>
                <div class="form-group">
                    <label>Font Family</label>
                    <select id="prop_font_family">
                        <option value="Arial" ${el.font_family === 'Arial' ? 'selected' : ''}>Arial</option>
                        <option value="Helvetica" ${el.font_family === 'Helvetica' ? 'selected' : ''}>Helvetica</option>
                        <option value="Times New Roman" ${el.font_family === 'Times New Roman' ? 'selected' : ''}>Times New Roman</option>
                        <option value="Courier New" ${el.font_family === 'Courier New' ? 'selected' : ''}>Courier New</option>
                    </select>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Font Size (px)</label>
                        <input type="number" id="prop_font_size" value="${el.font_size || 14}" min="6" max="72">
                    </div>
                    <div class="form-group">
                        <label>Font Weight</label>
                        <select id="prop_font_weight">
                            <option value="normal" ${el.font_weight === 'normal' ? 'selected' : ''}>Normal</option>
                            <option value="bold" ${el.font_weight === 'bold' ? 'selected' : ''}>Bold</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Text Align</label>
                    <select id="prop_text_align">
                        <option value="left" ${el.text_align === 'left' ? 'selected' : ''}>Left</option>
                        <option value="center" ${el.text_align === 'center' ? 'selected' : ''}>Center</option>
                        <option value="right" ${el.text_align === 'right' ? 'selected' : ''}>Right</option>
                    </select>
                </div>
            </div>

            <div class="property-group">
                <h3>Colors</h3>
                <div class="form-group">
                    <label>Text Color</label>
                    <div class="color-input">
                        <input type="color" id="prop_text_color" value="${el.text_color || '#000000'}">
                        <input type="text" value="${el.text_color || '#000000'}" readonly>
                    </div>
                </div>
                <div class="form-group">
                    <label>Background Color</label>
                    <div class="color-input">
                        <input type="color" id="prop_background_color" value="${el.background_color === 'transparent' ? '#FFFFFF' : (el.background_color || '#FFFFFF')}">
                        <input type="text" value="${el.background_color || 'transparent'}" readonly>
                    </div>
                </div>
            </div>

            ${el.element_type === 'static_text' || el.element_type === 'text' ? `
                <div class="property-group">
                    <h3>Content</h3>
                    <div class="form-group">
                        <label>Static Content</label>
                        <textarea id="prop_static_content" rows="3">${el.static_content || ''}</textarea>
                    </div>
                </div>
            ` : ''}

            ${el.element_type === 'data_field' ? `
                <div class="property-group">
                    <h3>Data Binding</h3>
                    <div class="form-group">
                        <label>Label/Prefix</label>
                        <input type="text" id="prop_static_content" value="${el.static_content || ''}">
                    </div>
                    <div class="form-group">
                        <label>Data Binding</label>
                        <input type="text" id="prop_data_binding" value="${el.data_binding || ''}" placeholder="patient.PatientName">
                    </div>
                    <div class="form-group">
                        <label>Format Pattern</label>
                        <input type="text" id="prop_format_pattern" value="${el.format_pattern || ''}" placeholder="currency, date:MMM DD, YYYY">
                    </div>
                </div>
            ` : ''}

            <div style="margin-top: 20px;">
                <button class="btn btn-success" style="width: 100%;" id="applyPropertiesBtn">
                    Apply Changes
                </button>
            </div>
        `;

        // Add event listeners
        document.getElementById('applyPropertiesBtn').addEventListener('click', () => {
            this.applyProperties();
        });

        // Live update for position
        ['pos_x', 'pos_y', 'width', 'height'].forEach(prop => {
            const input = document.getElementById(`prop_${prop}`);
            if (input) {
                input.addEventListener('input', () => this.applyProperties());
            }
        });
    }

    updatePropertiesForm() {
        if (!this.selectedElement) return;

        const el = this.selectedElement;
        const setValue = (id, value) => {
            const input = document.getElementById(id);
            if (input) input.value = value;
        };

        setValue('prop_pos_x', el.pos_x);
        setValue('prop_pos_y', el.pos_y);
    }

    applyProperties() {
        if (!this.selectedElement) return;

        const getValue = (id) => {
            const input = document.getElementById(id);
            return input ? input.value : null;
        };

        // Update element properties
        this.selectedElement.element_name = getValue('prop_element_name');
        this.selectedElement.pos_x = parseFloat(getValue('prop_pos_x')) || 0;
        this.selectedElement.pos_y = parseFloat(getValue('prop_pos_y')) || 0;
        this.selectedElement.width = parseFloat(getValue('prop_width')) || 0;
        this.selectedElement.height = parseFloat(getValue('prop_height')) || 0;
        this.selectedElement.font_family = getValue('prop_font_family');
        this.selectedElement.font_size = parseInt(getValue('prop_font_size')) || 14;
        this.selectedElement.font_weight = getValue('prop_font_weight');
        this.selectedElement.text_align = getValue('prop_text_align');
        this.selectedElement.text_color = getValue('prop_text_color');
        this.selectedElement.background_color = getValue('prop_background_color');

        if (getValue('prop_static_content') !== null) {
            this.selectedElement.static_content = getValue('prop_static_content');
        }
        if (getValue('prop_data_binding') !== null) {
            this.selectedElement.data_binding = getValue('prop_data_binding');
        }
        if (getValue('prop_format_pattern') !== null) {
            this.selectedElement.format_pattern = getValue('prop_format_pattern');
        }

        // Re-render canvas to show changes
        this.renderCanvas();
        this.selectElement(this.selectedElement.element_id);
    }

    async saveTemplate() {
        this.showLoading(true);

        try {
            // Update each element
            for (const element of this.elements) {
                await this.updateElement(element);
            }

            this.showToast('Template saved successfully!', 'success');
        } catch (error) {
            console.error('Failed to save template:', error);
            this.showToast('Failed to save template', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async updateElement(element) {
        const response = await fetch(`/api/templates/elements/${element.element_id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(element)
        });

        const result = await response.json();
        if (result.status !== 'success') {
            throw new Error(result.message);
        }
    }

    async reloadTemplate() {
        this.showLoading(true);
        try {
            await this.loadTemplate(this.template.template_id);
            this.renderElementList();
            this.renderCanvas();
            this.selectedElement = null;
            this.renderPropertiesPanel();
            this.showToast('Template reloaded', 'success');
        } catch (error) {
            this.showToast('Failed to reload', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async previewTemplate() {
        // Open preview in new window
        const url = `/api/templates/${this.template.template_id}/preview`;
        window.open(url, '_blank', 'width=400,height=600');
    }

    updateCanvasZoom() {
        const canvas = document.getElementById('templateCanvas');
        canvas.style.transform = `scale(${this.zoom})`;
    }

    mmToPx(mm) {
        return Math.round((mm * 96) / 25.4);
    }

    showLoading(show) {
        document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
    }

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize designer when page loads
document.addEventListener('DOMContentLoaded', () => {
    new TemplateDesigner();
});
