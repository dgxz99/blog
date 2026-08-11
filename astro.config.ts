import {
  defineConfig,
  envField,
  fontProviders,
  svgoOptimizer,
} from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { unified } from "@astrojs/markdown-remark";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import rehypeCallouts from "rehype-callouts";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { transformerFileName } from "./src/utils/transformers/fileName";
import config from "./astro-paper.config";

export default defineConfig({
  site: config.site.url,
  integrations: [
    mdx(),
    sitemap({
      filter: page =>
        config.features?.showArchives !== false || !page.endsWith("/archives/"),
    }),
  ],
  i18n: {
    locales: ["zh-CN"],
    defaultLocale: "zh-CN",
    routing: {
      prefixDefaultLocale: false,
    },
  },
  markdown: {
    processor: unified({
      remarkPlugins: [
        remarkToc,
        [remarkCollapse, { test: "Table of contents" }],
      ],
      rehypePlugins: [rehypeCallouts],
    }),
    shikiConfig: {
      themes: { light: "min-light", dark: "night-owl" },
      defaultColor: false,
      wrap: false,
      transformers: [
        transformerFileName({ style: "v2", hideDot: false }),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
        transformerNotationDiff({ matchAlgorithm: "v3" }),
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  fonts: [
    {
      name: "Google Sans Code",
      cssVariable: "--font-google-sans-code",
      provider: fontProviders.local(),
      fallbacks: ["LXGW WenKai", "monospace"],
      optimizedFallbacks: false,
      options: {
        variants: [
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-300-Normal.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-300-Normal.ttf",
            ],
            weight: "300",
            style: "normal",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-300-Italic.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-300-Italic.ttf",
            ],
            weight: "300",
            style: "italic",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-400-Normal.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-400-Normal.ttf",
            ],
            weight: "400",
            style: "normal",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-400-Italic.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-400-Italic.ttf",
            ],
            weight: "400",
            style: "italic",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-500-Normal.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-500-Normal.ttf",
            ],
            weight: "500",
            style: "normal",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-500-Italic.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-500-Italic.ttf",
            ],
            weight: "500",
            style: "italic",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-600-Normal.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-600-Normal.ttf",
            ],
            weight: "600",
            style: "normal",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-600-Italic.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-600-Italic.ttf",
            ],
            weight: "600",
            style: "italic",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-700-Normal.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-700-Normal.ttf",
            ],
            weight: "700",
            style: "normal",
          },
          {
            src: [
              "./src/assets/fonts/google-sans-code/GoogleSansCode-700-Italic.woff",
              "./src/assets/fonts/google-sans-code/GoogleSansCode-700-Italic.ttf",
            ],
            weight: "700",
            style: "italic",
          },
        ],
      },
    },
    {
      name: "LXGW WenKai",
      cssVariable: "--font-lxgw-wenkai",
      provider: fontProviders.local(),
      fallbacks: ["sans-serif"],
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/lxgw-wenkai/LXGWWenKai-Regular.ttf"],
            weight: "400",
            style: "normal",
          },
        ],
      },
    },
  ],
  env: {
    schema: {
      PUBLIC_GOOGLE_SITE_VERIFICATION: envField.string({
        access: "public",
        context: "client",
        optional: true,
      }),
    },
  },
  experimental: {
    svgOptimizer: svgoOptimizer(),
  },
});
