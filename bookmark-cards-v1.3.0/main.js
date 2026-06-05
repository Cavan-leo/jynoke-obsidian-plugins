const { Plugin, ItemView, Modal, normalizePath, setIcon, requestUrl, Notice, PluginSettingTab, Setting, Platform, arrayBufferToBase64, FuzzySuggestModal } = require('obsidian');

const VIEW_TYPE_BOOKMARK_CARDS = 'bookmark-cards-view';

// High-quality SVG Default Cover (Dark Theme)
const DEFAULT_COVER_SVG = `data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:%232d333b;stop-opacity:1" /><stop offset="100%" style="stop-color:%231e2329;stop-opacity:1" /></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g)"/><text x="50%" y="45%" font-family="sans-serif" font-weight="bold" font-size="48" fill="%23adbac7" text-anchor="middle">Obsidian</text><text x="50%" y="60%" font-family="sans-serif" font-size="24" fill="%23768390" text-anchor="middle">Bookmark Card</text></svg>`;

const DEFAULT_SETTINGS = {
    metadata: {},
    customImages: {},
    sectionExpandedStates: {},
    coverImageFolder: 'Bookmark Covers',
    defaultImage: DEFAULT_COVER_SVG,
    enableList: true,
    enableGrid: true,
    bookmarkFilePaths: []
};

class CoverImageModal extends Modal {
    constructor(app, plugin, currentImage, onSave) {
        super(app);
        this.plugin = plugin;
        this.currentImage = currentImage || '';
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: '自定义卡片封面' });
        contentEl.createEl('p', {
            cls: 'setting-item-description',
            text: `可以选择仓库内图片，或从本地导入到“${this.plugin.settings.coverImageFolder}”。`
        });

        new Setting(contentEl)
            .setName('选择仓库图片')
            .setDesc('使用已经保存在当前 Obsidian 仓库中的图片。')
            .addButton(button => button
                .setButtonText('选择图片')
                .setCta()
                .onClick(() => {
                    this.close();
                    new ImageFileSuggestModal(this.app, path => this.onSave(path)).open();
                }));

        const fileInput = contentEl.createEl('input', {
            type: 'file',
            attr: { accept: 'image/*' }
        });
        fileInput.style.display = 'none';
        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const path = await this.plugin.importCoverImage(file);
            if (path) {
                await this.onSave(path);
                this.close();
            }
        };

        new Setting(contentEl)
            .setName('从本地导入')
            .setDesc('选择电脑或手机中的图片，并自动复制到 Obsidian 仓库。')
            .addButton(button => button
                .setButtonText('选择本地图片')
                .onClick(() => fileInput.click()));

        new Setting(contentEl)
            .setName('恢复自动封面')
            .setDesc('删除该书签的自定义封面，重新使用抓取图片。')
            .addButton(button => button
                .setButtonText('恢复')
                .setWarning()
                .onClick(async () => {
                    await this.onSave('');
                    this.close();
                }));

        let urlValue = /^https?:\/\//i.test(this.currentImage) ? this.currentImage : '';
        new Setting(contentEl)
            .setName('图片 URL ')
            .setDesc('如果有图片的直接访问 URL，可以在这里输入（支持 http/https/data/app/blob 协议）。')
            .addText(text => text
                .setPlaceholder('https://example.com/image.jpg')
                .setValue(urlValue)
                .onChange(value => {
                    urlValue = value.trim();
                }))
            .addButton(button => button
                .setButtonText('使用 URL')
                .onClick(async () => {
                    if (!urlValue) {
                        new Notice('请输入图片 URL');
                        return;
                    }
                    await this.onSave(urlValue);
                    this.close();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}

class ImageFileSuggestModal extends FuzzySuggestModal {
    constructor(app, onChoose) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder('选择仓库中的图片');
    }

    getItems() {
        const extensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
        return this.app.vault.getFiles().filter(file => extensions.has(file.extension.toLowerCase()));
    }

    getItemText(file) {
        return file.path;
    }

    onChooseItem(file) {
        this.onChoose(file.path);
    }
}

class MarkdownFileSuggestModal extends FuzzySuggestModal {
    constructor(app, onChoose, availablePaths = null) {
        super(app);
        this.onChoose = onChoose;
        this.availablePaths = availablePaths;
        this.setPlaceholder('选择一个 Markdown 文件');
    }

    getItems() {
        const files = this.app.vault.getMarkdownFiles();
        return this.availablePaths
            ? files.filter(file => this.availablePaths.includes(file.path))
            : files;
    }

    getItemText(file) {
        return file.path;
    }

    onChooseItem(file) {
        this.onChoose(file.path);
    }
}

class BookmarkCardsView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.data = [];
        this.currentView = 'list';
        this.currentFilePath = null;
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
            if (file.path === this.currentFilePath) {
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
            if (!this.currentFilePath) {
                new Notice('尚未选择收藏夹文件，请先在插件设置中添加');
                return;
            }
            this.openSourceFile(this.currentFilePath);
        };

        // --- Bookmark File Switcher ---
        const paths = this.plugin.settings.bookmarkFilePaths;
        if (!paths.includes(this.currentFilePath)) {
            this.currentFilePath = paths[0] || null;
        }

        const fileSwitcher = container.createDiv({ cls: 'bookmark-file-switcher' });
        const switchFile = (path) => {
            if (!path || path === this.currentFilePath) return;
            this.currentFilePath = path;
            this.filterQuery = '';
            this.loadAndRender(container);
        };

        if (paths.length === 0) {
            fileSwitcher.createDiv({
                cls: 'bookmark-file-tabs-empty',
                text: '请先在插件设置中添加 Markdown 文件'
            });
        } else {
            const maxDirectTabs = 4;
            const directTabCount = 3;
            let visiblePaths = paths;

            if (paths.length > maxDirectTabs) {
                visiblePaths = paths.slice(0, directTabCount);
                if (!visiblePaths.includes(this.currentFilePath)) {
                    visiblePaths[directTabCount - 1] = this.currentFilePath;
                }
            }

            visiblePaths.forEach(path => {
                const fileName = path.split('/').pop().replace(/\.md$/i, '');
                const tab = fileSwitcher.createEl('button', {
                    cls: `bookmark-file-tab${path === this.currentFilePath ? ' is-active' : ''}`,
                    text: fileName,
                    attr: {
                        type: 'button',
                        title: path,
                        'aria-label': `切换到 ${fileName}`
                    }
                });
                tab.onclick = () => switchFile(path);
            });

            const overflowPaths = paths.filter(path => !visiblePaths.includes(path));
            if (overflowPaths.length > 0) {
                const moreMenu = fileSwitcher.createEl('details', {
                    cls: 'bookmark-file-more'
                });
                const moreButton = moreMenu.createEl('summary', {
                    cls: 'bookmark-file-more-button',
                    attr: {
                        'aria-label': '选择更多收藏夹文件',
                        title: `${overflowPaths.length} 个其他文件`
                    }
                });
                moreButton.createSpan({ text: '更多' });
                moreButton.createSpan({
                    cls: 'bookmark-file-more-count',
                    text: String(overflowPaths.length)
                });

                const menuItems = moreMenu.createDiv({ cls: 'bookmark-file-more-menu' });

                overflowPaths.forEach(path => {
                    const fileName = path.split('/').pop().replace(/\.md$/i, '');
                    const menuItem = menuItems.createEl('button', {
                        cls: 'bookmark-file-more-item',
                        text: fileName,
                        attr: {
                            type: 'button',
                            title: path
                        }
                    });
                    menuItem.onclick = (e) => {
                        e.preventDefault();
                        moreMenu.removeAttribute('open');
                        switchFile(path);
                    };
                });
            }
        }

        const contentContainer = container.createDiv({ cls: 'cards-content-container' });

        // --- Content ---
        await this.loadCurrentFile();

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

    async openSourceFile(path) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file) {
            await this.app.workspace.getLeaf().openFile(file);
        } else {
            new Notice(`未找到文件: ${path}，请检查设置`);
        }
    }

    async loadCurrentFile() {
        this.data = [];
        if (!this.currentFilePath) {
            new Notice('尚未选择收藏夹文件，请在插件设置中添加 Markdown 文件');
            return;
        }

        const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
        if (!file) {
            new Notice(`收藏夹文件不存在：${this.currentFilePath}`);
            return;
        }

        const content = await this.app.vault.read(file);
        this.data = this.parseContentRecursively(content, this.currentFilePath);
        this.triggerMetadataFetch(this.data);
    }

    async revealBookmarkInSource(item) {
        const path = item.sourcePath || this.currentFilePath;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) {
            new Notice(`未找到源文件：${path}`);
            return;
        }

        const leaf = this.app.workspace.getLeavesOfType('markdown')
            .find(candidate => candidate.view?.file?.path === path)
            || this.app.workspace.getLeaf('tab');
        await leaf.openFile(file, { active: true });
        this.app.workspace.revealLeaf(leaf);

        const editor = leaf.view?.editor;
        if (!editor || typeof item.sourceLine !== 'number') {
            new Notice('已打开源文件，但无法定位到具体行');
            return;
        }

        const position = { line: item.sourceLine, ch: 0 };
        editor.setCursor(position);
        editor.scrollIntoView({ from: position, to: position }, true);
        editor.focus();
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

    parseContentRecursively(content, sourcePath = this.currentFilePath) {
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
                    section: 'h' + level,
                    sourcePath: sourcePath,
                    sourceLine: i
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
                    indent: indentLevel,
                    sourcePath: sourcePath,
                    sourceLine: i
                };

                while (stack.length > 0 && stack[stack.length - 1].indent >= indentLevel) {
                    stack.pop();
                }

                if (stack.length === 0) {
                    root.push(newItem);
                    stack.push(newItem);
                } else {
                    const parent = stack[stack.length - 1];

                    if (parent.type === 'bookmark') {
                        parent.description += (parent.description ? '\n' : '') + contentStr;
                    } else {
                        parent.children.push(newItem);
                        stack.push(newItem);
                    }
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

    getSectionKey(item) {
        return `${item.sourcePath || this.currentFilePath || ''}:${item.sourceLine ?? item.name}`;
    }

    isSectionExpanded(item, defaultExpanded = false) {
        const key = this.getSectionKey(item);
        const savedState = this.plugin.settings.sectionExpandedStates[key];
        if (typeof savedState === 'boolean') return savedState;
        return defaultExpanded;
    }

    async saveSectionExpanded(item, expanded) {
        const key = this.getSectionKey(item);
        this.plugin.settings.sectionExpandedStates[key] = expanded;
        await this.plugin.saveSettings();
    }

    renderTree(container, items, depth = 0) {
        if (!items || items.length === 0) return;

        let foundTopLevelFolder = false;
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
                this.renderTree(childrenDiv, item.children, depth + 1);

                const defaultExpanded = depth === 0 && !foundTopLevelFolder;
                if (depth === 0) foundTopLevelFolder = true;
                const expanded = this.filterQuery || this.isSectionExpanded(item, defaultExpanded);
                childrenDiv.style.display = expanded ? 'flex' : 'none';

                header.onclick = async (e) => {
                    e.stopPropagation();
                    const nextExpanded = childrenDiv.style.display === 'none';
                    childrenDiv.style.display = nextExpanded ? 'flex' : 'none';
                    if (!this.filterQuery) await this.saveSectionExpanded(item, nextExpanded);
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
                header.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.revealBookmarkInSource(item);
                };
            }
        });
    }

    countBookmarks(items) {
        return items.reduce((count, item) => {
            if (item.type === 'bookmark') return count + 1;
            return count + this.countBookmarks(item.children || []);
        }, 0);
    }

    renderGrid(container, items) {
        let foundFolder = false;
        items.forEach(item => {
            if (item.type === 'folder') {
                const defaultExpanded = !foundFolder;
                foundFolder = true;
                const isExpanded = this.filterQuery || this.isSectionExpanded(item, defaultExpanded);
                const header = container.createDiv({ cls: 'grid-category-header' });
                const icon = header.createSpan({ cls: 'grid-category-toggle' });
                setIcon(icon, isExpanded ? 'chevron-down' : 'chevron-right');
                header.createSpan({ cls: 'grid-category-title', text: item.name });
                header.createSpan({
                    cls: 'grid-category-count',
                    text: String(this.countBookmarks(item.children || []))
                });

                const gridDiv = container.createDiv({ cls: 'bookmarks-grid' });
                this.renderGridItems(gridDiv, item.children);
                if (!isExpanded) gridDiv.addClass('is-collapsed');

                header.onclick = async () => {
                    const nextExpanded = gridDiv.hasClass('is-collapsed');
                    await this.saveSectionExpanded(item, nextExpanded);
                    this.loadAndRenderFiltered(container);
                };

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

    normalizeRemoteUrl(value, pageUrl) {
        if (!value || typeof value !== 'string') return '';
        const cleaned = value.trim().replace(/&amp;/g, '&');
        if (!cleaned || /^(data:|blob:|javascript:)/i.test(cleaned)) return '';

        try {
            return new URL(cleaned, pageUrl).href;
        } catch (e) {
            return '';
        }
    }

    normalizePageUrl(value) {
        if (!value || typeof value !== 'string') return '';
        const cleaned = value.trim();
        const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)
            ? cleaned
            : `https://${cleaned}`;
        return this.normalizeRemoteUrl(absolute, absolute);
    }

    getSiteIconUrl(pageUrl) {
        try {
            return new URL('/favicon.ico', this.normalizePageUrl(pageUrl)).href;
        } catch (e) {
            return '';
        }
    }

    resolveCustomImage(value) {
        if (!value) return '';
        if (/^(https?:|data:|app:|blob:)/i.test(value)) return value;
        const file = this.app.vault.getAbstractFileByPath(value);
        return file ? this.app.vault.getResourcePath(file) : '';
    }

    extractJsonLdImage(doc, pageUrl) {
        const findImage = (value) => {
            if (!value) return '';
            if (typeof value === 'string') return this.normalizeRemoteUrl(value, pageUrl);
            if (Array.isArray(value)) {
                for (const entry of value) {
                    const found = findImage(entry);
                    if (found) return found;
                }
                return '';
            }
            if (typeof value === 'object') {
                return findImage(value.url || value.contentUrl || value.thumbnailUrl || value.image);
            }
            return '';
        };

        for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const data = JSON.parse(script.textContent);
                const entries = Array.isArray(data) ? data : [data];
                for (const entry of entries) {
                    const image = findImage(entry?.image || entry?.thumbnailUrl);
                    if (image) return image;
                }
            } catch (e) {
                // Ignore malformed structured data.
            }
        }
        return '';
    }

    extractPageImage(doc, pageUrl) {
        const metaSelectors = [
            'meta[property="og:image:secure_url"]',
            'meta[property="og:image"]',
            'meta[name="twitter:image"]',
            'meta[name="twitter:image:src"]',
            'meta[itemprop="image"]',
            'link[rel="image_src"]'
        ];

        for (const selector of metaSelectors) {
            const element = doc.querySelector(selector);
            const image = this.normalizeRemoteUrl(
                element?.content || element?.href || element?.getAttribute('content') || element?.getAttribute('href'),
                pageUrl
            );
            if (image) return image;
        }

        const jsonLdImage = this.extractJsonLdImage(doc, pageUrl);
        if (jsonLdImage) return jsonLdImage;

        const imageSelectors = [
            'article img',
            'main img',
            '.post img',
            '.article img',
            'img'
        ];
        for (const selector of imageSelectors) {
            for (const element of doc.querySelectorAll(selector)) {
                const srcset = element.getAttribute('srcset');
                const srcsetCandidate = srcset
                    ? srcset.split(',').pop().trim().split(/\s+/)[0]
                    : '';
                const candidate = element.getAttribute('data-src')
                    || element.getAttribute('data-original')
                    || element.getAttribute('data-lazy-src')
                    || srcsetCandidate
                    || element.getAttribute('src');
                const image = this.normalizeRemoteUrl(candidate, pageUrl);
                if (image && !/\.(svg|ico)(?:$|\?)/i.test(image)) return image;
            }
        }

        const iconSelectors = [
            'link[rel="apple-touch-icon"]',
            'link[rel="icon"]',
            'link[rel="shortcut icon"]'
        ];
        for (const selector of iconSelectors) {
            const element = doc.querySelector(selector);
            const icon = this.normalizeRemoteUrl(element?.getAttribute('href'), pageUrl);
            if (icon) return icon;
        }

        try {
            return new URL('/favicon.ico', pageUrl).href;
        } catch (e) {
            return '';
        }
    }

    async fetchMetadata(url) {
        const requestPageUrl = this.normalizePageUrl(url);
        if (!requestPageUrl) return;
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
                url: requestPageUrl,
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

            const image = this.extractPageImage(doc, requestPageUrl);

            if (title || image) {
                this.plugin.settings.metadata[url] = { title, description, image };
                await this.plugin.saveSettings();
            }
        } catch (e) {
            console.error(`Failed to fetch metadata for ${url}`, e);
        }
    }

    async loadImageThroughProxy(img, imageUrl, pageUrl) {
        if (!imageUrl) return false;
        try {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };
            try {
                headers.Referer = new URL(pageUrl).origin + '/';
            } catch (e) {
                // Referer is optional.
            }

            const res = await requestUrl({ url: imageUrl, headers });
            const contentType = res.headers['content-type'] || '';
            if (res.status !== 200 || !contentType.startsWith('image/')) return false;

            img.src = `data:${contentType};base64,${arrayBufferToBase64(res.arrayBuffer)}`;
            return true;
        } catch (e) {
            return false;
        }
    }

    createCard(container, item) {
        const card = container.createDiv({ cls: 'grid-card' });

        const meta = item.meta || this.plugin.settings.metadata[item.url] || {};
        const title = meta.title || item.name;
        const desc = meta.description || item.description || item.url;
        const customImage = this.plugin.settings.customImages[item.url] || '';
        const image = this.resolveCustomImage(customImage) || meta.image || this.getSiteIconUrl(item.url);

        const coverDiv = card.createDiv({ cls: 'card-cover' });
        const editCoverButton = coverDiv.createEl('button', {
            cls: 'card-cover-edit',
            attr: { 'aria-label': '自定义封面' }
        });
        setIcon(editCoverButton, 'image-plus');
        editCoverButton.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            new CoverImageModal(this.app, this.plugin, customImage, async (value) => {
                if (value) {
                    this.plugin.settings.customImages[item.url] = value;
                } else {
                    delete this.plugin.settings.customImages[item.url];
                }
                await this.plugin.saveSettings();
                const contentContainer = this.containerEl.querySelector('.cards-content-container');
                if (contentContainer) this.loadAndRenderFiltered(contentContainer);
            }).open();
        };
        editCoverButton.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

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

            img.onerror = async () => {
                img.onerror = null;
                const proxied = await this.loadImageThroughProxy(img, displayImage, item.url);
                if (!proxied) {
                    img.src = defaultImg;
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
        card.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.revealBookmarkInSource(item);
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
        const savedSettings = await this.loadData() || {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
        if (!this.settings.customImages || typeof this.settings.customImages !== 'object') {
            this.settings.customImages = {};
        }
        if (!this.settings.sectionExpandedStates || typeof this.settings.sectionExpandedStates !== 'object') {
            this.settings.sectionExpandedStates = {};
        }
        if (!this.settings.coverImageFolder || typeof this.settings.coverImageFolder !== 'string') {
            this.settings.coverImageFolder = 'Bookmark Covers';
        }

        // Migrate the previous single-file setting without losing the user's path.
        if (!Array.isArray(savedSettings.bookmarkFilePaths)) {
            this.settings.bookmarkFilePaths = savedSettings.bookmarkFilePath
                ? [savedSettings.bookmarkFilePath]
                : [];
            delete this.settings.bookmarkFilePath;
            await this.saveSettings();
        }

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

    async ensureFolder(path) {
        const normalized = normalizePath(path);
        if (!normalized) return;

        let current = '';
        for (const segment of normalized.split('/')) {
            current = current ? `${current}/${segment}` : segment;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current);
            }
        }
    }

    getAvailableCoverPath(fileName) {
        const folder = normalizePath(this.settings.coverImageFolder || 'Bookmark Covers');
        const safeName = fileName.replace(/[\\/:*?"<>|]/g, '-');
        const dotIndex = safeName.lastIndexOf('.');
        const baseName = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
        const extension = dotIndex > 0 ? safeName.slice(dotIndex) : '';
        let path = normalizePath(`${folder}/${safeName}`);
        let suffix = 1;

        while (this.app.vault.getAbstractFileByPath(path)) {
            path = normalizePath(`${folder}/${baseName}-${suffix}${extension}`);
            suffix += 1;
        }
        return path;
    }

    async importCoverImage(file) {
        try {
            const folder = normalizePath(this.settings.coverImageFolder || 'Bookmark Covers');
            await this.ensureFolder(folder);
            const path = this.getAvailableCoverPath(file.name || `cover-${Date.now()}.png`);
            await this.app.vault.createBinary(path, await file.arrayBuffer());
            new Notice(`封面已保存到：${path}`);
            return path;
        } catch (e) {
            console.error('Failed to import cover image', e);
            new Notice('导入封面图片失败');
            return '';
        }
    }

    refreshViews() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE_BOOKMARK_CARDS).forEach(leaf => {
            const view = leaf.view;
            const container = view.containerEl?.children[1];
            if (container && typeof view.loadAndRender === 'function') {
                view.loadAndRender(container);
            }
        });
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
        this.filesExpanded = false;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: '插件设置 (Bookmark Cards Settings)' });

        const fileSection = containerEl.createDiv({ cls: 'bookmark-cards-file-section' });

        new Setting(fileSection)
            .setName('收藏夹文件 (Bookmark Files)')
            .setDesc(`已配置 ${this.plugin.settings.bookmarkFilePaths.length} 个 Markdown 文件。`)
            .addButton(button => button
                .setButtonText(this.filesExpanded ? '收起' : '展开')
                .onClick(() => {
                    this.filesExpanded = !this.filesExpanded;
                    this.display();
                }));

        const fileList = fileSection.createDiv({ cls: 'bookmark-cards-file-list' });
        fileList.toggleClass('is-collapsed', !this.filesExpanded);
        new Setting(fileList)
            .setName('管理文件')
            .setDesc('可以选择多个 Markdown 文件，并在收藏夹顶部切换查看。')
            .addButton(button => button
                .setButtonText('添加文件')
                .setCta()
                .onClick(() => this.openFilePicker()));

        if (this.plugin.settings.bookmarkFilePaths.length === 0) {
            fileList.createDiv({
                cls: 'bookmark-cards-file-empty',
                text: '尚未选择任何 Markdown 文件'
            });
        }

        this.plugin.settings.bookmarkFilePaths.forEach((path, index) => {
            new Setting(fileList)
                .setName(path)
                .setDesc(this.app.vault.getAbstractFileByPath(path) ? '已选择' : '文件不存在')
                .addButton(button => button
                    .setIcon('folder-search')
                    .setTooltip('更换文件')
                    .onClick(() => this.openFilePicker(index)))
                .addExtraButton(button => button
                    .setIcon('trash-2')
                    .setTooltip('移除文件')
                    .onClick(async () => {
                        this.plugin.settings.bookmarkFilePaths.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.plugin.refreshViews();
                        this.display();
                    }));
        });

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
            .setName('封面图片保存目录')
            .setDesc('从电脑或手机导入的封面会保存到这个 Obsidian 仓库目录。')
            .addText(text => text
                .setPlaceholder('Bookmark Covers')
                .setValue(this.plugin.settings.coverImageFolder)
                .onChange(async (value) => {
                    this.plugin.settings.coverImageFolder = normalizePath(value.trim() || 'Bookmark Covers');
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

    hide() {
        this.filesExpanded = false;
        super.hide();
    }

    openFilePicker(replaceIndex = null) {
        new MarkdownFileSuggestModal(this.app, async (path) => {
            const paths = this.plugin.settings.bookmarkFilePaths;
            const existingIndex = paths.indexOf(path);

            if (existingIndex !== -1 && existingIndex !== replaceIndex) {
                new Notice('该文件已经添加');
                return;
            }

            if (replaceIndex === null) {
                paths.push(path);
            } else {
                paths[replaceIndex] = path;
            }

            await this.plugin.saveSettings();
            this.plugin.refreshViews();
            this.display();
        }).open();
    }
}

module.exports = BookmarkCardsPlugin;
