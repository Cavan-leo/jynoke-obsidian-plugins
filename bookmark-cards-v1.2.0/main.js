const { Plugin, ItemView, setIcon, requestUrl, Notice, PluginSettingTab, Setting, Platform, arrayBufferToBase64 } = require('obsidian');

const VIEW_TYPE_BOOKMARK_CARDS = 'bookmark-cards-view';

// High-quality SVG Default Cover (Dark Theme)
const DEFAULT_COVER_SVG = `data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:%232d333b;stop-opacity:1" /><stop offset="100%" style="stop-color:%231e2329;stop-opacity:1" /></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g)"/><text x="50%" y="45%" font-family="sans-serif" font-weight="bold" font-size="48" fill="%23adbac7" text-anchor="middle">Obsidian</text><text x="50%" y="60%" font-family="sans-serif" font-size="24" fill="%23768390" text-anchor="middle">Bookmark Card</text></svg>`;

const DEFAULT_SETTINGS = {
    metadata: {},
    defaultImage: DEFAULT_COVER_SVG,
    enableList: true,
    enableGrid: true,
    bookmarkFilePath: 'Example/Path/To/Your/Bookmarks.md'
};

class BookmarkCardsView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.data = [];
        this.currentView = 'list';
        this.filterQuery = ''; // [NEW] Search Query State
    }

    getViewType() {
        return VIEW_TYPE_BOOKMARK_CARDS;
    }

    getDisplayText() {
        return '我的收藏';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('clean-cards-view');

        // Ensure valid view based on settings
        if (this.plugin.settings.enableList && !this.plugin.settings.enableGrid) {
            this.currentView = 'list';
        } else if (!this.plugin.settings.enableList && this.plugin.settings.enableGrid) {
            this.currentView = 'grid';
        }

        this.loadAndRender(container);
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (file.path === this.plugin.settings.bookmarkFilePath) {
                this.loadAndRender(container);
            }
        }));
    }

    async loadAndRender(container) {
        container.empty();

        // --- Action Bar ---
        const actions = container.createDiv({ cls: 'clean-cards-actions' });

        // Left: View Switcher
        const viewGroup = actions.createDiv({ cls: 'view-actions-group' });

        if (this.plugin.settings.enableList) {
            const listBtn = viewGroup.createEl('button', { cls: 'action-btn' });
            setIcon(listBtn, 'list');
            listBtn.setAttribute('aria-label', '切换列表视图');
            if (this.currentView === 'list') listBtn.addClass('is-active');
            listBtn.onclick = () => {
                this.currentView = 'list';
                this.loadAndRender(container);
            };
        }

        if (this.plugin.settings.enableGrid) {
            const gridBtn = viewGroup.createEl('button', { cls: 'action-btn' });
            setIcon(gridBtn, 'layout-grid');
            gridBtn.setAttribute('aria-label', '切换卡片视图');
            if (this.currentView === 'grid') gridBtn.addClass('is-active');
            gridBtn.onclick = () => {
                this.currentView = 'grid';
                this.loadAndRender(container);
            };
        }

        const refreshBtn = viewGroup.createEl('button', { cls: 'action-btn' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.setAttribute('aria-label', '刷新数据');
        refreshBtn.onclick = async () => {
            new Notice("🔄 正在刷新元数据...");
            await this.refreshAllMetadata();
            this.loadAndRender(container);
            new Notice("✅ 刷新完成！");
        };

        // Center: Search Bar [NEW]
        const searchContainer = actions.createDiv({ cls: 'search-input-container' });
        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            cls: 'search-input',
            placeholder: 'Search (title, url, #tag)...'
        });
        searchInput.value = this.filterQuery;

        // Debounce Search
        let debounceTimer;
        searchInput.oninput = (e) => {
            clearTimeout(debounceTimer);
            this.filterQuery = e.target.value.toLowerCase();
            debounceTimer = setTimeout(() => {
                this.loadAndRenderFiltered(contentContainer);
            }, 300);
        };

        // Right: Source Button
        const editBtn = actions.createEl('button', { cls: 'action-btn' });
        setIcon(editBtn, 'file-text');
        editBtn.setAttribute('aria-label', '查看数据源');
        editBtn.onclick = async () => {
            const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.bookmarkFilePath);
            if (file) {
                this.app.workspace.getLeaf().openFile(file);
            } else {
                new Notice(`未找到文件: ${this.plugin.settings.bookmarkFilePath}，请检查设置`);
            }
        };

        // --- Content ---
        await this.loadFile();

        const contentContainer = container.createDiv({ cls: 'cards-content-container' });

        // Initial Render using Filtered Logic
        this.loadAndRenderFiltered(contentContainer);
    }

    // [NEW] Separated filtered render function to avoid full rebuild of actions
    loadAndRenderFiltered(container) {
        container.empty();

        // Filter Data
        const filteredData = this.filterQuery
            ? this.filterData(this.data, this.filterQuery)
            : this.data;

        // Fallback logic if current view is disabled
        let viewToRender = this.currentView;
        if (viewToRender === 'list' && !this.plugin.settings.enableList) viewToRender = 'grid';
        if (viewToRender === 'grid' && !this.plugin.settings.enableGrid) viewToRender = 'list';

        if (viewToRender === 'list') {
            this.renderTree(container, filteredData);
        } else if (viewToRender === 'grid') {
            this.renderGrid(container, filteredData);
        } else {
            container.createDiv({ text: "请在设置中至少开启一种视图模式" });
        }
    }

    // [NEW] Recursive Filter Logic
    filterData(items, query) {
        const result = [];
        for (const item of items) {
            if (item.type === 'bookmark') {
                const title = (item.name || '').toLowerCase();
                const url = (item.url || '').toLowerCase();
                const desc = (item.description || '').toLowerCase();
                // Check tags
                const tags = (item.tags || []).map(t => t.toLowerCase());
                const tagMatch = tags.some(t => t.includes(query));

                if (title.includes(query) || url.includes(query) || desc.includes(query) || tagMatch) {
                    result.push(item);
                }
            } else if (item.type === 'folder') {
                const filteredChildren = this.filterData(item.children, query);
                if (filteredChildren.length > 0) {
                    // Clone folder to avoid mutating original data structure
                    const newFolder = Object.assign({}, item);
                    newFolder.children = filteredChildren;
                    result.push(newFolder);
                }
            }
        }
        return result;
    }

    async loadFile() {
        const path = this.plugin.settings.bookmarkFilePath;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) {
            new Notice(`无法加载数据，找不到文件: ${path}`);
            return;
        }
        const content = await this.app.vault.read(file);
        this.data = this.parseContentRecursively(content);
        this.triggerMetadataFetch(this.data);
    }

    async triggerMetadataFetch(items) {
        const processItem = async (item) => {
            if (item.type === 'bookmark' && item.url) {
                const cacheKey = item.url;
                const cached = this.plugin.settings.metadata[cacheKey];
                if (cached) {
                    item.meta = cached;
                } else {
                    this.fetchMetadata(item.url);
                }
            }
            if (item.children) {
                for (const child of item.children) {
                    await processItem(child);
                }
            }
        };
        for (const item of items) {
            await processItem(item);
        }
    }

    async refreshAllMetadata() {
        const processItem = async (item) => {
            if (item.type === 'bookmark' && item.url) {
                await this.fetchMetadata(item.url);
            }
            if (item.children) {
                for (const child of item.children) {
                    await processItem(child);
                }
            }
        }
        for (const item of this.data) {
            await processItem(item);
        }
    }

    parseContentRecursively(content) {
        const lines = content.split('\n');
        const root = [];
        let stack = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed) continue;

            const headerMatch = line.match(/^(#{2,})\s+(.*)/);
            if (headerMatch) {
                const level = headerMatch[1].length;
                const title = headerMatch[2].trim();
                const indentVal = -1 + (level - 2) * 0.1;

                const newFolder = {
                    type: 'folder',
                    name: title,
                    children: [],
                    indent: indentVal,
                    section: 'h' + level
                };

                while (stack.length > 0 && stack[stack.length - 1].indent >= indentVal) {
                    stack.pop();
                }

                if (stack.length === 0) {
                    root.push(newFolder);
                } else {
                    stack[stack.length - 1].children.push(newFolder);
                }

                stack.push(newFolder);
                continue;
            }

            const listMatch = line.match(/^(\s*)[-*] (.*)/);
            if (listMatch) {
                const indentStr = listMatch[1];
                const contentStr = listMatch[2];
                const indentLevel = indentStr.length;

                const markdownLinkMatch = contentStr.match(/^\[(.*)\]\((.*)\)/);
                const rawUrlMatch = contentStr.match(/^(https?:\/\/[^\s]+)/);

                // [NEW] Tag Parsing
                // Matches #tagname anywhere in the string
                const tagMatches = contentStr.match(/#[\w\u4e00-\u9fa5-]+/g);
                const tags = tagMatches ? tagMatches.map(t => t.substring(1)) : []; // Remove #

                let isLink = false;
                let name = contentStr;
                let url = null;

                if (markdownLinkMatch) {
                    isLink = true;
                    name = markdownLinkMatch[1];
                    url = markdownLinkMatch[2];
                } else if (rawUrlMatch) {
                    isLink = true;
                    name = rawUrlMatch[1];
                    url = rawUrlMatch[1];
                }

                // Clean tags from name if desired? For now, we keep them in name for context
                // Or maybe remove them for cleaner look? Let's remove them from Display Name.
                if (tags.length > 0) {
                    // Simple remove of tags from name for display
                    // name = name.replace(/#[\w\u4e00-\u9fa5-]+/g, '').trim(); 
                    // User might want to keep them in text. Let's keep distinct.
                }

                const newItem = {
                    type: isLink ? 'bookmark' : 'folder',
                    name: name,
                    url: url,
                    children: [],
                    description: '',
                    tags: tags, // [NEW]
                    indent: indentLevel
                };

                if (stack.length === 0) continue;

                while (stack.length > 0 && stack[stack.length - 1].indent >= indentLevel) {
                    stack.pop();
                }

                if (stack.length === 0) continue;
                const parent = stack[stack.length - 1];

                if (parent.type === 'bookmark') {
                    parent.description += (parent.description ? '\n' : '') + contentStr;
                } else {
                    parent.children.push(newItem);
                    stack.push(newItem);
                }
            }
            else if (line.match(/^\s+/)) {
                if (stack.length === 0) continue;

                const indentLevel = line.match(/^\s+/)[0].length;
                const textContent = line.trim();

                while (stack.length > 0 && stack[stack.length - 1].indent >= indentLevel) {
                    stack.pop();
                }
                if (stack.length > 0) {
                    const parent = stack[stack.length - 1];
                    if (parent.type === 'bookmark') {
                        parent.description += (parent.description ? '\n' : '') + textContent;
                    }
                }
            }
        }
        return root;
    }

    renderTree(container, items) {
        if (!items || items.length === 0) return;

        items.forEach(item => {
            const itemDiv = container.createDiv({ cls: 'tree-item' });

            const header = itemDiv.createDiv({
                cls: item.type === 'folder' ? 'tree-item-header is-folder' : 'bookmark-link is-link'
            });

            const iconSpan = header.createSpan({ cls: 'tree-icon' });
            if (item.type === 'folder') {
                setIcon(iconSpan, 'folder');
            } else {
                setIcon(iconSpan, 'link');
            }

            const textSpan = header.createSpan({ text: item.name });
            if (item.description) {
                header.title = `${item.name}\n${item.description}\n${item.url || ''}`;
            } else if (item.url) {
                header.title = item.url;
            }

            if (item.type === 'folder') {
                const childrenDiv = itemDiv.createDiv({ cls: 'tree-item-children' });
                this.renderTree(childrenDiv, item.children);

                if (item.indent >= 0 || this.filterQuery) { // [NEW] Expand all if searching
                    if (this.filterQuery) {
                        childrenDiv.style.display = 'flex';
                    } else {
                        childrenDiv.style.display = item.indent >= 0 ? 'none' : 'flex';
                    }
                }

                header.onclick = (e) => {
                    e.stopPropagation();
                    if (childrenDiv.style.display === 'none') {
                        childrenDiv.style.display = 'flex';
                    } else {
                        childrenDiv.style.display = 'none';
                    }
                };
            } else {
                // [NEW] Render Tags in List
                if (item.tags && item.tags.length > 0) {
                    const tagContainer = header.createDiv({ cls: 'bookmark-tags', style: 'margin-top:0; margin-left: 8px;' });
                    item.tags.forEach(tag => {
                        const tagSpan = tagContainer.createSpan({ cls: 'bookmark-tag', text: tag });
                        tagSpan.onclick = (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            this.filterQuery = tag;
                            const searchInput = this.containerEl.querySelector('.search-input');
                            if (searchInput) searchInput.value = tag;
                            const contentContainer = this.containerEl.querySelector('.cards-content-container');
                            if (contentContainer) this.loadAndRenderFiltered(contentContainer);
                        };
                    });
                }
                header.onclick = (e) => {
                    window.open(item.url);
                };
            }
        });
    }

    renderGrid(container, items) {
        items.forEach(item => {
            if (item.type === 'folder') {
                const header = container.createDiv({ cls: 'grid-category-header', text: item.name });
                const gridDiv = container.createDiv({ cls: 'bookmarks-grid' });
                this.renderGridItems(gridDiv, item.children);

            } else if (item.type === 'bookmark') {
                let gridDiv = container.lastElementChild;
                if (!gridDiv || !gridDiv.hasClass('bookmarks-grid')) {
                    gridDiv = container.createDiv({ cls: 'bookmarks-grid' });
                }
                this.createCard(gridDiv, item);
            }
        });
    }

    renderGridItems(container, items) {
        items.forEach(item => {
            if (item.type === 'bookmark') {
                this.createCard(container, item);
            } else if (item.type === 'folder') {
                this.renderGridItems(container, item.children);
            }
        });
    }

    async fetchMetadata(url) {
        if (!url.startsWith('http')) return;
        try {
            // Special Handler: Bilibili API (Bypasses 412 Anti-bot)
            if (url.includes('bilibili.com/video/')) {
                const bvMatch = url.match(/(BV[a-zA-Z0-9]+)/);
                if (bvMatch) {
                    const bvid = bvMatch[1];
                    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
                    const response = await requestUrl({ url: apiUrl });
                    const json = JSON.parse(response.text);

                    if (json.code === 0 && json.data) {
                        const title = json.data.title;
                        const description = json.data.desc;
                        let image = json.data.pic;
                        if (image && image.startsWith('http:')) image = image.replace('http:', 'https:');

                        this.plugin.settings.metadata[url] = { title, description, image };
                        await this.plugin.saveSettings();
                        return; // Success, skip scraping
                    }
                }
            }

            // Special Handler: Xiaohongshu (Bingbot SEO Strategy)
            if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) {
                // Bingbot is often served pre-rendered pages with OG tags
                const response = await requestUrl({
                    url: url.split('?')[0], // Clean URL params
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                    }
                });
                const html = response.text;

                // 1. Try Regex for Initial State Image (Backup)
                let xhsImage = "";

                // Strategy A: Parse window.__INITIAL_STATE__
                const stateMatch = html.match(/window\.__INITIAL_STATE__=(.*?)(;?<\/script>|<)/s);
                if (stateMatch && stateMatch[1]) {
                    try {
                        const stateJson = JSON.parse(stateMatch[1].replace(/undefined/g, 'null'));
                        // Deep traversal to find first valid image in noteData
                        const note = stateJson?.noteData?.data?.noteItem;
                        const firstImage = note?.cover?.urlDefault || note?.imageList?.[0]?.urlDefault;
                        if (firstImage) xhsImage = firstImage;
                    } catch (e) {
                        console.log("XHS JSON Parse Error", e);
                    }
                }

                // Strategy B: Brute Force Regex for specific XHS image domains if JSON failed
                if (!xhsImage) {
                    // Matches sns-webpic or xhscdn URLs in the source code
                    // Use single backslash for regex literals in string match
                    const rawImgMatch = html.match(/"urlDefault":"(https?:\/\/[^"]+(?:xhscdn|sns-webpic)[^"]+)"/);
                    if (rawImgMatch) {
                        xhsImage = rawImgMatch[1].replace(/\\u002F/g, "/");
                    } else {
                        // Fallback to simpler http match if domain specific fails
                        const simpleMatch = html.match(/"urlDefault":"(https?:\/\/[^"]+)"/);
                        if (simpleMatch) xhsImage = simpleMatch[1].replace(/\\u002F/g, "/");
                    }
                }

                // Strategy C: Last Resort - Find ANY high-res XHS image in HTML
                if (!xhsImage) {
                    const anyXhsImg = html.match(/(https?:\/\/[a-zA-Z0-9.-]+(?:xhscdn|sns-webpic)[^" ]+)/);
                    if (anyXhsImg) {
                        // Filter out small icons or tracking pixels if possible, but for now take the first candidate
                        if (!anyXhsImg[1].includes('.ico') && !anyXhsImg[1].includes('.svg')) {
                            xhsImage = anyXhsImg[1].replace(/\\u002F/g, "/");
                        }
                    }
                }

                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");

                const title = doc.querySelector('meta[property="og:title"]')?.content || doc.title || "";
                const description = doc.querySelector('meta[property="og:description"]')?.content || "";

                // 2. Try OG Image (Preferred if available)
                let image = doc.querySelector('meta[property="og:image"]')?.content || xhsImage || "";

                if (image.includes('logo') || image.includes('icon') || !image) {
                    // If OG is just logo or missing, force use regex match
                    if (xhsImage) image = xhsImage;
                }

                if (title || image) {
                    this.plugin.settings.metadata[url] = { title, description, image };
                    await this.plugin.saveSettings();
                    return;
                }
            }

            const response = await requestUrl({
                url: url,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            });
            const html = response.text;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Title Strategy
            const title = doc.querySelector('meta[property="og:title"]')?.content ||
                doc.querySelector('meta[name="twitter:title"]')?.content ||
                doc.title ||
                "";

            // Description Strategy
            const description = doc.querySelector('meta[property="og:description"]')?.content ||
                doc.querySelector('meta[name="twitter:description"]')?.content ||
                doc.querySelector('meta[name="description"]')?.content ||
                "";

            // Image Strategy
            let image = doc.querySelector('meta[property="og:image"]')?.content ||
                doc.querySelector('meta[itemprop="image"]')?.content ||
                doc.querySelector('meta[name="twitter:image"]')?.content ||
                doc.querySelector('link[rel="image_src"]')?.href ||
                "";

            // Handle relative URLs (e.g. keycdn, bilibili sometimes)
            if (image && image.startsWith('//')) {
                image = 'https:' + image;
            } else if (image && image.startsWith('/')) {
                // simple relative path handling
                try {
                    const parsedUrl = new URL(url);
                    image = parsedUrl.origin + image;
                } catch (e) {
                    // best effort
                }
            }

            if (title || image) {
                this.plugin.settings.metadata[url] = { title, description, image };
                await this.plugin.saveSettings();
            }
        } catch (e) {
            console.error(`Failed to fetch metadata for ${url}`, e);
        }
    }

    createCard(container, item) {
        const card = container.createDiv({ cls: 'grid-card' });

        const meta = item.meta || this.plugin.settings.metadata[item.url] || {};
        const title = meta.title || item.name;
        const desc = meta.description || item.description || item.url;
        const image = meta.image;

        const coverDiv = card.createDiv({ cls: 'card-cover' });
        // Correctly use default image setting
        const defaultImg = this.plugin.settings.defaultImage || DEFAULT_COVER_SVG;

        const img = coverDiv.createEl('img');
        img.setAttribute('referrerpolicy', 'no-referrer');

        // Mobile Bilibili Fix: Use Internal Proxy (requestUrl) -> Data URI
        // This bypasses strict WebView Referrer/CORS policies
        if (image && (image.includes('hdslb.com') || image.includes('biliimg.com') || image.includes('bilibili.com'))) {
            // Placeholder while loading
            img.src = defaultImg;

            requestUrl({
                url: image,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            }).then((res) => {
                if (res.status === 200) {
                    const contentType = res.headers['content-type'] || 'image/jpeg';
                    const b64 = arrayBufferToBase64(res.arrayBuffer);
                    img.src = `data:${contentType};base64,${b64}`;
                }
            }).catch((e) => {
                console.error("Bilibili image load failed", e);
            });
        } else {
            // Standard Logic
            let displayImage = image;
            if (displayImage && displayImage.startsWith('http:')) {
                displayImage = displayImage.replace('http:', 'https:');
            }
            img.src = displayImage || defaultImg;

            img.onerror = () => {
                if (img.src !== defaultImg) {
                    img.src = defaultImg;
                } else {
                    img.style.display = 'none';
                    coverDiv.addClass('no-image');
                    setIcon(coverDiv, 'image');
                }
            };
        }

        const infoDiv = card.createDiv({ cls: 'card-info' });
        const titleDiv = infoDiv.createDiv({ cls: 'card-title' });
        titleDiv.createSpan({ text: title });


        const descDiv = infoDiv.createDiv({ cls: 'card-desc' });
        descDiv.textContent = desc;

        // [NEW] Render Tags in Grid
        if (item.tags && item.tags.length > 0) {
            const tagContainer = infoDiv.createDiv({ cls: 'bookmark-tags' });
            item.tags.forEach(tag => {
                const tagSpan = tagContainer.createSpan({ cls: 'bookmark-tag', text: tag });
                tagSpan.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.filterQuery = tag;
                    const searchInput = this.containerEl.querySelector('.search-input');
                    if (searchInput) searchInput.value = tag;
                    const contentContainer = this.containerEl.querySelector('.cards-content-container');
                    if (contentContainer) this.loadAndRenderFiltered(contentContainer);
                };
            });
        }

        card.onclick = () => {
            window.open(item.url);
        };
    }

    async onClose() {
        // cleanup
    }
}

class BookmarkCardsPlugin extends Plugin {
    async onload() {
        console.log('Loading Bookmark Cards Plugin');
        await this.loadSettings();

        // Register Icon First
        this.addRibbonIcon('book', '打开收藏夹', () => {
            this.activateView();
        });

        this.registerView(
            VIEW_TYPE_BOOKMARK_CARDS,
            (leaf) => new BookmarkCardsView(leaf, this)
        );

        this.addSettingTab(new BookmarkCardsSettingTab(this.app, this));
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOKMARK_CARDS);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // Migration: Force update if user is on the old default Unsplash URL
        const OLD_DEFAULT_URL = 'https://images.unsplash.com/photo-1481487484168-9b9322a818c9?w=800&auto=format&fit=crop&q=60';
        if (this.settings.defaultImage === OLD_DEFAULT_URL) {
            this.settings.defaultImage = DEFAULT_COVER_SVG;
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_BOOKMARK_CARDS);

        // Mobile: Open in main area (center)
        // Desktop: Open in right sidebar
        let leaf;
        if (Platform.isMobile) {
            leaf = this.app.workspace.getLeaf(false);
        } else {
            leaf = this.app.workspace.getRightLeaf(false);
        }

        await leaf.setViewState({
            type: VIEW_TYPE_BOOKMARK_CARDS,
            active: true,
        });

        this.app.workspace.revealLeaf(leaf);
    }
}

class BookmarkCardsSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: '插件设置 (Bookmark Cards Settings)' });

        new Setting(containerEl)
            .setName('收藏夹文件路径 (Bookmark File Path)')
            .setDesc('指定要读取的 Markdown 文件路径（包含文件夹，例如：Folder/MyBookmarks.md）')
            .addText(text => text
                .setPlaceholder('Example/Path/To/File.md')
                .setValue(this.plugin.settings.bookmarkFilePath)
                .onChange(async (value) => {
                    this.plugin.settings.bookmarkFilePath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('启用列表模式 (List View)')
            .setDesc('在顶部显示切换到列表视图的按钮')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableList)
                .onChange(async (value) => {
                    this.plugin.settings.enableList = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('启用卡片模式 (Grid View)')
            .setDesc('在顶部显示切换到网格/卡片视图的按钮')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableGrid)
                .onChange(async (value) => {
                    this.plugin.settings.enableGrid = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('默认封面图片 (Default Cover Image)')
            .setDesc('当抓取不到网站图片时，默认显示的图片。已内置精美SVG，也可填入其他URL。')
            .addText(text => text
                .setPlaceholder('https://...')
                .setValue(this.plugin.settings.defaultImage)
                .onChange(async (value) => {
                    this.plugin.settings.defaultImage = value;
                    await this.plugin.saveSettings();
                }));
    }
}

module.exports = BookmarkCardsPlugin;
