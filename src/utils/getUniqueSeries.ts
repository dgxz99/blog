import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";
import { slugifyStr } from "./slugify";

export type Series = {
  series: string;
  seriesName: string;
  count: number;
};

/** 获取已发布文章使用的专栏，并按名称排序 */
export function getUniqueSeries(posts: CollectionEntry<"posts">[]) {
  const seriesMap = new Map<string, Series>();

  for (const post of posts.filter(postFilter)) {
    const seriesName = post.data.series?.trim();
    if (!seriesName) continue;

    const series = slugifyStr(seriesName);
    const current = seriesMap.get(series);

    seriesMap.set(series, {
      series,
      seriesName: current?.seriesName ?? seriesName,
      count: (current?.count ?? 0) + 1,
    });
  }

  return [...seriesMap.values()].sort((seriesA, seriesB) =>
    seriesA.series.localeCompare(seriesB.series)
  );
}
