/*
 * Fluid Image 🌊 V1.6 (Ghost UX)
 * Fixes: Trigger Icon, Toolbar Position.
 */

const { Plugin, MarkdownView, debounce } = require('obsidian');
const fs = require('fs');
const path = require('path');

module.exports = class FluidImagePlugin extends Plugin {
    async onload() {
        console.log('LOADING Fluid Image 🌊 V1.6');

        this.registerDomEvent(window, 'mouseover', this.handleMouseOver, true);
        this.registerDomEvent(window, 'wheel', this.handleWheel, { passive: false });
        this.registerDomEvent(window, 'keydown', (e) => {
            if (e.key === 'Escape') this.forceReset();
        });

        this.isInteracting = false;
    }

    onunload() {
        this.forceReset();
        document.querySelectorAll('.jyn-resizer-handle').forEach(el => el.remove());
        document.querySelectorAll('.jyn-crop-trigger').forEach(el => el.remove());
    }

    forceReset() {
        this.isInteracting = false;
        document.querySelectorAll('.jyn-crop-container').forEach(el => el.remove());
        document.querySelectorAll('.jyn-image-hud').forEach(el => el.remove());
        document.body.style.cursor = '';
    }

    // --- FEATURE 1: ALT + SCROLL ---
    handleWheel = (e) => {
        if (!e.altKey || this.isInteracting) return;
        const target = e.target;
        if (target.tagName === 'IMG' && target.closest('.markdown-source-view')) {
            e.preventDefault();
            const img = target;
            const delta = e.deltaY > 0 ? -20 : 20;
            const newWidth = Math.max(50, img.clientWidth + delta);

            this.applyWidth(img, newWidth);
            this.showHUD(img, `${newWidth} px`);
            this.debouncedSave(img, newWidth);
        }
    }

    debouncedSave = debounce(async (img, width) => await this.updateMarkdown(img, width), 400, true);

    // --- FEATURE 2: HOVER UI ---
    handleMouseOver = (e) => {
        if (this.isInteracting) return;
        const target = e.target;
        if (target.tagName === 'IMG' && target.closest('.markdown-source-view')) {
            const img = target;
            const container = img.parentElement;
            if (container.querySelector('.jyn-resizer-handle')) return;

            if (img.style.width) container.style.width = img.style.width;
            else if (img.getAttribute('width')) container.style.width = img.getAttribute('width') + 'px';
            else container.style.width = img.clientWidth + 'px';

            const style = window.getComputedStyle(container);
            if (style.position === 'static') container.style.position = 'relative';
            if (style.display === 'inline') container.style.display = 'inline-block';

            this.injectControls(container, img);
        }
    }

    injectControls(container, img) {
        // Handle
        const handle = document.createElement('div');
        handle.className = 'jyn-resizer-handle';
        // handle.title removed as per user request
        handle.addEventListener('mousedown', (e) => this.handleDragStart(e, container, img));
        handle.addEventListener('dblclick', (e) => { e.stopPropagation(); this.resetImage(img); });
        container.appendChild(handle);

        // Trigger with SVG
        const cropBtn = document.createElement('div');
        cropBtn.className = 'jyn-crop-trigger';
        // SVG Crop Icon
        cropBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg>`;
        cropBtn.title = '裁剪图片';
        cropBtn.addEventListener('click', (e) => {
            e.stopPropagation(); e.preventDefault();
            this.startCropMode(container, img);
        });
        container.appendChild(cropBtn);

        container.addEventListener('mouseleave', () => {
            if (!this.isInteracting) {
                handle.remove();
                cropBtn.remove();
            }
        });
    }

    // --- FEATURE 3: DRAG RESIZE ---
    handleDragStart(e, container, img) {
        e.preventDefault(); e.stopPropagation();
        this.isInteracting = true;
        this.activeImg = img;
        this.activeContainer = container;
        this.startX = e.clientX;
        this.startWidth = img.clientWidth;

        container.classList.add('jyn-resizer-active');
        document.body.style.cursor = 'col-resize';

        this._dragMove = (ev) => this.handleDragMove(ev);
        this._dragEnd = (ev) => this.handleDragEnd(ev);

        document.addEventListener('mousemove', this._dragMove);
        document.addEventListener('mouseup', this._dragEnd);
    }

    handleDragMove(e) {
        const delta = e.clientX - this.startX;
        const newWidth = Math.max(50, this.startWidth + delta);
        this.applyWidth(this.activeImg, newWidth);
        this.showHUD(this.activeImg, `${newWidth} px`);
    }

    async handleDragEnd(e) {
        document.removeEventListener('mousemove', this._dragMove);
        document.removeEventListener('mouseup', this._dragEnd);
        document.body.style.cursor = '';
        this.activeContainer.classList.remove('jyn-resizer-active');
        await this.updateMarkdown(this.activeImg, parseInt(this.activeImg.style.width));
        this.isInteracting = false;
        this.activeImg = null;
    }

    // --- FEATURE 4: CROPPER ---
    startCropMode(container, img) {
        this.isInteracting = true;

        const cropContainer = document.createElement('div');
        cropContainer.className = 'jyn-crop-container';
        container.appendChild(cropContainer);

        const cropBox = document.createElement('div');
        cropBox.className = 'jyn-crop-box';
        cropContainer.appendChild(cropBox);

        let startX, startY;
        let isSelecting = false;

        const handleEnterKey = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (cropBox.offsetWidth > 10 && cropBox.offsetHeight > 10) confirmCrop();
                else this.showHUD(img, "Select Area First");
            }
        };
        document.addEventListener('keydown', handleEnterKey, true);

        const updateBox = (currX, currY) => {
            const rect = container.getBoundingClientRect();
            const relativeX = currX - rect.left;
            const relativeY = currY - rect.top;
            const relativeStartX = startX - rect.left;
            const relativeStartY = startY - rect.top;

            const clampedX = Math.max(0, Math.min(relativeX, rect.width));
            const clampedY = Math.max(0, Math.min(relativeY, rect.height));

            const left = Math.min(relativeStartX, clampedX);
            const top = Math.min(relativeStartY, clampedY);
            const w = Math.abs(clampedX - relativeStartX);
            const h = Math.abs(clampedY - relativeStartY);

            cropBox.style.left = `${left}px`;
            cropBox.style.top = `${top}px`;
            cropBox.style.width = `${w}px`;
            cropBox.style.height = `${h}px`;
            cropBox.style.display = 'block';
        };

        cropContainer.addEventListener('mousedown', (e) => {
            if (e.target.closest('.jyn-crop-toolbar')) return;
            isSelecting = true;
            startX = e.clientX;
            startY = e.clientY;
            cropBox.style.display = 'none';
        });

        cropContainer.addEventListener('mousemove', (e) => {
            if (!isSelecting) return;
            updateBox(e.clientX, e.clientY);
        });

        cropContainer.addEventListener('mouseup', (e) => {
            isSelecting = false;
            // Always show toolbar if size is decent
            if (cropBox.offsetWidth > 10 && cropBox.offsetHeight > 10) showToolbar();
        });

        let toolbar;
        const showToolbar = () => {
            if (toolbar) return;
            toolbar = document.createElement('div');
            toolbar.className = 'jyn-crop-toolbar';
            toolbar.innerHTML = `<button class="jyn-crop-btn jyn-btn-confirm">确认裁剪 (Enter)</button><button class="jyn-crop-btn jyn-btn-cancel">取消 (Esc)</button>`;
            cropContainer.appendChild(toolbar);

            toolbar.querySelector('.jyn-btn-cancel').addEventListener('click', (e) => { e.stopPropagation(); closeCrop(); });
            toolbar.querySelector('.jyn-btn-confirm').addEventListener('click', (e) => { e.stopPropagation(); confirmCrop(); });
        };

        const confirmCrop = async () => {
            const dispW = img.clientWidth;
            const dispH = img.clientHeight;
            const natW = img.naturalWidth;
            const natH = img.naturalHeight;
            if (!natW || !natH) {
                this.showHUD(img, "Image Error");
                closeCrop();
                return;
            }
            const scaleX = natW / dispW;
            const scaleY = natH / dispH;
            const cropRect = {
                left: parseFloat(cropBox.style.left) * scaleX,
                top: parseFloat(cropBox.style.top) * scaleY,
                width: parseFloat(cropBox.style.width) * scaleX,
                height: parseFloat(cropBox.style.height) * scaleY
            };
            try {
                this.showHUD(img, "Processing...");
                await this.performCrop(img, cropRect);
            } catch (err) {
                console.error(err);
                this.showHUD(img, "Error: " + err.message);
            } finally {
                closeCrop();
            }
        };

        const closeCrop = () => {
            document.removeEventListener('keydown', handleEnterKey, true);
            this.forceReset();
        };
    }

    // --- SAFE CROP LOGIC ---
    async performCrop(img, rect) {
        if (rect.width <= 0 || rect.height <= 0) throw new Error("Invalid Selection");
        const src = img.getAttribute('src');
        let filePath = '';
        if (src.startsWith('app://')) {
            try {
                const url = new URL(src);
                filePath = decodeURIComponent(url.pathname);
                if (navigator.platform.indexOf('Win') > -1 && filePath.startsWith('/') && filePath.includes(':')) {
                    filePath = filePath.substring(1);
                }
            } catch (e) { }
        }
        if (!fs.existsSync(filePath)) {
            this.showHUD(img, "Path Not Found");
            throw new Error("Cannot resolve file path");
        }

        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        let mime = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.webp') mime = 'image/webp';

        const dataUrl = `data:${mime};base64,${fileBuffer.toString('base64')}`;
        const sourceImg = new Image();
        sourceImg.src = dataUrl;
        await new Promise((resolve, reject) => {
            sourceImg.onload = resolve;
            sourceImg.onerror = () => reject(new Error("Image Load Failed"));
        });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = rect.width;
        canvas.height = rect.height;
        ctx.drawImage(sourceImg,
            rect.left, rect.top, rect.width, rect.height,
            0, 0, rect.width, rect.height
        );

        const outBuffer = await new Promise(resolve => {
            canvas.toBlob(blob => {
                if (!blob) resolve(null);
                else blob.arrayBuffer().then(b => resolve(Buffer.from(b)));
            }, mime, 0.95);
        });
        if (!outBuffer || outBuffer.length < 100) throw new Error("Generated image too small");

        fs.writeFileSync(filePath, outBuffer);
        const newSrc = src.split('?')[0] + '?t=' + Date.now();
        img.src = newSrc;

        this.showHUD(img, "Cropped! ✂️");
    }

    // --- UTILS ---
    async resetImage(img) {
        this.applyWidth(img, '');
        this.showHUD(img, "Original");
        await this.updateMarkdown(img, null);
    }

    applyWidth(img, width) {
        const val = width ? `${width}px` : '';
        img.style.width = val;
        if (img.parentElement) img.parentElement.style.width = val;
    }

    showHUD(target, text) {
        let hud = target.parentElement.querySelector('.jyn-image-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.className = 'jyn-image-hud';
            target.parentElement.appendChild(hud);
        }
        hud.textContent = text;
        hud.style.opacity = '1';
        clearTimeout(target._hudTimeout);
        target._hudTimeout = setTimeout(() => hud.style.opacity = '0', 2000);
    }

    async updateMarkdown(imgDom, newWidth) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        let pos = null;
        if (view.editor.cm) try { pos = view.editor.cm.posAtDOM(imgDom); } catch (e) { }
        if (pos === null) return;

        const lineInfo = view.editor.offsetToPos(pos);
        const lineText = view.editor.getLine(lineInfo.line);

        const wikiRegex = /!\[\[(.*?)(?:\|(\d+))?\]\]/;
        const stdRegex = /!\[(.*?)\]\((.*?)\)/;

        let newText = lineText;
        if (wikiRegex.test(lineText)) {
            newText = lineText.replace(wikiRegex, (full, name, old) => newWidth ? `![[${name}|${newWidth}]]` : `![[${name}]]`);
        } else if (stdRegex.test(lineText)) {
            newText = lineText.replace(stdRegex, (full, alt, url) => {
                let newAlt = alt;
                if (newWidth) {
                    if (/^\d+$/.test(alt)) newAlt = `${newWidth}`;
                    else if (alt.includes('|')) newAlt = alt.split('|')[0] + `|${newWidth}`;
                    else newAlt = alt ? `${alt}|${newWidth}` : `${newWidth}`;
                } else {
                    if (/^\d+$/.test(alt)) newAlt = '';
                    else if (alt.includes('|')) newAlt = alt.split('|')[0];
                }
                return `![${newAlt}](${url})`;
            });
        }
        if (newText !== lineText) view.editor.setLine(lineInfo.line, newText);
    }
}
