// components/table.js
/**
 * Table component
 * Provides a reusable table with sorting, filtering and pagination
 */
import { createElement, createNode, appendElement, getElement, getElements } from '../core/dom.js';
import { generateId } from '../core/utils.js';

export class Table {
  /**
   * Create a new table component
   * @param {string|HTMLElement} container - Container element or selector
   * @param {Object} options - Table options
   */
  constructor(container, options = {}) {
    // Get container element
    this.container = typeof container === 'string' 
      ? getElement(container) 
      : container;
      
    if (!this.container) {
      throw new Error('Invalid table container');
    }
    
    // Default options
    this.options = Object.assign({
      id: `table-${generateId(6)}`,
      columns: [],
      data: [],
      responsive: true,
      sortable: true,
      filterable: false,
      paginated: false,
      pageSize: 10,
      currentPage: 1,
      rowsPerPageOptions: [10, 25, 50, 100],
      showFooter: false,
      className: '',
      rowClassName: '',
      cellClassName: '',
      noDataMessage: 'No data available',
      onRowClick: null,
      onCellClick: null,
      onSort: null,
      onFilter: null,
      onPageChange: null
    }, options);
    
    // Set up internal state
    this.state = {
      sortColumn: null,
      sortDirection: 'asc',
      filters: {},
      selectedRows: new Set(),
      processedData: [...this.options.data]
    };
    
    // Create table elements
    this.create();
    
    // Process data
    this.processData();
    
    // Render initial table
    this.render();
  }
  
  /**
   * Create table elements
   * @private
   */
  create() {
    // Create wrapper if responsive
    if (this.options.responsive) {
      this.wrapper = createElement('div', {
        className: 'table-responsive'
      });
      appendElement(this.container, this.wrapper);
    } else {
      this.wrapper = this.container;
    }
    
    // Create table element
    this.table = createElement('table', {
      id: this.options.id,
      className: this.options.className
    });
    
    // Create table header, body and footer
    this.thead = createElement('thead');
    this.tbody = createElement('tbody');
    
    // Create footer if needed
    if (this.options.showFooter) {
      this.tfoot = createElement('tfoot');
      appendElement(this.table, this.tfoot);
    }
    
    // Assemble table
    appendElement(this.table, this.thead);
    appendElement(this.table, this.tbody);
    appendElement(this.wrapper, this.table);
    
    // Create filter row if needed
    if (this.options.filterable) {
      this.createFilterRow();
    }
    
    // Create pagination if needed
    if (this.options.paginated) {
      this.createPagination();
    }
  }
  
  /**
   * Create filter row
   * @private
   */
  createFilterRow() {
    this.filterRow = createElement('tr', {
      className: 'table-filter-row'
    });
    
    this.options.columns.forEach(column => {
      const cell = createElement('th');
      
      if (column.filterable !== false) {
        const input = createElement('input', {
          type: 'text',
          placeholder: `Filter ${column.title}`,
          events: {
            input: (event) => this.handleFilterChange(column.field, event.target.value)
          }
        });
        
        appendElement(cell, input);
      }
      
      appendElement(this.filterRow, cell);
    });
    
    this.thead.appendChild(this.filterRow);
  }
  
  /**
   * Create pagination elements
   * @private
   */
  createPagination() {
    this.pagination = createElement('div', {
      className: 'table-pagination'
    });
    
    // Create page size selector
    this.pageSizeSelector = createElement('div', {
      className: 'page-size-selector'
    });
    
    const pageSizeLabel = createElement('span', {}, 'Rows per page: ');
    const pageSizeSelect = createElement('select', {
      events: {
        change: (event) => this.setPageSize(parseInt(event.target.value, 10))
      }
    });
    
    this.options.rowsPerPageOptions.forEach(size => {
      const option = createElement('option', {
        value: size,
        selected: size === this.options.pageSize
      }, size.toString());
      
      appendElement(pageSizeSelect, option);
    });
    
    appendElement(this.pageSizeSelector, pageSizeLabel);
    appendElement(this.pageSizeSelector, pageSizeSelect);
    
    // Create pagination controls
    this.paginationControls = createElement('div', {
      className: 'pagination-controls'
    });
    
    // Previous button
    this.prevButton = createElement('button', {
      type: 'button',
      className: 'pagination-prev',
      events: {
        click: () => this.prevPage()
      }
    }, '&laquo; Prev');
    
    // Next button
    this.nextButton = createElement('button', {
      type: 'button',
      className: 'pagination-next',
      events: {
        click: () => this.nextPage()
      }
    }, 'Next &raquo;');
    
    // Page info
    this.pageInfo = createElement('span', {
      className: 'pagination-info'
    });
    
    appendElement(this.paginationControls, this.prevButton);
    appendElement(this.paginationControls, this.pageInfo);
    appendElement(this.paginationControls, this.nextButton);
    
    // Assemble pagination
    appendElement(this.pagination, this.pageSizeSelector);
    appendElement(this.pagination, this.paginationControls);
    
    // Add pagination after table
    this.container.insertBefore(this.pagination, this.wrapper.nextSibling);
  }
  
  /**
   * Apply filters, sorting and pagination to data
   * @private
   */
  processData() {
    let data = [...this.options.data];
    
    // Apply filters
    if (Object.keys(this.state.filters).length > 0) {
      data = this.applyFilters(data);
    }
    
    // Apply sorting
    if (this.state.sortColumn) {
      data = this.applySorting(data);
    }
    
    // Store total count before pagination
    this.state.totalCount = data.length;
    
    // Apply pagination
    if (this.options.paginated) {
      data = this.applyPagination(data);
    }
    
    this.state.processedData = data;
  }
  
  /**
   * Apply filters to data
   * @param {Array} data - Data to filter
   * @returns {Array} - Filtered data
   * @private
   */
  applyFilters(data) {
    return data.filter(row => {
      return Object.entries(this.state.filters).every(([field, value]) => {
        if (!value) return true;
        
        const fieldValue = row[field];
        if (fieldValue === undefined || fieldValue === null) return false;
        
        return String(fieldValue).toLowerCase().includes(value.toLowerCase());
      });
    });
  }
  
  /**
   * Apply sorting to data
   * @param {Array} data - Data to sort
   * @returns {Array} - Sorted data
   * @private
   */
  applySorting(data) {
    const { sortColumn, sortDirection } = this.state;
    const column = this.options.columns.find(col => col.field === sortColumn);
    
    if (!column) return data;
    
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    
    return [...data].sort((a, b) => {
      let valueA = a[sortColumn];
      let valueB = b[sortColumn];
      
      // Use custom sort function if available
      if (typeof column.sortFn === 'function') {
        return multiplier * column.sortFn(valueA, valueB, a, b);
      }
      
      // Default sorting logic
      if (valueA === null || valueA === undefined) return multiplier;
      if (valueB === null || valueB === undefined) return -multiplier;
      
      if (typeof valueA === 'string') valueA = valueA.toLowerCase();
      if (typeof valueB === 'string') valueB = valueB.toLowerCase();
      
      if (valueA < valueB) return -multiplier;
      if (valueA > valueB) return multiplier;
      return 0;
    });
  }
  
  /**
   * Apply pagination to data
   * @param {Array} data - Data to paginate
   * @returns {Array} - Paginated data
   * @private
   */
  applyPagination(data) {
    const { pageSize, currentPage } = this.options;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    
    return data.slice(startIndex, endIndex);
  }
  
  /**
   * Render table header
   * @private
   */
  renderHeader() {
    // Clear header
    this.thead.innerHTML = '';
    
    // Create header row
    const headerRow = createElement('tr');
    
    // Add column headers
    this.options.columns.forEach(column => {
      const th = createElement('th', {
        className: column.headerClassName || ''
      });
      
      // Set column width if specified
      if (column.width) {
        th.style.width = typeof column.width === 'number' 
          ? `${column.width}px` 
          : column.width;
      }
      
      // Add sort indicator if sortable
      if (this.options.sortable && column.sortable !== false) {
        const headerContent = createElement('div', {
          className: 'sortable-header',
          events: {
            click: () => this.handleSort(column.field)
          }
        });
        
        const titleSpan = createElement('span', {}, column.title || column.field);
        appendElement(headerContent, titleSpan);
        
        // Add sort icon if this column is currently sorted
        if (this.state.sortColumn === column.field) {
          const sortIcon = createElement('span', {
            className: `sort-icon ${this.state.sortDirection}`
          }, this.state.sortDirection === 'asc' ? '▲' : '▼');
          
          appendElement(headerContent, sortIcon);
        }
        
        appendElement(th, headerContent);
      } else {
        th.textContent = column.title || column.field;
      }
      
      appendElement(headerRow, th);
    });
    
    appendElement(this.thead, headerRow);
    
    // Re-add filter row if needed
    if (this.options.filterable && this.filterRow) {
      appendElement(this.thead, this.filterRow);
    }
  }
  
  /**
   * Render table body
   * @private
   */
// This is the modified renderBody method for your table.js component
renderBody() {
  // Clear body
  this.tbody.innerHTML = '';
  
  const { processedData } = this.state;
  
  // Show "no data" message if no data
  if (processedData.length === 0) {
    const noDataRow = createElement('tr');
    const noDataCell = createElement('td', {
      colSpan: this.options.columns.length,
      className: 'no-data-cell'
    }, this.options.noDataMessage);
    
    appendElement(noDataRow, noDataCell);
    appendElement(this.tbody, noDataRow);
    return;
  }
  
  // Create rows
  processedData.forEach((rowData, rowIndex) => {
    // Create row
    const row = createElement('tr', {
      className: typeof this.options.rowClassName === 'function' 
        ? this.options.rowClassName(rowData) 
        : this.options.rowClassName,
      dataset: {
        index: rowIndex
      },
      events: {
        click: (event) => {
          if (typeof this.options.onRowClick === 'function') {
            this.options.onRowClick(rowData, rowIndex, event);
          }
        }
      }
    });
    
    // Add selected class if row is selected
    if (this.state.selectedRows.has(rowIndex)) {
      row.classList.add('selected');
    }
    
    // Create cells
    this.options.columns.forEach((column, colIndex) => {
      const cellValue = rowData[column.field];
      
      // Get cell class name
      let cellClassName = this.options.cellClassName || '';
      if (column.cellClassName) {
        if (typeof column.cellClassName === 'function') {
          cellClassName += ' ' + (column.cellClassName(cellValue, rowData) || '');
        } else {
          cellClassName += ' ' + column.cellClassName;
        }
      }
      
      // Create cell
      const cell = createElement('td', {
        className: cellClassName,
        events: {
          click: (event) => {
            if (typeof this.options.onCellClick === 'function') {
              this.options.onCellClick(cellValue, rowData, column, rowIndex, colIndex, event);
            }
            
            // Prevent row click if cell click handled
            event.stopPropagation();
          }
        }
      });
      
      // Format cell content
      if (typeof column.render === 'function') {
        // Custom renderer
        const rendered = column.render(cellValue, rowData, rowIndex, colIndex);
        
        if (typeof rendered === 'string') {
          cell.innerHTML = rendered;
        } else if (rendered instanceof HTMLElement) {
          appendElement(cell, rendered);
        } else if (rendered && typeof rendered === 'object' && 'content' in rendered) {
          // Handle objects with content and style properties
          cell.innerHTML = rendered.content !== undefined ? rendered.content : '';
          
          // Apply style properties if provided
          if (rendered.style && typeof rendered.style === 'object') {
            Object.entries(rendered.style).forEach(([prop, value]) => {
              cell.style[prop] = value;
            });
          }
        } else {
          cell.textContent = String(rendered);
        }
      } else {
        // Default rendering
        cell.textContent = cellValue !== undefined && cellValue !== null 
          ? String(cellValue) 
          : '';
      }
      
      appendElement(row, cell);
    });
    
    appendElement(this.tbody, row);
  });
}
  
  /**
   * Render table footer
   * @private
   */
  renderFooter() {
    if (!this.options.showFooter || !this.tfoot) return;
    
    // Clear footer
    this.tfoot.innerHTML = '';
    
    // Create footer row
    const footerRow = createElement('tr');
    
    // Add column footers
    this.options.columns.forEach(column => {
      const td = createElement('td', {
        className: column.footerClassName || ''
      });
      
      // Use footer content from column definition
      if (column.footer !== undefined) {
        if (typeof column.footer === 'function') {
          const rendered = column.footer(this.options.data);
          
          if (typeof rendered === 'string') {
            td.innerHTML = rendered;
          } else if (rendered instanceof HTMLElement) {
            appendElement(td, rendered);
          } else {
            td.textContent = String(rendered);
          }
        } else {
          td.textContent = column.footer;
        }
      }
      
      appendElement(footerRow, td);
    });
    
    appendElement(this.tfoot, footerRow);
  }
  
  /**
   * Update pagination UI
   * @private
   */
  updatePagination() {
    if (!this.options.paginated) return;
    
    // Calculate pagination info
    const { pageSize, currentPage } = this.options;
    const totalCount = this.state.totalCount || 0;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startItem = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(startItem + pageSize - 1, totalCount);
    
    // Update page info
    this.pageInfo.textContent = `${startItem}-${endItem} of ${totalCount}`;
    
    // Update button states
    this.prevButton.disabled = currentPage <= 1;
    this.nextButton.disabled = currentPage >= totalPages;
  }
  
  /**
   * Render the entire table
   * @private
   */
  render() {
    this.renderHeader();
    this.renderBody();
    this.renderFooter();
    
    if (this.options.paginated) {
      this.updatePagination();
    }

  }
  
  /**
   * Handle column sort
   * @param {string} field - Field to sort by
   * @private
   */
  handleSort(field) {
    // Toggle sort direction if same column
    if (this.state.sortColumn === field) {
      this.state.sortDirection = this.state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.state.sortColumn = field;
      this.state.sortDirection = 'asc';
    }
    
    // Process data and re-render
    this.processData();
    this.render();
    
    // Call onSort callback
    if (typeof this.options.onSort === 'function') {
      this.options.onSort(field, this.state.sortDirection);
    }
  }
  
  /**
   * Handle filter change
   * @param {string} field - Field to filter
   * @param {string} value - Filter value
   * @private
   */
  handleFilterChange(field, value) {
    if (value === '') {
      delete this.state.filters[field];
    } else {
      this.state.filters[field] = value;
    }
    
    // Reset to first page when filtering
    this.options.currentPage = 1;
    
    // Process data and re-render
    this.processData();
    this.render();
    
    // Call onFilter callback
    if (typeof this.options.onFilter === 'function') {
      this.options.onFilter(this.state.filters);
    }
  }
  
  /**
   * Go to previous page
   * @returns {Table} - This instance for chaining
   */
  prevPage() {
    if (this.options.currentPage > 1) {
      this.options.currentPage--;
      this.processData();
      this.render();
      
      // Call onPageChange callback
      if (typeof this.options.onPageChange === 'function') {
        this.options.onPageChange(this.options.currentPage);
      }
    }
    
    return this;
  }
  
  /**
   * Go to next page
   * @returns {Table} - This instance for chaining
   */
  nextPage() {
    const totalPages = Math.ceil(this.state.totalCount / this.options.pageSize);
    
    if (this.options.currentPage < totalPages) {
      this.options.currentPage++;
      this.processData();
      this.render();
      
      // Call onPageChange callback
      if (typeof this.options.onPageChange === 'function') {
        this.options.onPageChange(this.options.currentPage);
      }
    }
    
    return this;
  }
  
  /**
   * Go to a specific page
   * @param {number} page - Page number
   * @returns {Table} - This instance for chaining
   */
  goToPage(page) {
    const totalPages = Math.ceil(this.state.totalCount / this.options.pageSize);
    
    if (page >= 1 && page <= totalPages) {
      this.options.currentPage = page;
      this.processData();
      this.render();
      
      // Call onPageChange callback
      if (typeof this.options.onPageChange === 'function') {
        this.options.onPageChange(this.options.currentPage);
      }
    }
    
    return this;
  }
  
  /**
   * Set page size
   * @param {number} size - Page size
   * @returns {Table} - This instance for chaining
   */
  setPageSize(size) {
    if (size > 0) {
      this.options.pageSize = size;
      this.options.currentPage = 1; // Reset to first page
      this.processData();
      this.render();
    }
    
    return this;
  }
  
  /**
   * Set table data
   * @param {Array} data - Table data
   * @returns {Table} - This instance for chaining
   */
  setData(data) {
    this.options.data = data || [];
    this.options.currentPage = 1; // Reset to first page
    this.processData();
    this.render();
    
    return this;
  }
  
  /**
   * Add row
   * @param {Object} rowData - Row data
   * @returns {Table} - This instance for chaining
   */
  addRow(rowData) {
    this.options.data.push(rowData);
    this.processData();
    this.render();
    
    return this;
  }
  
  /**
   * Update row
   * @param {number} index - Row index
   * @param {Object} rowData - New row data
   * @returns {Table} - This instance for chaining
   */
  updateRow(index, rowData) {
    if (index >= 0 && index < this.options.data.length) {
      this.options.data[index] = rowData;
      this.processData();
      this.render();
    }
    
    return this;
  }
  
  /**
   * Delete row
   * @param {number} index - Row index
   * @returns {Table} - This instance for chaining
   */
  deleteRow(index) {
    if (index >= 0 && index < this.options.data.length) {
      this.options.data.splice(index, 1);
      this.processData();
      this.render();
    }
    
    return this;
  }
  
  /**
   * Select row
   * @param {number} index - Row index
   * @returns {Table} - This instance for chaining
   */
  selectRow(index) {
    if (index >= 0 && index < this.options.data.length) {
      this.state.selectedRows.add(index);
      this.render();
    }
    
    return this;
  }
  
  /**
   * Deselect row
   * @param {number} index - Row index
   * @returns {Table} - This instance for chaining
   */
  deselectRow(index) {
    this.state.selectedRows.delete(index);
    this.render();
    
    return this;
  }
  
  /**
   * Clear row selection
   * @returns {Table} - This instance for chaining
   */
  clearSelection() {
    this.state.selectedRows.clear();
    this.render();
    
    return this;
  }
  
  /**
   * Get selected rows
   * @returns {Array} - Selected rows
   */
  getSelectedRows() {
    const selectedRows = [];
    
    for (const index of this.state.selectedRows) {
      if (index < this.options.data.length) {
        selectedRows.push(this.options.data[index]);
      }
    }
    
    return selectedRows;
  }
  
  /**
   * Refresh the table
   * @returns {Table} - This instance for chaining
   */
  refresh() {
    this.processData();
    this.render();
    
    return this;
  }
  
  /**
   * Destroy the table and clean up
   */
  destroy() {
    // Clean up references
    this.table = null;
    this.thead = null;
    this.tbody = null;
    this.tfoot = null;
    this.filterRow = null;
    this.pagination = null;
    this.pageSizeSelector = null;
    this.paginationControls = null;
    this.prevButton = null;
    this.nextButton = null;
    this.pageInfo = null;
    
    // Clear container
    this.container.innerHTML = '';
  }
}

// Export default constructor
export default Table;