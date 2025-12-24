/**
 * PDF Processor for Blackout Breaker
 * Handles PDF loading, redaction detection, text extraction, and rendering
 */

class PDFProcessor {
    constructor() {
        // Initialize PDF.js worker
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        
        this.currentPdf = null;
        this.pdfData = null;
        this.pages = [];
        this.redactions = [];
        this.scale = 1.5;
        this.fileName = '';
    }

    /**
     * Load a PDF from a File object
     */
    async loadPdf(file) {
        this.fileName = file.name;
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    this.pdfData = new Uint8Array(e.target.result);
                    const loadingTask = pdfjsLib.getDocument({ data: this.pdfData });
                    this.currentPdf = await loadingTask.promise;
                    this.pages = [];
                    this.redactions = [];
                    
                    // Process all pages
                    for (let i = 1; i <= this.currentPdf.numPages; i++) {
                        const page = await this.currentPdf.getPage(i);
                        const pageData = await this.processPage(page, i);
                        this.pages.push(pageData);
                    }
                    
                    resolve({
                        numPages: this.currentPdf.numPages,
                        pages: this.pages,
                        redactions: this.redactions
                    });
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Process a single page - render, detect redactions, and extract hidden text
     */
    async processPage(page, pageNum) {
        const viewport = page.getViewport({ scale: this.scale });
        
        // Create canvas for original
        const originalCanvas = document.createElement('canvas');
        const originalCtx = originalCanvas.getContext('2d');
        originalCanvas.width = viewport.width;
        originalCanvas.height = viewport.height;
        
        // Render original page
        await page.render({
            canvasContext: originalCtx,
            viewport: viewport
        }).promise;
        
        // Get ALL text content from the page (including hidden text under redactions)
        const textContent = await page.getTextContent();
        const textItems = textContent.items;
        
        // Detect redactions (black rectangles)
        const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
        const pageRedactions = this.detectRedactions(imageData, pageNum, viewport);
        
        // Find text that falls within redaction areas
        // Track which text items have been assigned to avoid duplicates
        const assignedTextIndices = new Set();
        
        for (const redaction of pageRedactions) {
            redaction.hiddenText = this.findTextInArea(textItems, redaction, viewport, assignedTextIndices);
        }
        
        // Create fixed canvas - just white out the black boxes (don't draw text on canvas)
        const fixedCanvas = document.createElement('canvas');
        const fixedCtx = fixedCanvas.getContext('2d');
        fixedCanvas.width = viewport.width;
        fixedCanvas.height = viewport.height;
        
        // Copy original
        fixedCtx.drawImage(originalCanvas, 0, 0);
        
        // Just white out the black redaction boxes
        for (const redaction of pageRedactions) {
            fixedCtx.fillStyle = '#FFFFFF';
            fixedCtx.fillRect(
                redaction.x - 1,
                redaction.y - 1,
                redaction.width + 2,
                redaction.height + 2
            );
        }
        
        // Add redactions to global list
        this.redactions.push(...pageRedactions);
        
        return {
            pageNum,
            width: viewport.width,
            height: viewport.height,
            pdfWidth: viewport.width / this.scale,
            pdfHeight: viewport.height / this.scale,
            originalCanvas,
            fixedCanvas,
            textContent, // Pass the full text content for text layer rendering
            viewport,    // Pass viewport for text layer positioning
            redactions: pageRedactions,
            textItems: textItems
        };
    }

    /**
     * Find text items that fall within a redaction area
     */
    findTextInArea(textItems, redaction, viewport, assignedTextIndices) {
        const foundText = [];
        
        for (let i = 0; i < textItems.length; i++) {
            // Skip if already assigned to another redaction
            if (assignedTextIndices.has(i)) continue;
            
            const item = textItems[i];
            if (!item.str || item.str.trim() === '') continue;
            
            // Skip "1111" placeholder text used as obstruction
            if (item.str.trim() === '1111') continue;
            
            // PDF.js transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
            const transform = item.transform;
            const fontSize = Math.abs(transform[0]) || 12;
            const itemWidth = item.width || (item.str.length * fontSize * 0.6);
            
            // Transform PDF coordinates to canvas coordinates using viewport
            const pdfX = transform[4];
            const pdfY = transform[5];
            
            // Apply viewport transformation
            const vt = viewport.transform;
            const canvasX = vt[0] * pdfX + vt[4];
            const canvasY = vt[3] * pdfY + vt[5];
            
            // Calculate text bounds
            const scaledWidth = itemWidth * this.scale;
            const scaledHeight = fontSize * this.scale;
            
            // Text bounds
            const textLeft = canvasX;
            const textRight = canvasX + scaledWidth;
            const textTop = canvasY - scaledHeight;
            const textBottom = canvasY;
            
            // Redaction bounds (no tolerance - we want text that's actually inside)
            const redactLeft = redaction.x;
            const redactRight = redaction.x + redaction.width;
            const redactTop = redaction.y;
            const redactBottom = redaction.y + redaction.height;
            
            // Calculate how much of the text is inside the redaction
            const overlapLeft = Math.max(textLeft, redactLeft);
            const overlapRight = Math.min(textRight, redactRight);
            const overlapWidth = Math.max(0, overlapRight - overlapLeft);
            
            const overlapTop = Math.max(textTop, redactTop);
            const overlapBottom = Math.min(textBottom, redactBottom);
            const overlapHeight = Math.max(0, overlapBottom - overlapTop);
            
            // Text must be at least 50% inside the redaction box horizontally
            // and the vertical center must be inside
            const textCenterY = (textTop + textBottom) / 2;
            const horizontalOverlapRatio = overlapWidth / scaledWidth;
            const verticalInside = textCenterY >= redactTop && textCenterY <= redactBottom;
            
            if (horizontalOverlapRatio >= 0.5 && verticalInside && overlapHeight > 0) {
                assignedTextIndices.add(i);
                foundText.push({
                    text: item.str,
                    x: canvasX,
                    y: canvasY,
                    width: scaledWidth,
                    height: scaledHeight,
                    fontSize: fontSize * this.scale,
                    transform: transform,
                    fontName: item.fontName,
                    index: i
                });
            }
        }
        
        // Sort by position (top to bottom, left to right)
        foundText.sort((a, b) => {
            if (Math.abs(a.y - b.y) < 5) {
                return a.x - b.x;
            }
            return a.y - b.y;
        });
        
        return foundText;
    }

    /**
     * Reveal the redacted text by removing black boxes and rendering the hidden text
     */
    revealRedactedText(ctx, redactions, viewport) {
        for (const redaction of redactions) {
            // First, paint over the black box with white
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(
                redaction.x - 1,
                redaction.y - 1,
                redaction.width + 2,
                redaction.height + 2
            );
            
            // Now render the hidden text with clipping to stay within bounds
            if (redaction.hiddenText && redaction.hiddenText.length > 0) {
                ctx.save();
                
                // Create clipping region to ensure text stays within redaction bounds
                ctx.beginPath();
                ctx.rect(redaction.x - 1, redaction.y - 1, redaction.width + 2, redaction.height + 2);
                ctx.clip();
                
                ctx.fillStyle = '#000000';
                ctx.textBaseline = 'alphabetic';
                
                for (const textItem of redaction.hiddenText) {
                    const fontSize = textItem.fontSize || 12;
                    ctx.font = `${fontSize}px sans-serif`;
                    ctx.fillText(textItem.text, textItem.x, textItem.y);
                }
                
                ctx.restore();
            }
        }
    }

    /**
     * Detect black rectangular redactions in the image
     */
    detectRedactions(imageData, pageNum, viewport) {
        const { data, width, height } = imageData;
        const redactions = [];
        const visited = new Set();
        
        // Threshold for "black" pixels
        const blackThreshold = 30;
        const minRedactionSize = 20;
        
        const isBlack = (x, y) => {
            if (x < 0 || x >= width || y < 0 || y >= height) return false;
            const idx = (y * width + x) * 4;
            return data[idx] < blackThreshold && 
                   data[idx + 1] < blackThreshold && 
                   data[idx + 2] < blackThreshold;
        };
        
        const getKey = (x, y) => `${x},${y}`;
        
        // Scan for black regions
        for (let y = 0; y < height; y += 5) {
            for (let x = 0; x < width; x += 5) {
                if (visited.has(getKey(x, y))) continue;
                
                if (isBlack(x, y)) {
                    let minX = x, maxX = x, minY = y, maxY = y;
                    
                    // Expand horizontally
                    while (minX > 0 && isBlack(minX - 1, y)) minX--;
                    while (maxX < width - 1 && isBlack(maxX + 1, y)) maxX++;
                    
                    // Expand vertically
                    let allBlackAbove = true, allBlackBelow = true;
                    
                    while (allBlackAbove && minY > 0) {
                        minY--;
                        for (let tx = minX; tx <= maxX; tx += 3) {
                            if (!isBlack(tx, minY)) {
                                allBlackAbove = false;
                                minY++;
                                break;
                            }
                        }
                    }
                    
                    while (allBlackBelow && maxY < height - 1) {
                        maxY++;
                        for (let tx = minX; tx <= maxX; tx += 3) {
                            if (!isBlack(tx, maxY)) {
                                allBlackBelow = false;
                                maxY--;
                                break;
                            }
                        }
                    }
                    
                    // Mark as visited
                    for (let vy = minY; vy <= maxY; vy += 5) {
                        for (let vx = minX; vx <= maxX; vx += 5) {
                            visited.add(getKey(vx, vy));
                        }
                    }
                    
                    const rectWidth = maxX - minX;
                    const rectHeight = maxY - minY;
                    
                    if (rectWidth >= minRedactionSize && rectHeight >= 8) {
                        let blackPixelCount = 0;
                        let totalPixels = 0;
                        
                        for (let vy = minY; vy <= maxY; vy += 2) {
                            for (let vx = minX; vx <= maxX; vx += 2) {
                                totalPixels++;
                                if (isBlack(vx, vy)) blackPixelCount++;
                            }
                        }
                        
                        if (blackPixelCount / totalPixels > 0.85) {
                            redactions.push({
                                page: pageNum,
                                x: minX,
                                y: minY,
                                width: rectWidth,
                                height: rectHeight,
                                pdfX: minX / this.scale,
                                pdfY: minY / this.scale,
                                pdfWidth: rectWidth / this.scale,
                                pdfHeight: rectHeight / this.scale,
                                hiddenText: []
                            });
                        }
                    }
                }
            }
        }
        
        return this.mergeRedactions(redactions);
    }

    /**
     * Merge overlapping or adjacent redactions
     */
    mergeRedactions(redactions) {
        if (redactions.length < 2) return redactions;
        
        const merged = [];
        const used = new Set();
        
        for (let i = 0; i < redactions.length; i++) {
            if (used.has(i)) continue;
            
            let current = { ...redactions[i] };
            used.add(i);
            
            let didMerge = true;
            while (didMerge) {
                didMerge = false;
                
                for (let j = 0; j < redactions.length; j++) {
                    if (used.has(j)) continue;
                    
                    const other = redactions[j];
                    const gap = 10;
                    
                    if (current.x - gap <= other.x + other.width &&
                        current.x + current.width + gap >= other.x &&
                        current.y - gap <= other.y + other.height &&
                        current.y + current.height + gap >= other.y) {
                        
                        const newX = Math.min(current.x, other.x);
                        const newY = Math.min(current.y, other.y);
                        const newMaxX = Math.max(current.x + current.width, other.x + other.width);
                        const newMaxY = Math.max(current.y + current.height, other.y + other.height);
                        
                        current.x = newX;
                        current.y = newY;
                        current.width = newMaxX - newX;
                        current.height = newMaxY - newY;
                        current.pdfX = newX / this.scale;
                        current.pdfY = newY / this.scale;
                        current.pdfWidth = current.width / this.scale;
                        current.pdfHeight = current.height / this.scale;
                        
                        used.add(j);
                        didMerge = true;
                    }
                }
            }
            
            merged.push(current);
        }
        
        return merged;
    }

    /**
     * Get current scale
     */
    getScale() {
        return this.scale;
    }

    /**
     * Set scale and re-render
     */
    async setScale(newScale) {
        this.scale = Math.max(0.5, Math.min(3, newScale));
        return this.scale;
    }

    /**
     * Get total redaction count
     */
    getRedactionCount() {
        return this.redactions.length;
    }

    /**
     * Get all pages
     */
    getPages() {
        return this.pages;
    }

    /**
     * Get all redactions
     */
    getRedactions() {
        return this.redactions;
    }

    /**
     * Export as PDF using jsPDF
     */
    async exportAsPdf() {
        if (this.pages.length === 0) return null;
        
        const { jsPDF } = window.jspdf;
        
        // Get dimensions from first page
        const firstPage = this.pages[0];
        const pdfWidth = firstPage.pdfWidth;
        const pdfHeight = firstPage.pdfHeight;
        
        // Create PDF with correct orientation
        const orientation = pdfWidth > pdfHeight ? 'landscape' : 'portrait';
        const pdf = new jsPDF({
            orientation: orientation,
            unit: 'pt',
            format: [pdfWidth, pdfHeight]
        });
        
        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            
            if (i > 0) {
                // Add new page with correct dimensions
                pdf.addPage([page.pdfWidth, page.pdfHeight], 
                    page.pdfWidth > page.pdfHeight ? 'landscape' : 'portrait');
            }
            
            // Create a composite canvas with the whited-out image plus text
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = page.width;
            exportCanvas.height = page.height;
            const ctx = exportCanvas.getContext('2d');
            
            // Draw the fixed canvas (with black boxes whited out)
            ctx.drawImage(page.fixedCanvas, 0, 0);
            
            // Draw the hidden text on top
            if (page.textContent && page.viewport && page.redactions) {
                this.renderTextForExport(ctx, page);
            }
            
            // Convert canvas to image data
            const imgData = exportCanvas.toDataURL('image/jpeg', 0.95);
            
            // Add image to PDF
            pdf.addImage(imgData, 'JPEG', 0, 0, page.pdfWidth, page.pdfHeight);
        }
        
        return pdf;
    }
    
    /**
     * Render text onto canvas for PDF export
     */
    renderTextForExport(ctx, page) {
        const { textContent, viewport, redactions } = page;
        if (!textContent || !textContent.items) return;
        
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'alphabetic';
        
        textContent.items.forEach((item) => {
            if (!item.str || item.str.trim() === '') return;
            
            // Skip "1111" placeholder text used as obstruction
            if (item.str.trim() === '1111') return;
            
            const transform = item.transform;
            const fontSize = Math.abs(transform[0]) || 12;
            
            // Transform PDF coordinates to canvas coordinates
            const pdfX = transform[4];
            const pdfY = transform[5];
            const vt = viewport.transform;
            const canvasX = vt[0] * pdfX + vt[4];
            const canvasY = vt[3] * pdfY + vt[5];
            
            // Check if this text is within any redaction area
            const scaledFontSize = fontSize * this.scale;
            const textTop = canvasY - scaledFontSize;
            const textBottom = canvasY;
            const textLeft = canvasX;
            const textWidth = (item.width || (item.str.length * fontSize * 0.6)) * this.scale;
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
            
            // Draw the text
            ctx.font = `${scaledFontSize}px sans-serif`;
            ctx.fillText(item.str, canvasX, canvasY);
        });
    }

    /**
     * Download the fixed PDF
     */
    async downloadFixedPdf() {
        const pdf = await this.exportAsPdf();
        if (pdf) {
            const fixedName = this.fileName.replace('.pdf', '_unredacted.pdf');
            pdf.save(fixedName);
            return fixedName;
        }
        return null;
    }
}

// Make available globally
window.PDFProcessor = PDFProcessor;
