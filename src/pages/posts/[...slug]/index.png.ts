import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { fontData, experimental_getFontFileURL } from "astro:assets";
import satori from "satori";
import sharp from "sharp";
import { getFontPathByWeight } from "@/utils/getFontPathByWeight";
import { getPostSlug } from "@/utils/getPostPaths";
import config from "@/config";
import { validatePostIds } from "@/utils/validatePostIds";

export async function getStaticPaths() {
  if (!config.features.dynamicOgImage) {
    return [];
  }

  const posts = await getCollection("posts").then(p =>
    p.filter(({ data }) => !data.draft && !data.ogImage)
  );
  validatePostIds(posts);

  return posts.map(post => ({
    params: { slug: getPostSlug(post.data.id, post.filePath) },
    props: post,
  }));
}

export const GET: APIRoute = async ({ props, url }) => {
  if (!config.features.dynamicOgImage) {
    return new Response(null, { status: 404, statusText: "Not found" });
  }

  const fonts = fontData["--font-google-sans-code"];
  const chineseFonts = fontData["--font-lxgw-wenkai"];
  const regularFontPath = getFontPathByWeight(fonts, 400);
  const boldFontPath = getFontPathByWeight(fonts, 700);
  const chineseFontPath = getFontPathByWeight(chineseFonts, 400);

  if (
    regularFontPath === undefined ||
    boldFontPath === undefined ||
    chineseFontPath === undefined
  ) {
    throw new Error("Cannot find the font path.");
  }

  const [regularData, boldData, chineseData] = await Promise.all([
    fetch(experimental_getFontFileURL(regularFontPath, url)).then(res =>
      res.arrayBuffer()
    ),
    fetch(experimental_getFontFileURL(boldFontPath, url)).then(res =>
      res.arrayBuffer()
    ),
    fetch(experimental_getFontFileURL(chineseFontPath, url)).then(res =>
      res.arrayBuffer()
    ),
  ]);

  const publishedAt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: props.data.timezone ?? config.site.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(props.data.pubDatetime)
    .replaceAll("/", ".");

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          background: "#fefbfb",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Google Sans Code, LXGW WenKai",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: "-1px",
                right: "-1px",
                border: "4px solid #000",
                background: "#ecebeb",
                opacity: "0.9",
                borderRadius: "4px",
                display: "flex",
                justifyContent: "center",
                margin: "2.5rem",
                width: "88%",
                height: "80%",
              },
            },
          },
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                left: "6%",
                top: "10%",
                border: "4px solid #000",
                background: "#fefbfb",
                borderRadius: "4px",
                display: "flex",
                justifyContent: "center",
                overflow: "hidden",
                width: "88%",
                height: "80%",
              },
              children: {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    boxSizing: "border-box",
                    padding: "34px 48px 30px",
                    width: "100%",
                    height: "100%",
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          alignItems: "center",
                          color: "#e65100",
                          fontSize: 24,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                        },
                        children: props.data.series ?? "文章",
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          flex: 1,
                          overflow: "hidden",
                        },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: {
                                fontFamily: "LXGW WenKai",
                                fontSize: 50,
                                fontWeight: 400,
                                lineHeight: 1.22,
                                maxHeight: 192,
                                overflow: "hidden",
                              },
                              children: props.data.title,
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: {
                                color: "#4b4b4b",
                                fontFamily: "LXGW WenKai",
                                fontSize: 24,
                                lineHeight: 1.5,
                                marginTop: 16,
                                maxHeight: 72,
                                overflow: "hidden",
                              },
                              children: props.data.description,
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          borderTop: "3px solid #e65100",
                          display: "flex",
                          justifyContent: "space-between",
                          paddingTop: 14,
                          width: "100%",
                          fontSize: 23,
                        },
                        children: [
                          {
                            type: "span",
                            props: {
                              style: { color: "#4b4b4b" },
                              children: publishedAt,
                            },
                          },
                          {
                            type: "span",
                            props: {
                              style: { fontWeight: 700 },
                              children: new URL(config.site.url).hostname,
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      embedFont: true,
      fonts: [
        {
          name: "Google Sans Code",
          data: regularData,
          weight: 400,
          style: "normal",
        },
        {
          name: "Google Sans Code",
          data: boldData,
          weight: 700,
          style: "normal",
        },
        {
          name: "LXGW WenKai",
          data: chineseData,
          weight: 400,
          style: "normal",
        },
        {
          name: "LXGW WenKai",
          data: chineseData,
          weight: 700,
          style: "normal",
        },
      ],
    }
  );

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

  return new Response(new Uint8Array(pngBuffer), {
    headers: { "Content-Type": "image/png" },
  });
};
