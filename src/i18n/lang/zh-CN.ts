import type { UIStrings } from "../types";

export default {
  nav: {
    home: "首页",
    posts: "文章",
    series: "专栏",
    tags: "标签",
    about: "关于",
    archives: "归档",
    search: "搜索",
  },
  post: {
    publishedAt: "发布于",
    updatedAt: "更新于",
    sharePostIntro: "分享文章：",
    sharePostOn: "分享到 {{platform}}",
    sharePostViaEmail: "通过邮件分享",
    tagLabel: "标签",
    backToTop: "返回顶部",
    goBack: "返回",
    editPage: "编辑文章",
    previousPost: "上一篇",
    nextPost: "下一篇",
    tableOfContents: "目录",
  },
  pagination: {
    prev: "上一页",
    next: "下一页",
    page: "第 {{page}} 页",
  },
  home: {
    socialLinks: "社交链接",
    featured: "精选文章",
    recentPosts: "最近文章",
    allPosts: "全部文章",
  },
  series: {
    post: "篇",
    posts: "篇",
  },
  footer: {
    copyright: "版权所有",
    allRightsReserved: "保留所有权利。",
  },
  pages: {
    tagTitle: "标签",
    tagDesc: "包含该标签的全部文章",

    tagsTitle: "标签",
    tagsDesc: "浏览文章使用的全部标签。",

    postsTitle: "文章",
    postsDesc: "浏览已发布的全部文章。",

    seriesTitle: "专栏",
    seriesDesc: "按长期主题浏览文章。",
    seriesDetailDesc: "收录于专栏：",

    archivesTitle: "归档",
    archivesDesc: "按时间浏览全部文章。",

    searchTitle: "搜索",
    searchDesc: "搜索博客中的文章。",
  },
  a11y: {
    skipToContent: "跳转到正文",
    openMenu: "打开菜单",
    closeMenu: "关闭菜单",
    toggleTheme: "切换主题",
    searchPlaceholder: "搜索文章……",
    noResults: "未找到相关内容",
    goToPreviousPage: "前往上一页",
    goToNextPage: "前往下一页",
  },
  notFound: {
    title: "404 页面不存在",
    message: "没有找到你访问的页面",
    goHome: "返回首页",
  },
} satisfies UIStrings;
