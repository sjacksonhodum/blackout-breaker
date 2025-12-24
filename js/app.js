/**
 * Main Application for Blackout Breaker
 * Handles file uploads, UI interactions, and view synchronization
 */

class BlackoutBreaker {
    constructor() {
        this.processor = new PDFProcessor();
        this.documents = new Map(); // Store uploaded documents
        this.currentDocId = null;
        this.currentView = 'split';
        this.highlightedRedaction = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupScrollSync();
    }

    /**
     * Set up all event listeners
     */
    setupEventListeners() {
        // File upload buttons
        document.getElementById('uploadFileBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        
        document.getElementById('uploadFolderBtn').addEventListener('click', () => {
            document.getElementById('folderInput').click();
        });
        
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files);
            e.target.value = ''; // Reset for re-upload
        });
        
        document.getElementById('folderInput').addEventListener('change', (e) => {
            this.handleFolderUpload(e.target.files);
            e.target.value = '';
        });
        
        // Navigation tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchView(e.target.closest('.nav-tab').dataset.view);
            });
        });
        
        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterDocuments(e.target.value);
        });
        
        // Zoom controls
        document.getElementById('zoomIn').addEventListener('click', () => this.zoom(0.25));
        document.getElementById('zoomOut').addEventListener('click', () => this.zoom(-0.25));
        
        // Page navigation
        document.getElementById('prevPage').addEventListener('click', () => this.navigatePage(-1));
        document.getElementById('nextPage').addEventListener('click', () => this.navigatePage(1));
        document.getElementById('currentPage').addEventListener('change', (e) => {
            this.goToPage(parseInt(e.target.value));
        });
        
        // Download
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadFixed());
        
        // Resize handle
        this.setupResizeHandle();
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    /**
     * Set up drag and drop for file uploads
     */
    setupDragAndDrop() {
        const overlay = document.getElementById('dropOverlay');
        let dragCounter = 0;
        
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            overlay.classList.add('active');
        });
        
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter === 0) {
                overlay.classList.remove('active');
            }
        });
        
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.classList.remove('active');
            
            const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
            if (files.length > 0) {
                this.handleFileUpload(files);
            }
        });
    }

    /**
     * Set up synchronized scrolling between panes
     */
    setupScrollSync() {
        const originalViewer = document.getElementById('originalViewer');
        const fixedViewer = document.getElementById('fixedViewer');
        
        let isSyncing = false;
        
        const syncScroll = (source, target) => {
            if (isSyncing) return;
            isSyncing = true;
            
            const scrollRatioX = source.scrollLeft / (source.scrollWidth - source.clientWidth || 1);
            const scrollRatioY = source.scrollTop / (source.scrollHeight - source.clientHeight || 1);
            
            target.scrollLeft = scrollRatioX * (target.scrollWidth - target.clientWidth);
            target.scrollTop = scrollRatioY * (target.scrollHeight - target.clientHeight);
            
            // Update page indicator based on scroll position
            this.updatePageIndicatorOnScroll(source);
            
            requestAnimationFrame(() => {
                isSyncing = false;
            });
        };
        
        originalViewer.addEventListener('scroll', () => {
            syncScroll(originalViewer, fixedViewer);
            this.updatePageIndicatorOnScroll(originalViewer);
        });
        fixedViewer.addEventListener('scroll', () => {
            syncScroll(fixedViewer, originalViewer);
            this.updatePageIndicatorOnScroll(fixedViewer);
        });
    }

    /**
     * Update page indicator based on scroll position
     */
    updatePageIndicatorOnScroll(viewer) {
        const doc = this.documents.get(this.currentDocId);
        if (!doc) return;
        
        const pageWrappers = viewer.querySelectorAll('.page-wrapper');
        if (pageWrappers.length === 0) return;
        
        const viewerRect = viewer.getBoundingClientRect();
        const viewerMiddle = viewerRect.top + viewerRect.height / 2;
        
        let currentPage = 1;
        
        for (const wrapper of pageWrappers) {
            const rect = wrapper.getBoundingClientRect();
            if (rect.top <= viewerMiddle && rect.bottom >= viewerRect.top) {
                currentPage = parseInt(wrapper.dataset.page) || 1;
            }
        }
        
        document.getElementById('currentPage').value = currentPage;
    }

    /**
     * Set up pane resize functionality
     */
    setupResizeHandle() {
        const handle = document.getElementById('resizeHandle');
        const container = document.querySelector('.pane-container');
        const leftPane = document.querySelector('.original-pane');
        const rightPane = document.querySelector('.fixed-pane');
        
        let isResizing = false;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const containerRect = container.getBoundingClientRect();
            const percentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;
            
            if (percentage > 20 && percentage < 80) {
                leftPane.style.flex = `0 0 ${percentage}%`;
                rightPane.style.flex = `0 0 ${100 - percentage - 1}%`;
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboard(e) {
        if (document.activeElement.tagName === 'INPUT') return;
        
        switch (e.key) {
            case 'ArrowLeft':
                this.navigatePage(-1);
                break;
            case 'ArrowRight':
                this.navigatePage(1);
                break;
            case 's':
                this.switchView('split');
                break;
            case 'd':
                this.switchView('diff');
                break;
        }
    }

    /**
     * Handle single/multiple file upload
     */
    async handleFileUpload(files) {
        const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
        
        if (pdfFiles.length === 0) {
            this.showToast('Please upload PDF files', 'error');
            return;
        }
        
        for (const file of pdfFiles) {
            await this.processFile(file);
        }
    }

    /**
     * Handle folder upload
     */
    async handleFolderUpload(files) {
        const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
        
        if (pdfFiles.length === 0) {
            this.showToast('No PDF files found in folder', 'error');
            return;
        }
        
        this.showToast(`Found ${pdfFiles.length} PDF files`, 'info');
        
        for (const file of pdfFiles) {
            await this.processFile(file);
        }
    }

    /**
     * Process a single PDF file
     */
    async processFile(file) {
        const docId = this.generateDocId(file.name);
        
        // Show processing modal
        this.showProcessingModal(true, 'Loading PDF...');
        
        try {
            this.updateProcessingStatus('Analyzing document...');
            const result = await this.processor.loadPdf(file);
            
            this.updateProcessingStatus('Detecting redactions...');
            
            // Store document data
            const docData = {
                id: docId,
                name: file.name,
                file: file,
                numPages: result.numPages,
                pages: result.pages,
                redactions: result.redactions,
                isFixed: false,
                dateAdded: new Date()
            };
            
            this.documents.set(docId, docData);
            
            // Update UI
            this.updateFileList();
            this.selectDocument(docId);
            
            this.showProcessingModal(false);
            this.showToast(`Loaded: ${file.name} (${result.redactions.length} redactions found)`, 'success');
            
        } catch (error) {
            console.error('Error processing PDF:', error);
            this.showProcessingModal(false);
            this.showToast(`Error loading ${file.name}`, 'error');
        }
    }

    /**
     * Generate a unique document ID
     */
    generateDocId(filename) {
        return `doc_${Date.now()}_${filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    /**
     * Update the file list in sidebar
     */
    updateFileList() {
        const fileTree = document.getElementById('fileTree');
        const docs = Array.from(this.documents.values());
        
        if (docs.length === 0) {
            fileTree.innerHTML = `
                <div class="empty-state-sidebar">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>Upload PDFs to get started</p>
                </div>
            `;
        } else {
            fileTree.innerHTML = docs.map(doc => `
                <div class="file-item ${doc.id === this.currentDocId ? 'active' : ''}" data-id="${doc.id}">
                    <i class="fas fa-file-pdf file-icon"></i>
                    <div class="file-info">
                        <div class="file-name">${doc.name}</div>
                        <div class="file-meta">${doc.numPages} pages • ${doc.redactions.length} redactions</div>
                    </div>
                    ${doc.isFixed ? '<span class="status-badge fixed">Fixed</span>' : '<span class="status-badge pending">Pending</span>'}
                </div>
            `).join('');
            
            // Add click handlers
            fileTree.querySelectorAll('.file-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.selectDocument(item.dataset.id);
                });
            });
        }
        
        // Update counts
        document.getElementById('docCount').textContent = `${docs.length} files`;
        document.getElementById('totalFiles').textContent = docs.length;
        document.getElementById('fixedCount').textContent = docs.filter(d => d.isFixed).length;
    }

    /**
     * Select and display a document
     */
    selectDocument(docId) {
        const doc = this.documents.get(docId);
        if (!doc) return;
        
        this.currentDocId = docId;
        
        // Update active state in file list
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === docId);
        });
        
        // Render pages
        this.renderDocument(doc);
        
        // Update diff view
        this.renderDiffView(doc);
        
        // Update header info
        document.getElementById('diffFilename').textContent = doc.name;
        document.getElementById('redactionCount').textContent = `${doc.redactions.length} redactions detected`;
        document.getElementById('redactionsCountDiff').textContent = doc.redactions.length;
    }

    /**
     * Render document pages in both panes
     */
    renderDocument(doc) {
        const originalViewer = document.getElementById('originalViewer');
        const fixedViewer = document.getElementById('fixedViewer');
        
        // Create container for original pages (without text layer)
        const createOriginalPages = (pages) => {
            const container = document.createElement('div');
            container.className = 'pages-container';
            
            pages.forEach((page) => {
                const pageWrapper = document.createElement('div');
                pageWrapper.className = 'page-wrapper';
                pageWrapper.dataset.page = page.pageNum;
                pageWrapper.style.position = 'relative';
                
                const canvas = page.originalCanvas;
                const clonedCanvas = canvas.cloneNode(true);
                clonedCanvas.style.maxWidth = '100%';
                clonedCanvas.style.height = 'auto';
                
                // Draw the actual canvas content
                const ctx = clonedCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, 0);
                
                pageWrapper.appendChild(clonedCanvas);
                
                // Add redaction highlight overlays
                const highlightsContainer = document.createElement('div');
                highlightsContainer.className = 'redaction-highlights';
                highlightsContainer.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                `;
                
                page.redactions.forEach((redaction, rIndex) => {
                    const highlight = document.createElement('div');
                    highlight.className = 'redaction-highlight';
                    highlight.dataset.redactionIndex = rIndex;
                    highlight.dataset.page = page.pageNum;
                    // Use percentage positioning for responsiveness
                    highlight.style.cssText = `
                        position: absolute;
                        left: ${(redaction.x / page.width) * 100}%;
                        top: ${(redaction.y / page.height) * 100}%;
                        width: ${(redaction.width / page.width) * 100}%;
                        height: ${(redaction.height / page.height) * 100}%;
                    `;
                    highlightsContainer.appendChild(highlight);
                });
                
                pageWrapper.appendChild(highlightsContainer);
                container.appendChild(pageWrapper);
            });
            
            return container;
        };
        
        // Create container for fixed pages WITH text layer overlay
        const createFixedPages = (pages) => {
            const container = document.createElement('div');
            container.className = 'pages-container';
            
            pages.forEach((page) => {
                const pageWrapper = document.createElement('div');
                pageWrapper.className = 'page-wrapper';
                pageWrapper.dataset.page = page.pageNum;
                pageWrapper.style.position = 'relative';
                
                // Create a container that holds both canvas and text layer
                const pageContainer = document.createElement('div');
                pageContainer.className = 'pdf-page-container';
                pageContainer.style.cssText = `
                    position: relative;
                    display: inline-block;
                    max-width: 100%;
                `;
                
                // Clone and add the canvas (with black boxes whited out)
                const canvas = page.fixedCanvas;
                const clonedCanvas = canvas.cloneNode(true);
                clonedCanvas.style.maxWidth = '100%';
                clonedCanvas.style.height = 'auto';
                clonedCanvas.style.display = 'block';
                
                const ctx = clonedCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, 0);
                
                pageContainer.appendChild(clonedCanvas);
                
                // Create text layer container for the redacted areas only
                const textLayerDiv = document.createElement('div');
                textLayerDiv.className = 'text-layer-overlay';
                textLayerDiv.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    overflow: hidden;
                    pointer-events: none;
                    line-height: 1.0;
                `;
                
                // Render text items that are within redaction areas
                if (page.textContent && page.viewport) {
                    this.renderTextLayerForRedactions(textLayerDiv, page, clonedCanvas);
                }
                
                pageContainer.appendChild(textLayerDiv);
                pageWrapper.appendChild(pageContainer);
                container.appendChild(pageWrapper);
            });
            
            return container;
        };
        
        originalViewer.innerHTML = '';
        fixedViewer.innerHTML = '';
        
        originalViewer.appendChild(createOriginalPages(doc.pages));
        fixedViewer.appendChild(createFixedPages(doc.pages));
        
        // Update page info
        document.getElementById('totalPages').textContent = doc.numPages;
        document.getElementById('currentPage').value = 1;
        document.getElementById('currentPage').max = doc.numPages;
    }
    
    /**
     * Render text layer for redacted areas using PDF.js text content
     */
    renderTextLayerForRedactions(container, page, canvas) {
        const { textContent, viewport, redactions } = page;
        if (!textContent || !textContent.items) return;
        
        // Calculate scale from original viewport to displayed size
        // We need to wait for canvas to be in DOM to get actual size
        // So we use a ResizeObserver or requestAnimationFrame
        
        const renderText = () => {
            const displayWidth = canvas.offsetWidth || canvas.width;
            const displayHeight = canvas.offsetHeight || canvas.height;
            const scaleX = displayWidth / page.width;
            const scaleY = displayHeight / page.height;
            
            textContent.items.forEach((item, index) => {
                if (!item.str || item.str.trim() === '') return;
                
                // Skip "1111" placeholder text used as obstruction
                if (item.str.trim() === '1111') return;
                
                const transform = item.transform;
                const fontSize = Math.abs(transform[0]) || 12;
                
                // Transform PDF coordinates to canvas coordinates using viewport
                const pdfX = transform[4];
                const pdfY = transform[5];
                
                // Apply viewport transformation
                const vt = viewport.transform;
                const canvasX = vt[0] * pdfX + vt[4];
                const canvasY = vt[3] * pdfY + vt[5];
                
                // Check if this text is within any redaction area
                const scaledFontSize = fontSize * this.processor.scale;
                const textTop = canvasY - scaledFontSize;
                const textBottom = canvasY;
                const textLeft = canvasX;
                const textWidth = (item.width || (item.str.length * fontSize * 0.6)) * this.processor.scale;
                const textRight = textLeft + textWidth;
                
                let isInRedaction = false;
                for (const redaction of redactions) {
                    const overlapLeft = Math.max(textLeft, redaction.x);
                    const overlapRight = Math.min(textRight, redaction.x + redaction.width);
                    const horizontalOverlap = Math.max(0, overlapRight - overlapLeft);
                    
                    const textCenterY = (textTop + textBottom) / 2;
                    const verticalInside = textCenterY >= redaction.y && textCenterY <= redaction.y + redaction.height;
                    
                    if (horizontalOverlap > textWidth * 0.3 && verticalInside) {
                        isInRedaction = true;
                        break;
                    }
                }
                
                if (!isInRedaction) return;
                
                // Create a span for this text item
                const span = document.createElement('span');
                span.textContent = item.str;
                span.style.cssText = `
                    position: absolute;
                    left: ${canvasX * scaleX}px;
                    top: ${(canvasY - scaledFontSize) * scaleY}px;
                    font-size: ${scaledFontSize * scaleY}px;
                    font-family: sans-serif;
                    color: #000;
                    white-space: pre;
                    transform-origin: left top;
                    pointer-events: auto;
                `;
                
                container.appendChild(span);
            });
        };
        
        // Use requestAnimationFrame to ensure canvas is rendered
        requestAnimationFrame(renderText);
    }

    /**
     * Render the diff view showing all redactions
     */
    renderDiffView(doc) {
        const diffContent = document.getElementById('diffContent');
        
        if (doc.redactions.length === 0) {
            diffContent.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle" style="color: var(--accent-primary);"></i>
                    <p>No redactions detected in this document</p>
                </div>
            `;
            return;
        }
        
        // Group redactions by page
        const byPage = {};
        doc.redactions.forEach((r, index) => {
            if (!byPage[r.page]) byPage[r.page] = [];
            byPage[r.page].push({ ...r, globalIndex: index });
        });
        
        let html = '';
        
        Object.keys(byPage).sort((a, b) => a - b).forEach(pageNum => {
            html += `
                <div class="diff-page-header">
                    <i class="fas fa-file-alt"></i>
                    Page ${pageNum} - ${byPage[pageNum].length} redaction(s)
                </div>
            `;
            
            byPage[pageNum].forEach((redaction, index) => {
                // Get the hidden text if available
                const hiddenText = redaction.hiddenText && redaction.hiddenText.length > 0
                    ? redaction.hiddenText.map(t => t.text).join(' ')
                    : null;
                
                html += `
                    <div class="diff-item" data-page="${pageNum}" data-index="${redaction.globalIndex}">
                        <div class="diff-line-number">${index + 1}</div>
                        <div class="diff-item-content">
                            <div class="diff-location">
                                <div class="redaction-box"></div>
                                <span class="coords">x: ${Math.round(redaction.pdfX)}, y: ${Math.round(redaction.pdfY)}</span>
                            </div>
                            <div class="diff-size">${Math.round(redaction.pdfWidth)} × ${Math.round(redaction.pdfHeight)} px</div>
                            ${hiddenText ? `<div class="hidden-text-preview" title="${this.escapeHtml(hiddenText)}"><i class="fas fa-eye"></i> "${this.escapeHtml(hiddenText.substring(0, 50))}${hiddenText.length > 50 ? '...' : ''}"</div>` : '<div class="no-text-found"><i class="fas fa-question-circle"></i> No text layer</div>'}
                            <button class="jump-btn" data-page="${pageNum}" data-x="${redaction.x}" data-y="${redaction.y}" data-index="${redaction.globalIndex}">
                                <i class="fas fa-arrow-right"></i> Jump to
                            </button>
                        </div>
                    </div>
                `;
            });
        });
        
        diffContent.innerHTML = html;
        
        // Add click handlers for jump buttons
        diffContent.querySelectorAll('.jump-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = parseInt(e.currentTarget.dataset.page);
                const x = parseFloat(e.currentTarget.dataset.x);
                const y = parseFloat(e.currentTarget.dataset.y);
                const index = parseInt(e.currentTarget.dataset.index);
                
                this.jumpToRedaction(page, x, y, index);
            });
        });
    }

    /**
     * Escape HTML for safe display
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Jump to a specific redaction and highlight it
     */
    jumpToRedaction(pageNum, x, y, index) {
        // Switch to split view
        this.switchView('split');
        
        const originalViewer = document.getElementById('originalViewer');
        const fixedViewer = document.getElementById('fixedViewer');
        
        // Find the page wrapper
        const pageWrapper = originalViewer.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
        if (!pageWrapper) return;
        
        // Scroll to the page
        const viewerRect = originalViewer.getBoundingClientRect();
        const pageRect = pageWrapper.getBoundingClientRect();
        
        // Calculate scroll position to center the redaction
        const canvas = pageWrapper.querySelector('canvas');
        const scaleY = canvas.offsetHeight / canvas.height;
        const redactionY = y * scaleY;
        
        originalViewer.scrollTop = pageWrapper.offsetTop + redactionY - viewerRect.height / 2;
        
        // Highlight the redaction
        this.clearHighlights();
        
        const highlight = pageWrapper.querySelector(`.redaction-highlight[data-redaction-index="${index % 100}"]`);
        if (highlight) {
            highlight.classList.add('active');
            this.highlightedRedaction = { pageNum, index };
        }
        
        // Also highlight in diff view
        document.querySelectorAll('.diff-item').forEach(item => {
            item.classList.toggle('highlighted', parseInt(item.dataset.index) === index);
        });
        
        this.showToast(`Jumped to redaction on page ${pageNum}`, 'info');
    }

    /**
     * Clear all redaction highlights
     */
    clearHighlights() {
        document.querySelectorAll('.redaction-highlight.active').forEach(el => {
            el.classList.remove('active');
        });
        document.querySelectorAll('.diff-item.highlighted').forEach(el => {
            el.classList.remove('highlighted');
        });
        this.highlightedRedaction = null;
    }

    /**
     * Switch between split and diff views
     */
    switchView(view) {
        this.currentView = view;
        
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });

        document.getElementById('splitView').classList.toggle('active', view === 'split');
        document.getElementById('diffView').classList.toggle('active', view === 'diff');
    }

    /**
     * Zoom in/out
     */
    async zoom(delta) {
        const doc = this.documents.get(this.currentDocId);
        if (!doc) return;
        
        const newScale = await this.processor.setScale(this.processor.getScale() + delta);
        document.getElementById('zoomLevel').textContent = Math.round(newScale * 100 / 1.5) + '%';
        
        // Re-render
        const result = await this.processor.loadPdf(doc.file);
        doc.pages = result.pages;
        doc.redactions = result.redactions;
        this.renderDocument(doc);
    }

    /**
     * Navigate to next/previous page
     */
    navigatePage(delta) {
        const doc = this.documents.get(this.currentDocId);
        if (!doc) return;
        
        const currentPage = parseInt(document.getElementById('currentPage').value);
        const newPage = Math.max(1, Math.min(doc.numPages, currentPage + delta));
        
        this.goToPage(newPage);
    }

    /**
     * Go to specific page
     */
    goToPage(pageNum) {
        const doc = this.documents.get(this.currentDocId);
        if (!doc) return;
        
        pageNum = Math.max(1, Math.min(doc.numPages, pageNum));
        document.getElementById('currentPage').value = pageNum;
        
        const originalViewer = document.getElementById('originalViewer');
        const pageWrapper = originalViewer.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
        
        if (pageWrapper) {
            originalViewer.scrollTop = pageWrapper.offsetTop - 16;
        }
    }

    /**
     * Download the fixed version as PDF
     */
    async downloadFixed() {
        const doc = this.documents.get(this.currentDocId);
        if (!doc) {
            this.showToast('No document selected', 'error');
            return;
        }
        
        this.showToast('Generating PDF...', 'info');
        
        try {
            const fileName = await this.processor.downloadFixedPdf();
            
            if (fileName) {
                // Mark as fixed
                doc.isFixed = true;
                this.updateFileList();
                
                this.showToast(`Saved: ${fileName}`, 'success');
            } else {
                this.showToast('Failed to generate PDF', 'error');
            }
        } catch (error) {
            console.error('Error generating PDF:', error);
            this.showToast('Error generating PDF', 'error');
        }
    }

    /**
     * Filter documents by search query
     */
    filterDocuments(query) {
        const items = document.querySelectorAll('.file-item');
        const lowerQuery = query.toLowerCase();
        
        items.forEach(item => {
            const name = item.querySelector('.file-name').textContent.toLowerCase();
            item.style.display = name.includes(lowerQuery) ? 'flex' : 'none';
        });
    }

    /**
     * Show/hide processing modal
     */
    showProcessingModal(show, message = '') {
        const modal = document.getElementById('processingModal');
        modal.classList.toggle('active', show);
        if (message) {
            document.getElementById('processingStatus').textContent = message;
        }
    }

    /**
     * Update processing status message
     */
    updateProcessingStatus(message) {
        document.getElementById('processingStatus').textContent = message;
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icon = type === 'success' ? 'check-circle' : 
                     type === 'error' ? 'exclamation-circle' : 'info-circle';
        
        toast.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new BlackoutBreaker();
});
