import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://blog.dgxz99.top/",
    title: "Daguo's Blog",
    description: "记录软件开发、技术实践与日常思考的个人博客。",
    author: "Daguo",
    profile: "https://github.com/dgxz99",
    ogImage: "default-og.jpg",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: true,
      url: "https://github.com/dgxz99/blog/edit/main/",
    },
    search: "pagefind",
  },
  socials: [
    { name: "github",   url: "https://github.com/dgxz99" },
    { name: "mail",     url: "mailto:mr.gzhihong@gmail.com" },
  ],
  shareLinks: [],
});