# Bookmark Cards - Obsidian 收藏夹可视化插件

> 把便利贴搬进 Obsidian 太治愈了！📚✨

---

## ✨ 特性介绍

Bookmark Cards 是一个功能强大的 Obsidian 插件，让你的收藏夹以**可视化的方式**呈现，完美替代传统的书签管理工具。

### 🎨 核心功能

#### 1. **双视图模式**
- **列表视图** - 清晰的树状结构，支持折叠/展开
- **卡片视图** - 美观的网格布局，自动抓取网站封面

#### 2. **智能元数据抓取** 🕸️
- 自动获取网站标题
- 抓取网站描述
- 显示网站封面图片
- 元数据缓存机制，避免重复请求

#### 3. **Markdown 原生支持** 📝
- 支持 Markdown 标题层级（`##`, `###`, ...）
- 支持列表项（`-`）
- 支持 Wiki-links (`[[link]]`)
- 支持直接 URL
- 自动递归解析嵌套结构

#### 4. **优雅的交互体验** 🎯
- 一键切换视图模式
- 实时刷新元数据
- 点击打开原始文件
- 平滑的悬停动画
- 支持移动端和桌面端

#### 5. **丰富的自定义选项** ⚙️
- 指定收藏夹文件路径
- 启用/禁用列表视图
- 启用/禁用卡片视图
- 自定义默认封面图片
- 内置精美 SVG 默认封面

---

## 🚀 快速开始

### 安装

1. **下载插件**
   ```bash
   # 或者从 GitHub Releases 下载
   bookmark-cards.zip
   ```

2. **解压到 Obsidian 插件目录**
   ```
   你的仓库/.obsidian/plugins/bookmark-cards/
   ```

3. **启用插件**
   - 打开 Obsidian 设置
   - 社区插件
   - 启用 "Bookmark Cards"

### 配置

创建一个收藏夹 Markdown 文件，例如 `Bookmarks.md`：

```markdown
# 我的技术博客

## 前端
- [Vue.js 官方文档](https://vuejs.org/)
- [React 官方文档](https://react.dev/)

## 后端
- [Node.js](https://nodejs.org/)
- [Python 官网](https://www.python.org/)

## 工具
- [Obsidian 插件市场](https://obsidian.md/plugins)
```

然后在插件设置中：
1. 设置"收藏夹文件路径"为你的文件路径
2. 启用视图模式（列表/卡片）
3. 点击左侧边栏的书本图标打开收藏夹

---

## 📖 使用方法

### 格式说明

#### 支持的格式

**1. 标题分组**
```markdown
## 前端技术
### Vue.js
### React
```

**2. 书签列表**
```markdown
- [网站名称](URL)
```

**3. 原始 URL**
```markdown
- https://example.com
```

**4. 嵌套结构**
```markdown
## 分类
### 子分类
- [书签](https://example.com)
```

**5. 添加描述**
```markdown
- [Vue.js](https://vuejs.org/)
  渐进式 JavaScript 框架
```

### 列表视图

```
┌─ 📁 前端技术
│  ├─ 📁 Vue.js
│  │  └─ 🔗 Vue.js 官方文档
│  └─ 📁 React
│     └─ 🔗 React 官方文档
│
└─ 📁 后端技术
   └─ 🔗 Node.js 官网
```

**操作**：
- 点击文件夹：折叠/展开
- 点击书签：在新标签页打开

### 卡片视图

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  [封面图]  │  │  [封面图]  │  │  [封面图]  │
│             │  │             │  │             │
│  Vue.js     │  │  React      │  │  Node.js    │
│  官方文档  │  │  官方文档  │  │  官网      │
└─────────────┘  └─────────────┘  └─────────────┘
```

**操作**：
- 点击卡片：在新标签页打开
- 悬停：卡片上浮效果

---

## ⚙️ 设置说明

### 收藏夹文件路径
指定要读取的 Markdown 文件路径。

**示例**：
```
Bookmarks/MyBookmarks.md
10_Cards/收藏夹.md
```

**建议**：
- 使用相对路径
- 文件放在仓库根目录
- 便于同步和备份

### 启用列表模式
在顶部显示切换到列表视图的按钮。

**适用场景**：
- 需要清晰的层级结构
- 收藏数量较多
- 需要快速浏览分类

### 启用卡片模式
在顶部显示切换到网格/卡片视图的按钮。

**适用场景**：
- 需要可视化预览
- 收藏图片内容
- 需要美观的展示

### 默认封面图片
当抓取不到网站图片时，默认显示的图片。

**内置**：
- 精美的 SVG 默认封面
- 深色主题优化

**自定义**：
- 填入其他图片 URL
- 支持本地图片
- 支持在线图片

---

## 🎨 主题适配

插件完全适配 Obsidian 的主题系统：

- **浅色主题** - 自动适配
- **深色主题** - 自动适配
- **自定义主题** - 完全支持

卡片悬停效果根据主题自动调整：
- 浅色主题：蓝色强调
- 深色主题：背景色强调

---

## 🔧 高级技巧

### 1. 创建分类结构

```markdown
# 我的收藏夹

## 技术博客
### 前端
### 后端
### 全栈

## 学习资源
### 视频教程
### 文档网站

## 工具
### 开发工具
### 设计工具
### 效率工具
```

### 2. 添加笔记和描述

```markdown
## 前端框架

- [Vue.js](https://vuejs.org/)
  渐进式 JavaScript 框架，易学易用

  使用场景：
  - 单页应用
  - 组件化开发
  - 响应式设计
```

### 3. 使用 Wiki-Links

```markdown
## 我的项目

- [[个人博客]]
- [[Jynoke]]
- [[学习笔记]]
```

### 4. 定期刷新元数据

如果发现书签没有封面或标题，点击顶部的"刷新"按钮：
- 重新抓取所有元数据
- 自动缓存结果
- 避免重复请求

---

## 📊 技术细节

### 依赖
- Obsidian API
- 无外部依赖

### 元数据抓取
- 使用 Open Graph 标签
- `og:title` - 网站标题
- `og:description` - 网站描述
- `og:image` - 网站封面

### 性能优化
- 元数据缓存机制
- 智能批量抓取
- 避免重复请求
- 懒加载图片

### 兼容性
- Obsidian Desktop: ✅
- Obsidian Mobile: ✅
- 最低版本: 0.15.0

---

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

### GitHub 仓库
```
https://github.com/Cavan-leo/jynoke-obsidian-plugins
```

### 开发环境
```bash
# 克隆仓库
git clone https://github.com/Cavan-leo/jynoke-obsidian-plugins.git

# 开发
cd jynoke-obsidian-plugins/bookmark-cards

# 调试
# 在 Obsidian 中使用 Obsidian Developer Tools 插件
```

---

## 📄 许可证

MIT License

---

## 🙏 致谢

感谢 Obsidian 社区和所有使用本插件的用户！

---

## 📞 反馈与支持

- **GitHub Issues**: 报告 Bug 和功能请求
- **GitHub Discussions**: 使用问题和技术讨论
- **小红书**: 查看使用技巧和教程

---

## 🔗 相关资源

- [Obsidian 官网](https://obsidian.md)
- [Obsidian 插件市场](https://obsidian.md/plugins)
- [Obsidian 中文社区](https://forum-zh.obsidian.md/)

---

立即下载体验，让你的书签管理更加优雅！
